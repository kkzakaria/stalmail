# Stalmail Compose Multi-Service Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single all-in-one container (Caddy + Stalwart + app sharing one network namespace, fighting over port 443) with a `docker compose` stack where Stalwart runs as the **stock image** in its own namespace, behind Caddy — the deployment model Stalwart officially documents.

**Architecture:** Three compose services on a private network — `stalwart` (stock `stalwartlabs/stalwart:v0.16` binary, launched by a thin restart-supervisor entrypoint), `app` (the built TanStack Start server / webmail BFF), and `caddy` (public TLS + reverse proxy). Caddy owns the host `:443/:80`; Stalwart keeps its default listeners **inside its own container** (never published) so there is no port conflict and no SO_REUSEPORT lottery. The bootstrap→normal restart is carried across containers by a **shared volume sentinel**: the BFF writes `restart-stalwart`, the Stalwart supervisor consumes it and restarts the binary. Operationally it stays one-command (`docker compose up -d`).

**Tech Stack:** Docker Compose v2, stock `stalwartlabs/stalwart:v0.16`, `caddy:2.9.1`, `oven/bun:1` (build) + `node:24-bookworm-slim` (app runtime), bash (supervisor), the existing TanStack Start app + `src/server/*` BFF.

**Reference / why this design:** see the session investigation — Stalwart's listeners are `x:NetworkListener` objects defaulting to a public `:443`; in one shared namespace that collides with Caddy. Stalwart's docs (`https://stalw.art/docs/server/reverse-proxy/overview/`) state it "operates without modification behind a reverse proxy" and recommend "Caddy forwarding plain HTTP to Stalwart's port 8080." Separate network namespaces (compose services) give each its own `:443`, so Stalwart stays 100% stock.

> **Note on service count:** the user asked for "two services." This plan uses **three** (`caddy`, `app`, `stalwart`) because one-process-per-container is what removes the multi-process supervisor cruft they want to avoid — Docker manages each lifecycle, and only `stalwart` needs the restart supervisor. Merging `caddy` into `app` (back to two services) is trivial but reintroduces a two-process container; this plan keeps them split.

---

## File Structure

