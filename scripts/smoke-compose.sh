#!/usr/bin/env bash
# Whole-stack smoke test for the compose deployment.
#
# Proves all five claims:
#   1. Stalwart reaches bootstrap mode after compose up.
#   2. The wizard app is served at http://app:3000/setup (200).
#   3. The JMAP bootstrap call (BFF path) generates admin@<domain>.
#   4. Writing the sentinel from the app container triggers the supervisor in the
#      stalwart container (cross-container restart).
#   5. Stalwart reaches normal mode (domain queryable) after the restart.
#
# Requires: Docker + Compose v2.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="stalmailsmoke"
SECRET="smoke-secret-12345"
NET="${PROJECT}_stalmail"

compose() {
  STALMAIL_SECRET="${SECRET}" docker compose -p "${PROJECT}" -f compose.yml "$@"
}

cleanup() {
  compose down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Always start clean.
cleanup

# ---------------------------------------------------------------------------
echo "0. pre-pull node image (avoids container-startup overhead in probes)..."
# ---------------------------------------------------------------------------
docker pull node:24-bookworm-slim -q >/dev/null

# node_net — run a throwaway node container on the compose network.
# The secret is injected as the env var S so each script can use process.env.S.
# Arguments: a path to a .mjs file to copy + run inside the container.
node_net_file() {
  local script="$1"
  local remote="/tmp/$(basename "$script")"
  # Copy script into a throwaway container via a named container trick.
  # Simpler: use node_net with the script content piped via stdin.
  docker run --rm --network "${NET}" -e S="${SECRET}" \
    -v "${script}:${remote}:ro" \
    node:24-bookworm-slim node "${remote}"
}

# app_node_file — run a .mjs file inside the already-running app container.
# No container pull overhead; sub-second execution.
app_node_file() {
  local script="$1"
  local remote="/tmp/smoke_$(basename "$script")"
  docker cp "${script}" "${PROJECT}-app-1:${remote}"
  docker exec -e S="${SECRET}" "${PROJECT}-app-1" node "${remote}"
}

# write_script — write a here-doc to a temp file; echo the path.
# Usage: SCRIPT=$(write_script <<'JS' ... JS)
TMPDIR_SMOKE="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_SMOKE}"; compose down -v >/dev/null 2>&1 || true' EXIT

write_script() {
  local f="${TMPDIR_SMOKE}/script_$$.mjs"
  cat > "${f}"
  echo "${f}"
}

# ---------------------------------------------------------------------------
echo "1. up (build)..."
# ---------------------------------------------------------------------------
compose up -d --build

# ---------------------------------------------------------------------------
echo "2. wait for Stalwart bootstrap mode..."
# ---------------------------------------------------------------------------
for i in $(seq 1 60); do
  compose logs stalwart 2>&1 | grep -qi "bootstrap mode" && break
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "FAIL: Stalwart did not reach bootstrap mode within 120 s"
    compose logs stalwart | tail -30
    exit 1
  fi
done
echo "   OK bootstrap"

# ---------------------------------------------------------------------------
echo "3. wizard served by app (http://app:3000/setup → 200)..."
# ---------------------------------------------------------------------------
SETUP_PROBE=$(write_script << 'JS'
const r = await fetch("http://app:3000/setup");
process.exit(r.status === 200 ? 0 : 1);
JS
)
for i in $(seq 1 30); do
  node_net_file "${SETUP_PROBE}" && break
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "FAIL: app not serving /setup after 60 s"
    compose logs app | tail -20
    exit 1
  fi
done
echo "   OK wizard served"

# ---------------------------------------------------------------------------
echo "4. submit bootstrap (BFF path) → admin@smoke.test generated..."
# ---------------------------------------------------------------------------
BOOTSTRAP_PROBE=$(write_script << 'JS'
const auth = "Basic " + Buffer.from("stalmail-admin:" + process.env.S).toString("base64");
const body = JSON.stringify({
  using: ["urn:stalwart:jmap"],
  methodCalls: [["x:Bootstrap/set", {
    accountId: "d333333",
    update: { singleton: {
      serverHostname:          "mail.smoke.test",
      defaultDomain:           "smoke.test",
      requestTlsCertificate:   false,
      generateDkimKeys:        true,
      directory:               { "@type": "Internal" },
      dnsServer:               { "@type": "Manual" }
    }}
  }, "0"]]
});
const r = await fetch("http://stalwart:8080/jmap/", {
  method:  "POST",
  headers: { Authorization: auth, "Content-Type": "application/json" },
  body
});
const t = await r.text();
if (!t.includes("admin@smoke.test")) {
  process.stderr.write("bootstrap response missing admin@smoke.test: " + t.slice(0, 400) + "\n");
  process.exit(1);
}
JS
)
node_net_file "${BOOTSTRAP_PROBE}" || { echo "FAIL: bootstrap submit"; exit 1; }
echo "   OK admin generated"

# ---------------------------------------------------------------------------
echo "5. trigger cross-container restart via shared sentinel (from the app container)..."
# ---------------------------------------------------------------------------
# The app service has STALMAIL_RUN_DIR=/shared (mounted from stalmail-shared volume).
# The stalwart supervisor also watches /shared/restart-stalwart on the same volume.
# Writing the sentinel here is exactly what the BFF's requestStalwartRestart() does.
compose exec -T app sh -c 'mkdir -p /shared && date +%s > /shared/restart-stalwart'
echo "   sentinel written"

# ---------------------------------------------------------------------------
echo "6. wait for Stalwart to reach normal mode (domain queryable)..."
# ---------------------------------------------------------------------------

# Phase A — wait for the supervisor to consume the sentinel (log evidence).
# The supervisor loop runs every 2 s; give it up to 20 s.
for i in $(seq 1 10); do
  compose logs stalwart 2>&1 | grep -qi "restart requested" && break
  sleep 2
  if [ "$i" -eq 10 ]; then
    echo "FAIL: supervisor did not log 'restart requested' within 20 s"
    compose logs stalwart | tail -20
    exit 1
  fi
done
SUP_LINE=$(compose logs stalwart 2>&1 | grep -i "restart requested" | head -1 || true)
echo "   supervisor log: ${SUP_LINE}"

# Phase B — wait for Stalwart to finish restarting.
# Stalwart in normal mode does not log a startup message at the default log level,
# so we use healthz/live from the app container (fast, no new container needed).
HEALTHZ_PROBE=$(write_script << 'JS'
const r = await fetch("http://stalwart:8080/healthz/live").catch(() => ({ status: 0 }));
process.stdout.write(String(r.status) + "\n");
JS
)
for i in $(seq 1 30); do
  STATUS=$(app_node_file "${HEALTHZ_PROBE}" 2>/dev/null || true)
  [ "${STATUS}" = "200" ] && break
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "FAIL: Stalwart healthz did not recover within 60 s after restart"
    compose logs stalwart | tail -20
    exit 1
  fi
done

# Phase C — confirm normal mode: x:Domain/query returns an ids array.
# In bootstrap mode this JMAP method is forbidden; in normal mode it returns ids.
DOMAIN_PROBE=$(write_script << 'JS'
const auth = "Basic " + Buffer.from("stalmail-admin:" + process.env.S).toString("base64");
const body = JSON.stringify({
  using: ["urn:stalwart:jmap"],
  methodCalls: [["x:Domain/query", { accountId: "d333333" }, "0"]]
});
const r = await fetch("http://stalwart:8080/jmap/", {
  method:  "POST",
  headers: { Authorization: auth, "Content-Type": "application/json" },
  body
});
const t = await r.text();
// Normal mode: {"methodResponses":[["x:Domain/query",{"ids":["b"],...},"0"]]}
// Bootstrap mode: method is forbidden or returns a Bootstrap object.
const isNormal = t.includes('"ids"') && !t.toLowerCase().includes("forbidden") && !t.includes("Bootstrap");
process.stdout.write((isNormal ? "NORMAL" : "UNEXPECTED:" + t.slice(0, 300)) + "\n");
JS
)
OUT=$(app_node_file "${DOMAIN_PROBE}" 2>/dev/null || echo "ERR")

if [ "${OUT}" = "NORMAL" ]; then
  echo "   OK normal mode"
else
  echo "FAIL: domain query did not indicate normal mode (got: ${OUT})"
  compose logs stalwart | tail -20
  exit 1
fi

echo ""
echo "SMOKE PASSED"