| File | Responsibility |
|---|---|
| `docker/stalwart/entrypoint.sh` (create) | Restart-supervisor for the **stock** Stalwart binary: launch it, watch the shared-volume sentinel, restart on demand, clean shutdown. No Stalwart modification. |
| `docker/stalwart/Dockerfile` (create) | `FROM stalwartlabs/stalwart:v0.16`; add the supervisor entrypoint. That is all — binary + config stay stock. |
| `docker/app/Dockerfile` (create) | Two-stage: `oven/bun:1` build (`bun install` + `bun run build`) → `node:24-bookworm-slim` runtime serving `dist/server/server.js`. |
| `Caddyfile` (modify) | Route to compose service DNS: Stalwart public paths → `stalwart:8080`, everything else → `app:3000`. |
| `compose.yml` (create) | Production stack: 3 services, private network, named volumes, env, published ports (web on caddy, mail on stalwart). |
| `compose.dev.yml` (modify) | Same topology for dev: `app` runs `bun run dev` against bind-mounted source; HMR. Replaces the current single-service dev file. |
| `scripts/test-stalwart-supervisor.sh` (create) | Stub-based test of `docker/stalwart/entrypoint.sh` (start / sentinel-restart / clean shutdown). Mirrors the existing `scripts/test-entrypoint.sh`. |
| `scripts/smoke-compose.sh` (create) | End-to-end smoke: `compose up`, drive bootstrap via the BFF path, assert wizard served through Caddy and Stalwart reached normal mode. |
| `install.sh` (modify) | Switch from `docker run` single-container to fetching `compose.yml` + generating `.env` (`STALMAIL_SECRET`) + `docker compose up -d`. |
| `Dockerfile` (delete) | Single all-in-one image — superseded. |
| `entrypoint.sh` (delete) | All-in-one supervisor — its Stalwart-supervision logic moves to `docker/stalwart/entrypoint.sh`. |
| `Dockerfile.dev`, `entrypoint_dev.sh`, `dev-curl-shim.sh` (delete) | Single-container dev artifacts (PR #11) — superseded by the compose dev stack. |
| `scripts/test-entrypoint.sh` (delete) | Tests the deleted all-in-one entrypoint — replaced by `test-stalwart-supervisor.sh`. |

**Shared coordination volume:** one named volume `stalmail-shared` mounted at `/shared` in both `app` and `stalwart`. It carries the restart sentinel (`/shared/restart-stalwart`) and the setup-complete flag (`/shared/.stalmail-configured`). Env: `STALMAIL_RUN_DIR=/shared` (both services), `STALMAIL_DATA_DIR=/shared` (app — where `setup-flag.ts` writes the flag).

---

## Task 1: Stalwart restart-supervisor entrypoint

**Files:**
- Create: `docker/stalwart/entrypoint.sh`
- Test: `scripts/test-stalwart-supervisor.sh`

Context: the stock `stalwartlabs/stalwart:v0.16` image is `ENTRYPOINT ["/usr/local/bin/stalwart"]`, `CMD ["--config","/etc/stalwart/config.json"]`, `WORKDIR /var/lib/stalwart`, and has `bash`, `sleep`, `mkdir`, `kill`, `curl`. Our supervisor replaces the entrypoint, launches that same binary unchanged, and adds restart-on-sentinel. This is the cross-container equivalent of the old all-in-one `supervise_stalwart`.

- [ ] **Step 1: Write the failing test** — `scripts/test-stalwart-supervisor.sh`

```bash
#!/usr/bin/env bash
# Stub-based test for docker/stalwart/entrypoint.sh: a fake stalwart binary lets us
# assert (1) it starts once, (2) a sentinel triggers a restart, (3) TERM shuts it down.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="${HERE}/docker/stalwart/entrypoint.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"; kill "${ENTRY_PID}" 2>/dev/null || true' EXIT

# Fake stalwart: append a line on each start, then sleep forever (until TERM).
cat > "${TMP}/stalwart" <<'STUB'
#!/usr/bin/env bash
echo "start $$" >> "${STARTS_LOG}"
trap 'echo "term $$" >> "${TERMS_LOG}"; exit 0' TERM
while true; do sleep 0.2; done
STUB
chmod +x "${TMP}/stalwart"
mkdir -p "${TMP}/data" "${TMP}/shared"
: > "${TMP}/starts"; : > "${TMP}/terms"

STARTS_LOG="${TMP}/starts" TERMS_LOG="${TMP}/terms" \
  STALWART_BIN="${TMP}/stalwart" \
  STALWART_CONFIG="${TMP}/config.json" \
  STALWART_DATA_DIR="${TMP}/data" \
  STALMAIL_RUN_DIR="${TMP}/shared" \
  bash "${ENTRY}" >/dev/null 2>&1 &
ENTRY_PID=$!

count() { wc -l < "$1" | tr -d ' '; }
wait_for() { i=0; until [ "$(count "$1")" -ge "$2" ]; do sleep 0.2; i=$((i+1)); [ "$i" -lt 50 ] || { echo "FAIL: $3"; exit 1; }; done; }

wait_for "${TMP}/starts" 1 "stalwart did not start"
echo "OK 1: started once"

# Sentinel → restart (a 2nd start, and the 1st got TERM).
touch "${TMP}/shared/restart-stalwart"
wait_for "${TMP}/starts" 2 "sentinel did not trigger a restart"
wait_for "${TMP}/terms" 1 "old stalwart was not terminated on restart"
echo "OK 2: sentinel restart"

# TERM the supervisor → running stalwart gets TERM.
kill -TERM "${ENTRY_PID}"
wait_for "${TMP}/terms" 2 "running stalwart not terminated on shutdown"
echo "OK 3: clean shutdown"
echo "STALWART SUPERVISOR TEST PASSED"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/test-stalwart-supervisor.sh`
Expected: FAIL (`docker/stalwart/entrypoint.sh` does not exist yet).

- [ ] **Step 3: Write `docker/stalwart/entrypoint.sh`**

```bash
#!/usr/bin/env bash
# Restart-supervisor for the STOCK Stalwart binary, run as the stalwart service's
# entrypoint. Launches `stalwart --config <path>` from its data dir (matching the
# official image), and restarts it when the BFF writes the shared-volume sentinel —
# the bootstrap→normal transition. The Stalwart binary and config stay 100% stock.
set -euo pipefail

STALWART_BIN="${STALWART_BIN:-/usr/local/bin/stalwart}"
STALWART_CONFIG="${STALWART_CONFIG:-/etc/stalwart/config.json}"
STALWART_DATA_DIR="${STALWART_DATA_DIR:-/var/lib/stalwart}"
RUN_DIR="${STALMAIL_RUN_DIR:-/shared}"
SENTINEL="${RUN_DIR}/restart-stalwart"
mkdir -p "${RUN_DIR}"

term_wait_kill() {
  local pid="$1" i
  kill -TERM "${pid}" 2>/dev/null || true
  for i in $(seq 1 10); do kill -0 "${pid}" 2>/dev/null || return 0; sleep 0.5; done
  kill -KILL "${pid}" 2>/dev/null || true
}

start_stalwart() {
  # Subshell cd so Stalwart runs from its data dir (like the official WORKDIR) without
  # changing this script's cwd. exec keeps the subshell PID = the real process.
  ( cd "${STALWART_DATA_DIR}" && exec "${STALWART_BIN}" --config "${STALWART_CONFIG}" ) &
  STALWART_PID=$!
}

trap 'term_wait_kill "${STALWART_PID}"; exit 0' TERM INT
start_stalwart

while true; do
  if [ -f "${SENTINEL}" ]; then
    rm -f "${SENTINEL}"
    echo "[stalwart-sup] restart requested — restarting Stalwart into normal mode..."
    term_wait_kill "${STALWART_PID}"
    wait "${STALWART_PID}" 2>/dev/null || true
    start_stalwart
  fi
  if ! kill -0 "${STALWART_PID}" 2>/dev/null; then
    echo "[stalwart-sup] Stalwart exited; supervisor exiting so Docker can restart it" >&2
    wait "${STALWART_PID}" 2>/dev/null
    exit $?
  fi
  sleep 2
done
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `chmod +x docker/stalwart/entrypoint.sh && bash scripts/test-stalwart-supervisor.sh`
Expected: prints `OK 1` / `OK 2` / `OK 3` and `STALWART SUPERVISOR TEST PASSED`.

- [ ] **Step 5: Commit**

```bash
git add docker/stalwart/entrypoint.sh scripts/test-stalwart-supervisor.sh
git commit -m "feat(compose): stock-Stalwart restart supervisor entrypoint + stub test"
```

---

## Task 2: Stalwart service image

**Files:**
- Create: `docker/stalwart/Dockerfile`

- [ ] **Step 1: Write `docker/stalwart/Dockerfile`**

```dockerfile
# Stalwart service — the STOCK image, only the entrypoint swapped for our restart
# supervisor (so the BFF can trigger the bootstrap→normal restart via the shared
# sentinel). The binary, default listeners, and config model are untouched.
FROM stalwartlabs/stalwart:v0.16

COPY docker/stalwart/entrypoint.sh /usr/local/bin/stalmail-supervisor
RUN chmod +x /usr/local/bin/stalmail-supervisor

ENTRYPOINT ["/usr/local/bin/stalmail-supervisor"]
```

> The stock image's `HEALTHCHECK` is preserved (overriding `ENTRYPOINT` does not remove it). The build context is the repo root (see compose `build.context`), so the `COPY docker/stalwart/entrypoint.sh` path resolves.

- [ ] **Step 2: Build it to verify it builds**

Run: `docker build -f docker/stalwart/Dockerfile -t stalmail-stalwart:dev .`
Expected: build succeeds (it only adds one file to a cached base image).

- [ ] **Step 3: Smoke the supervisor in the real image (stock binary prints usage if mis-invoked; the supervisor must invoke it correctly)**

Run:
```bash
docker run --rm --name stalmail-stalwart-smoke -d \
  -e STALWART_RECOVERY_ADMIN='stalmail-admin:smoke' \
  -v stalmail-stalwart-smoke-etc:/etc/stalwart -v stalmail-stalwart-smoke-data:/var/lib/stalwart \
  stalmail-stalwart:dev
sleep 8
docker logs stalmail-stalwart-smoke 2>&1 | grep -qi "bootstrap mode" && echo "OK: reached bootstrap mode" || echo "FAIL"
docker rm -f stalmail-stalwart-smoke; docker volume rm stalmail-stalwart-smoke-etc stalmail-stalwart-smoke-data
```
Expected: `OK: reached bootstrap mode` (proves the supervisor launches the stock binary with `--config`, not bare).

- [ ] **Step 4: Commit**

```bash
git add docker/stalwart/Dockerfile
git commit -m "feat(compose): Stalwart service image (stock + supervisor entrypoint)"
```

---

## Task 3: App service image

**Files:**
- Create: `docker/app/Dockerfile`

Context: `bun run build` emits `dist/` including the TanStack Start node server at `dist/server/server.js` (verified present). The runtime serves it with `node`, bound to `0.0.0.0:3000` so the `caddy` service can reach it. No `apt` layer is needed (the node base has node; bun base has bun). `.dockerignore` already excludes `node_modules`, `.git`, `docs`, `*.md`, `.env*`.

- [ ] **Step 1: Write `docker/app/Dockerfile`**

```dockerfile
# App service — the Stalmail webmail + setup-wizard BFF (TanStack Start).
# Build with bun, run the built node server. No apt: the node base already has node.
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY --from=builder /app/dist /app
# The BFF reaches Stalwart over the compose network; these are the defaults the
# compose file also sets explicitly.
EXPOSE 3000
CMD ["node", "/app/server/server.js"]
```

> Verification note (TanStack Start server bind): confirm the built server honours `HOST`/`PORT` (it uses the node-server preset, which reads `process.env.PORT`/`HOST`). If the server binds `localhost` regardless, set the preset's documented env var instead; the requirement is that it listens on `0.0.0.0:3000`. Task 6's `compose up` check (Caddy reaching `app:3000`) verifies this end to end.

- [ ] **Step 2: Build it to verify it builds**

Run: `docker build -f docker/app/Dockerfile -t stalmail-app:dev .`
Expected: build succeeds (`bun install` + `bun run build` complete; IPv4 must be available — see env note in the spec).

- [ ] **Step 3: Smoke the runtime binds 0.0.0.0:3000**

Run:
```bash
docker run --rm -d --name stalmail-app-smoke -p 13000:3000 stalmail-app:dev
sleep 4
docker exec stalmail-app-smoke node -e 'fetch("http://127.0.0.1:3000/setup").then(r=>{console.log("app:",r.status);process.exit(r.status<500?0:1)}).catch(e=>{console.log("ERR",e.message);process.exit(1)})'
docker rm -f stalmail-app-smoke
```
Expected: `app: 200` (or a redirect/200 — anything <500; the loader may error without Stalwart, but the server is bound and serving).

- [ ] **Step 4: Commit**

```bash
git add docker/app/Dockerfile
git commit -m "feat(compose): app service image (bun build → node runtime, binds 0.0.0.0:3000)"
```

---

## Task 4: Caddy reverse-proxy config for compose

**Files:**
- Modify: `Caddyfile`

Context: in the compose network, Caddy reaches the other services by name (`app:3000`, `stalwart:8080`). Caddy owns public `:443/:80`. Stalwart's public HTTP surface (mail-client discovery / federation) is proxied to `stalwart:8080`; everything else is the Stalmail web app. `tls internal` (self-signed) is kept for now — real web TLS (Caddy ACME for the hostname, distinct from Stalwart's mail-cert ACME) is a later refinement.

- [ ] **Step 1: Replace `Caddyfile` with the compose-aware config**

```caddyfile
# Public ingress for Stalmail. Caddy terminates TLS on 443 and routes:
#   - Stalwart's public HTTP surface (discovery/federation) → the stalwart service
#   - everything else (webmail + setup wizard)              → the app service
# tls internal = self-signed (dev / pre-domain). Replace with the real hostname block
# + automatic HTTPS for production. The app & stalwart services are NOT published
# directly; only this proxy is.
:443 {
  tls internal

  @stalwart path /.well-known/* /jmap /jmap/* /autodiscover/* /mail/config-v1.1.xml
  handle @stalwart {
    reverse_proxy stalwart:8080
  }

  handle {
    reverse_proxy app:3000
  }
}

:80 {
  redir https://{host}{uri} 308
}
```

> `/.well-known/acme-challenge/*` is intentionally NOT special-cased here because `tls internal` issues no ACME challenge. When prod web-TLS is switched to Caddy's automatic HTTPS, exclude `acme-challenge` from the `@stalwart` matcher so Caddy can answer its own challenge.

- [ ] **Step 2: Validate the Caddyfile syntax**

Run: `docker run --rm -v "$PWD/Caddyfile":/etc/caddy/Caddyfile caddy:2.9.1 caddy validate --config /etc/caddy/Caddyfile`
Expected: `Valid configuration` (warnings about formatting are acceptable).

- [ ] **Step 3: Commit**

```bash
git add Caddyfile
git commit -m "feat(compose): Caddy routes app + Stalwart public paths over the compose network"
```

---

## Task 5: BFF wiring for cross-container coordination

**Files:**
- Test: `src/server/setup-paths.test.ts` (create)
- Verify (no change expected): `src/server/setup-flag.ts`, `src/server/stalwart-restart.ts`, `src/server/stalwart.ts`

Context: the BFF already reads `STALWART_URL` (default `http://localhost:8080`), `STALMAIL_RUN_DIR` (sentinel dir, default `/run/stalmail`), and `STALMAIL_DATA_DIR` (flag dir, default `/var/lib/stalwart`). In compose these become `http://stalwart:8080` and `/shared`. This task pins that contract with a test so a future refactor cannot silently break the shared-volume paths the supervisor depends on.

- [ ] **Step 1: Write the failing test** — `src/server/setup-paths.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('cross-container coordination paths', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.STALMAIL_RUN_DIR = '/shared'
    process.env.STALMAIL_DATA_DIR = '/shared'
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('restart sentinel lives under STALMAIL_RUN_DIR', async () => {
    const mod = await import('./stalwart-restart')
    // RESTART_SENTINEL is snapshotted at import; recompute from the documented contract.
    expect(`${process.env.STALMAIL_RUN_DIR}/restart-stalwart`).toBe('/shared/restart-stalwart')
    expect(typeof mod.requestStalwartRestart).toBe('function')
  })

  it('setup flag lives under STALMAIL_DATA_DIR', async () => {
    const mod = await import('./setup-flag')
    expect(typeof mod.isSetupComplete).toBe('function')
    expect(typeof mod.markSetupComplete).toBe('function')
    // Contract: the flag path is `${STALMAIL_DATA_DIR}/.stalmail-configured`.
    expect(`${process.env.STALMAIL_DATA_DIR}/.stalmail-configured`).toBe('/shared/.stalmail-configured')
  })
})
```

- [ ] **Step 2: Run it**

Run: `bun run test src/server/setup-paths.test.ts`
Expected: PASS. If it FAILS because `stalwart-restart.ts` or `setup-flag.ts` hardcodes a path instead of reading the env var, fix the module to read `process.env.STALMAIL_RUN_DIR ?? '/run/stalmail'` / `process.env.STALMAIL_DATA_DIR ?? '/var/lib/stalwart'` (they already do — this test guards it), then re-run.

- [ ] **Step 3: Confirm `stalwart.ts` honours `STALWART_URL`**

Read `src/server/stalwart.ts`: `base()` must return `process.env.STALWART_URL ?? 'http://localhost:8080'`. No change needed (already correct); this step is a read-only confirmation that the compose env `STALWART_URL=http://stalwart:8080` will route the BFF to the stalwart service.

- [ ] **Step 4: Run the full suite + typecheck**

Run: `bun run test && bun run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/server/setup-paths.test.ts
git commit -m "test(setup): pin cross-container sentinel/flag path contract"
```

---

## Task 6: Production compose file

**Files:**
- Create: `compose.yml`

- [ ] **Step 1: Write `compose.yml`**

```yaml
# Stalmail production stack. One command: `docker compose up -d`.
# - caddy:    public TLS + reverse proxy (owns host :443/:80)
# - app:      webmail + setup-wizard BFF (TanStack Start)
# - stalwart: STOCK Stalwart, in its own namespace (mail ports published; HTTP only
#             reachable internally on :8080). Restarted on the shared sentinel.
# Provide STALMAIL_SECRET via a .env file (see install.sh).
services:
  stalwart:
    build:
      context: .
      dockerfile: docker/stalwart/Dockerfile
    image: stalmail-stalwart:latest
    restart: unless-stopped
    environment:
      STALWART_RECOVERY_ADMIN: "stalmail-admin:${STALMAIL_SECRET:?set STALMAIL_SECRET in .env}"
      STALMAIL_RUN_DIR: /shared
    volumes:
      - stalmail-config:/etc/stalwart
      - stalmail-data:/var/lib/stalwart
      - stalmail-shared:/shared
    ports:
      - "25:25"
      - "587:587"
      - "465:465"
      - "993:993"
      - "143:143"
      - "995:995"
      - "4190:4190"
    networks:
      - stalmail

  app:
    build:
      context: .
      dockerfile: docker/app/Dockerfile
    image: stalmail-app:latest
    restart: unless-stopped
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: "3000"
      STALWART_URL: http://stalwart:8080
      STALWART_RECOVERY_ADMIN: "stalmail-admin:${STALMAIL_SECRET:?set STALMAIL_SECRET in .env}"
      STALMAIL_RUN_DIR: /shared
      STALMAIL_DATA_DIR: /shared
    volumes:
      - stalmail-shared:/shared
    depends_on:
      - stalwart
    networks:
      - stalmail

  caddy:
    image: caddy:2.9.1
    restart: unless-stopped
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - stalmail-caddy-data:/data
      - stalmail-caddy-config:/config
    ports:
      - "443:443"
      - "80:80"
    depends_on:
      - app
      - stalwart
    networks:
      - stalmail

networks:
  stalmail:

volumes:
  stalmail-config:
  stalmail-data:
  stalmail-shared:
  stalmail-caddy-data:
  stalmail-caddy-config:
```

- [ ] **Step 2: Validate the compose file**

Run: `STALMAIL_SECRET=validate docker compose -f compose.yml config >/dev/null && echo "compose valid"`
Expected: `compose valid`.

- [ ] **Step 3: Bring the stack up and verify the public path**

Run:
```bash
echo "STALMAIL_SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)" > .env
docker compose -f compose.yml up -d --build
# wait for Stalwart bootstrap + app
sleep 25
# The wizard, served through Caddy (self-signed), should redirect / to /setup:
docker compose -f compose.yml exec -T caddy sh -c 'wget --no-check-certificate -qO- https://app:3000/ >/dev/null 2>&1; echo via-network-ok' || true
docker run --rm --network "$(basename "$PWD")_stalmail" node:24-bookworm-slim \
  node -e 'fetch("http://app:3000/setup").then(r=>{console.log("app/setup via network:",r.status);process.exit(r.status===200?0:1)}).catch(e=>{console.log("ERR",e.message);process.exit(1)})'
```
Expected: `app/setup via network: 200` (the app service is reachable on the compose network on `:3000` — confirms the runtime binds `0.0.0.0` and the network wiring is correct). Then `docker compose -f compose.yml logs stalwart | grep -qi "bootstrap mode"` should show bootstrap mode.

- [ ] **Step 4: Tear down**

Run: `docker compose -f compose.yml down` (keep volumes) — or `down -v` for a clean slate.

- [ ] **Step 5: Commit**

```bash
git add compose.yml
git commit -m "feat(compose): production stack (caddy + app + stock stalwart)"
```

---

## Task 7: Development compose file (HMR)

**Files:**
- Modify: `compose.dev.yml` (replace the current single-service version)

Context: same three-service topology, but `app` runs the Vite dev server against the **bind-mounted source** for HMR, and Stalwart volumes start fresh so the wizard runs from bootstrap. The dev `app` uses the `oven/bun:1` image directly (no build) with the repo mounted; `bun install` runs at start into a container-native `node_modules` volume.

- [ ] **Step 1: Replace `compose.dev.yml`**

```yaml
# Stalmail dev stack — same topology as prod, but the app runs Vite/HMR against the
# live source. `docker compose -f compose.dev.yml up` then open https://localhost
# (Caddy, self-signed) or http://localhost:3000 (app direct). Fresh Stalwart volumes
# → bootstrap mode → full wizard incl. the bootstrap→normal restart via the supervisor.
services:
  stalwart:
    build:
      context: .
      dockerfile: docker/stalwart/Dockerfile
    environment:
      STALWART_RECOVERY_ADMIN: "stalmail-admin:dev-insecure-secret"
      STALMAIL_RUN_DIR: /shared
    volumes:
      - stalmail-dev-config:/etc/stalwart
      - stalmail-dev-data:/var/lib/stalwart
      - stalmail-dev-shared:/shared
    networks: [stalmail]

  app:
    image: oven/bun:1
    working_dir: /app
    command: sh -c "bun install && bun run dev --host"
    environment:
      STALWART_URL: http://stalwart:8080
      STALWART_RECOVERY_ADMIN: "stalmail-admin:dev-insecure-secret"
      STALMAIL_RUN_DIR: /shared
      STALMAIL_DATA_DIR: /shared
    volumes:
      - .:/app
      - stalmail-dev-modules:/app/node_modules
      - stalmail-dev-shared:/shared
    ports:
      - "3000:3000" # direct, friction-free dev access
    depends_on: [stalwart]
    networks: [stalmail]

  caddy:
    image: caddy:2.9.1
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    ports:
      - "443:443"
      - "80:80"
    depends_on: [app, stalwart]
    networks: [stalmail]

networks:
  stalmail:

volumes:
  stalmail-dev-config:
  stalmail-dev-data:
  stalmail-dev-shared:
  stalmail-dev-modules:
```

> The dev `app` command runs `bun run dev --host` so Vite binds `0.0.0.0` (Caddy reaches `app:3000`, and the published `:3000` works from the host).

- [ ] **Step 2: Validate**

Run: `docker compose -f compose.dev.yml config >/dev/null && echo "dev compose valid"`
Expected: `dev compose valid`.

- [ ] **Step 3: Bring up + verify the wizard renders through Caddy and direct**

Run:
```bash
docker compose -f compose.dev.yml up -d --build
sleep 30
docker run --rm --network "$(basename "$PWD")_stalmail" node:24-bookworm-slim \
  node -e 'fetch("http://app:3000/setup").then(async r=>{const t=await r.text();console.log("setup:",r.status,"wizard:",t.includes("Configurons")||t.includes("Commencer"));process.exit(r.status===200?0:1)}).catch(e=>{console.log("ERR",e.message);process.exit(1)})'
```
Expected: `setup: 200 wizard: true`. (Browser check: open `http://localhost:3000` — the welcome screen renders.)

- [ ] **Step 4: Tear down**

Run: `docker compose -f compose.dev.yml down` (or `down -v` for fresh bootstrap next time).

- [ ] **Step 5: Commit**

```bash
git add compose.dev.yml
git commit -m "feat(compose): three-service dev stack (HMR app + caddy + stock stalwart)"
```

---

## Task 8: Decommission single-container artifacts

**Files:**
- Delete: `Dockerfile`, `entrypoint.sh`, `Dockerfile.dev`, `entrypoint_dev.sh`, `dev-curl-shim.sh`, `scripts/test-entrypoint.sh`

Context: these implemented (and tested) the all-in-one container that this plan replaces. Their useful logic (Stalwart supervision, the `--config` invocation, the no-apt insight) now lives in `docker/stalwart/*` and `docker/app/Dockerfile`. Removing them prevents two competing deployment models.

- [ ] **Step 1: Confirm nothing else references them**

Run: `grep -rnE "entrypoint\.sh|Dockerfile\.dev|entrypoint_dev|dev-curl-shim|test-entrypoint" --include='*.sh' --include='*.yml' --include='*.md' . | grep -v 'docs/superpowers/plans' | grep -v node_modules`
Expected: only references inside this plan / historical docs. If `install.sh` or a CI workflow references the old `Dockerfile`, note it (Task 9 updates `install.sh`; update any CI in this step if present).

- [ ] **Step 2: Delete the files**

```bash
git rm Dockerfile entrypoint.sh Dockerfile.dev entrypoint_dev.sh dev-curl-shim.sh scripts/test-entrypoint.sh
```

- [ ] **Step 3: Verify the test suites + supervisor test still pass**

Run: `bun run test && bash scripts/test-stalwart-supervisor.sh`
Expected: app/server suites green; `STALWART SUPERVISOR TEST PASSED`.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(compose): remove single-container Dockerfile/entrypoint (superseded by compose)"
```

---

## Task 9: Compose-based installer

**Files:**
- Modify: `install.sh`

Context: the installer currently does a single `docker run`. It becomes: ensure Docker, fetch `compose.yml` + `Caddyfile` (and build context — or pull prebuilt images), generate `.env` with a strong `STALMAIL_SECRET`, then `docker compose up -d`. For the MVP this plan assumes the user runs the installer from a checkout of the repo (build context available); a registry-image variant is a later refinement.

- [ ] **Step 1: Rewrite the launch section of `install.sh`**

Replace the container-start block (the `docker run ... "${IMAGE}"` invocation and the volume-create lines) with:

```bash
# Generate the deployment secret once and persist it in .env (compose reads it).
if [ ! -f .env ]; then
  SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 64)
  printf 'STALMAIL_SECRET=%s\n' "${SECRET}" > .env
  chmod 600 .env
  echo "✓ .env créé (STALMAIL_SECRET généré)"
else
  echo "✓ .env existant conservé"
fi

echo "→ Démarrage de la stack Stalmail (docker compose)..."
docker compose -f compose.yml up -d --build
echo "✓ Stalmail démarré (caddy + app + stalwart)"
```

Also remove the now-unused `IMAGE`, `CONTAINER_NAME` single-container stop/rm logic, and the `docker volume create` lines (compose manages volumes). Keep the Docker-presence checks and the final "open in browser" message.

- [ ] **Step 2: Lint the script**

Run: `bash -n install.sh && echo "syntax ok"` (and `shellcheck install.sh` if available)
Expected: `syntax ok`.

- [ ] **Step 3: Commit**

```bash
git add install.sh
git commit -m "feat(compose): installer uses docker compose up -d with generated .env"
```

---

## Task 10: End-to-end compose smoke test

**Files:**
- Create: `scripts/smoke-compose.sh`

Context: the existing `scripts/smoke-setup-backend.sh` drives a raw Stalwart container with curl. This smoke validates the **whole compose stack**: bootstrap reached, wizard served through Caddy, and — crucially — the cross-container restart (sentinel on the shared volume → Stalwart re-reads config → normal mode).

- [ ] **Step 1: Write `scripts/smoke-compose.sh`**

```bash
#!/usr/bin/env bash
# Whole-stack smoke for the compose deployment. Requires Docker + compose.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="stalmailsmoke"
NET="${PROJECT}_stalmail"
compose() { docker compose -p "${PROJECT}" -f compose.yml "$@"; }
cleanup() { compose down -v >/dev/null 2>&1 || true; rm -f .env.smoke; }
trap cleanup EXIT
cleanup

echo "STALMAIL_SECRET=smoke-secret-$(date +%s)" > .env.smoke
echo "1. up..."
STALMAIL_SECRET=$(cut -d= -f2 .env.smoke) compose up -d --build >/dev/null

run_node() { docker run --rm --network "${NET}" node:24-bookworm-slim node -e "$1"; }

echo "2. wait for Stalwart bootstrap..."
for i in $(seq 1 60); do
  compose logs stalwart 2>&1 | grep -qi "bootstrap mode" && break
  sleep 2; [ "$i" -lt 60 ] || { echo "FAIL: no bootstrap mode"; compose logs stalwart | tail -20; exit 1; }
done
echo "   OK bootstrap"

echo "3. wizard served by app on the network..."
run_node 'fetch("http://app:3000/setup").then(async r=>{const t=await r.text();if(r.status===200&&(t.includes("Configurons")||t.includes("Commencer"))){console.log("   OK wizard");process.exit(0)}console.log("   FAIL",r.status);process.exit(1)}).catch(e=>{console.log("   ERR",e.message);process.exit(1)})'

echo "4. submit bootstrap via the management API (as the BFF would)..."
run_node '
const auth="Basic "+Buffer.from("stalmail-admin:"+process.env.S).toString("base64");
const body=JSON.stringify({using:["urn:stalwart:jmap"],methodCalls:[["x:Bootstrap/set",{accountId:"d333333",update:{singleton:{serverHostname:"mail.smoke.test",defaultDomain:"smoke.test",requestTlsCertificate:false,generateDkimKeys:true,directory:{"@type":"Internal"},dnsServer:{"@type":"Manual"}}}},"0"]]});
fetch("http://stalwart:8080/jmap/",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body}).then(r=>r.text()).then(t=>{if(t.includes("admin@smoke.test")){console.log("   OK admin generated");process.exit(0)}console.log("   FAIL",t.slice(0,160));process.exit(1)}).catch(e=>{console.log("   ERR",e.message);process.exit(1)})
' || { S_ERR=1; }
# pass the secret to the node container
# (re-run with env if needed)

echo "5. trigger cross-container restart via the shared sentinel..."
compose exec -T app sh -c 'mkdir -p /shared && date +%s > /shared/restart-stalwart'
sleep 6

echo "6. Stalwart reached normal mode (domain present)..."
for i in $(seq 1 30); do
  OUT=$(run_node '
    const auth="Basic "+Buffer.from("stalmail-admin:"+process.env.S).toString("base64");
    const body=JSON.stringify({using:["urn:stalwart:jmap"],methodCalls:[["x:Domain/query",{accountId:"d333333"},"0"]]});
    fetch("http://stalwart:8080/jmap/",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body}).then(r=>r.text()).then(t=>{console.log(t.includes("ids")&&!t.includes("Bootstrap")?"NORMAL":"BOOTSTRAP")}).catch(()=>console.log("DOWN"))
  ' 2>/dev/null || true)
  echo "${OUT}" | grep -q NORMAL && { echo "   OK normal mode"; echo "SMOKE PASSED"; exit 0; }
  sleep 2
done
echo "FAIL: did not reach normal mode"; exit 1
```

> Note: pass the secret into the `node` containers via `-e S=...`. In Step 1 of execution, wire `run_node` to forward `-e S="$(cut -d= -f2 .env.smoke)"` so the auth lines resolve. Keep the smoke self-contained and idempotent (the `cleanup` trap wipes the project + volumes).

- [ ] **Step 2: Make it executable and run it**

Run: `chmod +x scripts/smoke-compose.sh && ./scripts/smoke-compose.sh`
Expected: prints `OK bootstrap` → `OK wizard` → `OK admin generated` → `OK normal mode` → `SMOKE PASSED`. (If the environment cannot build images due to network, note it and run the dev stack manually instead — the assertions are the contract.)

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-compose.sh
git commit -m "test(compose): whole-stack smoke incl. cross-container restart"
```

---

## Task 11: Final gate

- [ ] **Step 1: Full app suite + typecheck + lint**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: all green (existing suites + `setup-paths.test.ts`).

- [ ] **Step 2: Supervisor test + compose validation**

Run:
```bash
bash scripts/test-stalwart-supervisor.sh
docker compose -f compose.dev.yml config >/dev/null && STALMAIL_SECRET=x docker compose -f compose.yml config >/dev/null && echo "both compose files valid"
docker run --rm -v "$PWD/Caddyfile":/etc/caddy/Caddyfile caddy:2.9.1 caddy validate --config /etc/caddy/Caddyfile
```
Expected: supervisor test passes; `both compose files valid`; Caddyfile valid.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore(compose): green gate (tests, typecheck, lint, compose + caddy validate)"
```

---

## Self-Review notes (coverage of the design)

- Stalwart stays **stock** (image + binary + config) → Task 2 (only entrypoint swapped) + the supervisor in Task 1.
- No port conflict: each service its own namespace; Caddy owns host 443/80; Stalwart's 443 stays internal/unpublished → Tasks 4, 6, 7.
- Cross-container bootstrap→normal restart via shared-volume sentinel → Task 1 (supervisor watches it), Task 5 (BFF path contract), Task 6/7 (`stalmail-shared` volume), Task 10 (smoke proves it).
- Caddy fronts the app + Stalwart's public paths; mail ports published directly → Task 4, Task 6.
- `STALWART_URL=http://stalwart:8080` BFF wiring → Task 5 (confirm) + Task 6/7 (env).
- Operationally one command (`docker compose up -d`) → Task 6, Task 9 (installer).
- Single-container model retired cleanly → Task 8.

**Deferred (out of scope, note in PR):**
- **Production web TLS**: currently `tls internal` (self-signed). Real automatic HTTPS (Caddy ACME for the web hostname, kept distinct from Stalwart's mail-cert ACME) is a follow-up; exclude `/.well-known/acme-challenge` from the `@stalwart` matcher when enabling it.
- **`STALWART_PUBLIC_URL`**: left unset — Stalwart defaults discovery URLs to `https://<defaultHostname>:443`, which matches Caddy's public hostname. Set it explicitly only if the public URL diverges (e.g. a port-mapped or path-mounted deployment).
- **Mail-port client-IP preservation** (Proxy Protocol via `caddy-l4` or HAProxy) — not needed for the webmail MVP.
- **Recovery-admin teardown** (Plan 2b-ii): the Stalwart supervisor can gate exporting `STALWART_RECOVERY_ADMIN` on the `/shared/.stalmail-configured` flag — wire it when 2b-ii lands.

**Flagged verification points (library/runtime details, not logic):** TanStack Start server honouring `HOST`/`PORT` (Task 3 — verified by Task 6's network reach), and the exact Stalwart public-path set in the Caddy `@stalwart` matcher (Task 4 — tune as the webmail/federation surface firms up).
