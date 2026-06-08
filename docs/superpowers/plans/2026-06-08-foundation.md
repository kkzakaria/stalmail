# Stalmail Foundation — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place l'infrastructure Docker et la structure de routes TanStack Start avec détection first-run, pour que le container démarre et redirige vers le wizard ou la boîte mail selon l'état de configuration.

**Architecture:** TanStack Start tourne comme BFF sur le port 3000 derrière Caddy (TLS). Stalwart tourne en interne sur le port 8080. Un flag fichier `/var/lib/stalwart/.stalmail-configured` détermine si le wizard a déjà été complété. L'`entrypoint.sh` démarre Stalwart en background, attend le healthcheck, puis démarre Node.

**Tech Stack:** TanStack Start (SSR), React 19, Vitest, Bun, Docker (debian:bookworm-slim), Caddy

---

> **Plans suivants :**
> - Plan 2 : Setup Wizard (6 étapes, DNS, SSL, premier compte)
> - Plan 3 : Auth & JMAP BFF (OAuth, server functions, httpOnly cookies)
> - Plan 4 : Webmail UI (Sidebar, MailList, Reader, Composer)

---

## Structure des fichiers

```
Créer :
  Dockerfile
  entrypoint.sh
  Caddyfile
  install.sh
  vitest.config.ts
  src/server/setup-flag.ts
  src/server/setup-flag.test.ts
  src/server/stalwart.ts
  src/server/stalwart.test.ts
  src/routes/setup/index.tsx
  src/routes/login.tsx
  src/routes/mail/$folder.tsx

Modifier :
  src/routes/index.tsx       — first-run redirect
  src/routes/__root.tsx      — titre/meta
```

---

### Task 1 : Configurer Vitest pour tests serveur et client

**Files:**
- Create: `vitest.config.ts`

- [ ] **Créer `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    workspace: [
      {
        extends: true,
        test: {
          name: 'server',
          include: ['src/server/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          include: ['src/routes/**/*.test.tsx', 'src/components/**/*.test.tsx'],
          environment: 'jsdom',
          globals: true,
        },
      },
    ],
  },
})
```

- [ ] **Vérifier que Vitest démarre sans erreur**

```bash
bun run test
```

Résultat attendu : `No test files found` (ou 0 tests passent) — pas d'erreur de config.

- [ ] **Commit**

```bash
git add vitest.config.ts
git commit -m "chore: configure vitest workspaces for server and client"
```

---

### Task 2 : Setup flag utility (TDD)

**Files:**
- Create: `src/server/setup-flag.ts`
- Test: `src/server/setup-flag.test.ts`

- [ ] **Écrire le test en premier**

```typescript
// src/server/setup-flag.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

import { existsSync, writeFileSync } from 'node:fs'
import { isSetupComplete, markSetupComplete } from './setup-flag'

describe('isSetupComplete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when flag file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    expect(isSetupComplete()).toBe(true)
  })

  it('returns false when flag file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(isSetupComplete()).toBe(false)
  })
})

describe('markSetupComplete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes an ISO timestamp to the flag file path', () => {
    markSetupComplete()
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.stalmail-configured'),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      'utf-8',
    )
  })

  it('respects STALMAIL_DATA_DIR env variable for the path', () => {
    process.env.STALMAIL_DATA_DIR = '/custom/data'
    markSetupComplete()
    expect(writeFileSync).toHaveBeenCalledWith(
      '/custom/data/.stalmail-configured',
      expect.any(String),
      'utf-8',
    )
    delete process.env.STALMAIL_DATA_DIR
  })
})
```

- [ ] **Vérifier que les tests échouent**

```bash
bun run test --reporter=verbose
```

Résultat attendu : `Cannot find module './setup-flag'`

- [ ] **Écrire l'implémentation minimale**

```typescript
// src/server/setup-flag.ts
import { existsSync, writeFileSync } from 'node:fs'

function flagPath(): string {
  return process.env.STALMAIL_DATA_DIR
    ? `${process.env.STALMAIL_DATA_DIR}/.stalmail-configured`
    : '/var/lib/stalwart/.stalmail-configured'
}

export function isSetupComplete(): boolean {
  return existsSync(flagPath())
}

export function markSetupComplete(): void {
  writeFileSync(flagPath(), new Date().toISOString(), 'utf-8')
}
```

- [ ] **Vérifier que les tests passent**

```bash
bun run test --reporter=verbose
```

Résultat attendu : `4 tests passed`

- [ ] **Commit**

```bash
git add src/server/setup-flag.ts src/server/setup-flag.test.ts
git commit -m "feat: add setup flag utility"
```

---

### Task 3 : Stalwart HTTP client (TDD)

**Files:**
- Create: `src/server/stalwart.ts`
- Test: `src/server/stalwart.test.ts`

- [ ] **Écrire le test en premier**

```typescript
// src/server/stalwart.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { stalwartHealthy, stalwartAdminFetch } from './stalwart'

describe('stalwartHealthy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STALWART_URL = 'http://localhost:8080'
  })

  it('returns true when /healthz/live responds ok', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    expect(await stalwartHealthy()).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/healthz/live',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('returns false when fetch throws (connection refused)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await stalwartHealthy()).toBe(false)
  })

  it('returns false when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await stalwartHealthy()).toBe(false)
  })
})

describe('stalwartAdminFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STALWART_URL = 'http://localhost:8080'
    process.env.STALWART_RECOVERY_ADMIN = 'stalmail-admin:test-secret'
  })

  it('calls the correct URL', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    await stalwartAdminFetch('/api/account')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/account',
      expect.any(Object),
    )
  })

  it('adds Basic Authorization header with base64 credentials', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    await stalwartAdminFetch('/api/account')
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    const expected = `Basic ${Buffer.from('stalmail-admin:test-secret').toString('base64')}`
    expect(init.headers['Authorization']).toBe(expected)
  })

  it('merges caller-provided headers', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    await stalwartAdminFetch('/api/account', {
      headers: { 'X-Custom': 'value' },
    })
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(init.headers['X-Custom']).toBe('value')
    expect(init.headers['Authorization']).toMatch(/^Basic /)
  })
})
```

- [ ] **Vérifier que les tests échouent**

```bash
bun run test --reporter=verbose
```

Résultat attendu : `Cannot find module './stalwart'`

- [ ] **Écrire l'implémentation**

```typescript
// src/server/stalwart.ts

const base = (): string => process.env.STALWART_URL ?? 'http://localhost:8080'

function authHeader(): string {
  const creds = process.env.STALWART_RECOVERY_ADMIN ?? ''
  return `Basic ${Buffer.from(creds).toString('base64')}`
}

export async function stalwartHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/healthz/live`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function stalwartAdminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${base()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}
```

- [ ] **Vérifier que les tests passent**

```bash
bun run test --reporter=verbose
```

Résultat attendu : `7 tests passed`

- [ ] **Commit**

```bash
git add src/server/stalwart.ts src/server/stalwart.test.ts
git commit -m "feat: add Stalwart HTTP client utility"
```

---

### Task 4 : Détection first-run + redirect (TDD)

**Files:**
- Modify: `src/routes/index.tsx`

- [ ] **Écrire le test**

```typescript
// src/routes/index.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../server/setup-flag', () => ({
  isSetupComplete: vi.fn(),
}))

import { isSetupComplete } from '../server/setup-flag'
import { getSetupStatus } from './index'

describe('getSetupStatus', () => {
  it('returns configured: false when setup not complete', async () => {
    vi.mocked(isSetupComplete).mockReturnValue(false)
    expect(await getSetupStatus()).toEqual({ configured: false })
  })

  it('returns configured: true when setup is complete', async () => {
    vi.mocked(isSetupComplete).mockReturnValue(true)
    expect(await getSetupStatus()).toEqual({ configured: true })
  })
})
```

- [ ] **Vérifier que le test échoue**

```bash
bun run test --reporter=verbose
```

Résultat attendu : `SyntaxError` ou `Cannot find export 'getSetupStatus'`

- [ ] **Remplacer `src/routes/index.tsx`**

```typescript
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { isSetupComplete } from '../server/setup-flag'

export async function getSetupStatus(): Promise<{ configured: boolean }> {
  return { configured: isSetupComplete() }
}

const checkSetup = createServerFn({ method: 'GET' }).handler(getSetupStatus)

export const Route = createFileRoute('/')({
  loader: async () => {
    const { configured } = await checkSetup()
    if (!configured) throw redirect({ to: '/setup' })
    throw redirect({ to: '/mail/inbox' })
  },
  component: () => null,
})
```

- [ ] **Vérifier que les tests passent**

```bash
bun run test --reporter=verbose
```

Résultat attendu : `2 tests passed`

- [ ] **Commit**

```bash
git add src/routes/index.tsx src/routes/index.test.ts
git commit -m "feat: add first-run detection and redirect"
```

---

### Task 5 : Shell routes (setup, login, mail)

**Files:**
- Modify: `src/routes/__root.tsx`
- Create: `src/routes/setup/index.tsx`
- Create: `src/routes/login.tsx`
- Create: `src/routes/mail/$folder.tsx`

Pas de tests ici — ce sont des shells vides sans logique. La logique viendra dans les plans suivants.

- [ ] **Mettre à jour le titre dans `src/routes/__root.tsx`**

Remplacer la ligne du titre :
```typescript
// Avant :
{ title: "TanStack Start Starter" },
// Après :
{ title: "Stalmail" },
```

- [ ] **Créer `src/routes/setup/index.tsx`**

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/setup/')({
  component: SetupPage,
})

function SetupPage() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground text-sm">Setup wizard — Plan 2</p>
    </div>
  )
}
```

- [ ] **Créer `src/routes/login.tsx`**

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground text-sm">Login — Plan 3</p>
    </div>
  )
}
```

- [ ] **Créer `src/routes/mail/$folder.tsx`**

```typescript
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/mail/$folder')({
  component: MailPage,
})

function MailPage() {
  const { folder } = Route.useParams()
  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground text-sm">Mailbox: {folder} — Plan 4</p>
    </div>
  )
}
```

- [ ] **Régénérer le routeTree**

```bash
bun run dev
```

TanStack Router génère automatiquement `src/routeTree.gen.ts` au démarrage du dev server. Attendre le message `Route tree generated` dans la console, puis `Ctrl+C`.

- [ ] **Vérifier que le typecheck passe**

```bash
bun run typecheck
```

Résultat attendu : aucune erreur TypeScript.

- [ ] **Commit**

```bash
git add src/routes/__root.tsx src/routes/setup/index.tsx src/routes/login.tsx src/routes/mail/'$folder.tsx' src/routeTree.gen.ts
git commit -m "feat: add shell routes for setup, login and mail"
```

---

### Task 6 : Infrastructure Docker

**Files:**
- Create: `Dockerfile`
- Create: `entrypoint.sh`
- Create: `Caddyfile`
- Create: `.dockerignore`

- [ ] **Créer `Caddyfile`**

```caddy
:443 {
  tls internal
  reverse_proxy localhost:3000
}

:80 {
  redir https://{host}{uri} 308
}
```

> `tls internal` génère un certificat auto-signé. Après le wizard (Plan 2), le Caddyfile sera réécrit dynamiquement avec le domaine réel pour Let's Encrypt.

- [ ] **Créer `.dockerignore`**

```
node_modules
.git
docs
*.md
bun.lock
```

- [ ] **Créer `entrypoint.sh`**

```bash
#!/bin/bash
set -euo pipefail

# Générer STALWART_RECOVERY_ADMIN depuis STALMAIL_SECRET si non fourni
export STALWART_RECOVERY_ADMIN="${STALWART_RECOVERY_ADMIN:-stalmail-admin:${STALMAIL_SECRET}}"
export STALWART_URL="http://localhost:8080"

# Initialiser la config Stalwart au premier démarrage
if [ ! -f /etc/stalwart/config.toml ]; then
  echo "[stalmail] First boot: initializing Stalwart config..."
  /usr/local/bin/stalwart --init /etc/stalwart
fi

# Démarrer Stalwart en background
/usr/local/bin/stalwart --config /etc/stalwart/config.toml &
STALWART_PID=$!

# Attendre que Stalwart soit prêt
echo "[stalmail] Waiting for Stalwart..."
until curl -sf http://localhost:8080/healthz/live > /dev/null 2>&1; do
  sleep 1
done
echo "[stalmail] Stalwart ready"

# Démarrer Caddy en background
caddy start --config /etc/caddy/Caddyfile
echo "[stalmail] Caddy ready"

# Démarrer TanStack Start
echo "[stalmail] Starting app server..."
cd /app && node server.js &
APP_PID=$!

# Forwarder les signaux
trap "kill ${STALWART_PID} ${APP_PID}; caddy stop" SIGTERM SIGINT

wait ${STALWART_PID} ${APP_PID}
```

- [ ] **Créer `Dockerfile`**

```dockerfile
# ── Stage 1 : build de l'app ──────────────────────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ── Stage 2 : image de production ─────────────────────────────────
FROM debian:bookworm-slim AS runner

# Dépendances système
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Caddy
RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v2.9.1/caddy_2.9.1_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin caddy \
    && chmod +x /usr/local/bin/caddy

# Stalwart (binaire depuis l'image officielle)
COPY --from=stalwartlabs/stalwart:v0.16 /usr/local/bin/stalwart /usr/local/bin/stalwart

# App buildée
COPY --from=builder /app/.output /app

# Config
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /etc/stalwart
VOLUME /var/lib/stalwart

EXPOSE 443 80 25 587 465 993 143

ENV NODE_ENV=production
ENV STALMAIL_SECRET=""

ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Rendre entrypoint.sh exécutable**

```bash
chmod +x entrypoint.sh
```

- [ ] **Vérifier que le build Docker fonctionne**

```bash
docker build -t stalmail:dev .
```

Résultat attendu : `Successfully built <image-id>` (peut prendre 2-5 min au premier build).

- [ ] **Commit**

```bash
git add Dockerfile entrypoint.sh Caddyfile .dockerignore
git commit -m "feat: add Docker infrastructure (Dockerfile, entrypoint, Caddy)"
```

---

### Task 7 : Install script

**Files:**
- Create: `install.sh`

- [ ] **Créer `install.sh`**

```bash
#!/bin/bash
set -euo pipefail

CONTAINER_NAME="stalmail"
IMAGE="ghcr.io/stalmail/stalmail:latest"

echo "╔══════════════════════════════════╗"
echo "║        Stalmail Installer        ║"
echo "╚══════════════════════════════════╝"
echo ""

# Vérifier Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker n'est pas installé."
  echo "   → https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &> /dev/null; then
  echo "❌ Docker daemon non accessible. Essayez : sudo systemctl start docker"
  exit 1
fi

echo "✓ Docker détecté"

# Arrêter un container existant
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "→ Container existant détecté, arrêt..."
  docker stop "${CONTAINER_NAME}" > /dev/null 2>&1 || true
  docker rm "${CONTAINER_NAME}" > /dev/null 2>&1 || true
fi

# Créer les volumes s'ils n'existent pas
docker volume create stalmail-config > /dev/null 2>&1 || true
docker volume create stalmail-data > /dev/null 2>&1 || true
echo "✓ Volumes prêts (stalmail-config, stalmail-data)"

# Générer STALMAIL_SECRET
SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 64)

# Lancer le container
echo "→ Démarrage de Stalmail..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -e "STALMAIL_SECRET=${SECRET}" \
  -p 443:443 -p 80:80 \
  -p 25:25 -p 587:587 -p 465:465 \
  -p 993:993 -p 143:143 \
  -v stalmail-config:/etc/stalwart \
  -v stalmail-data:/var/lib/stalwart \
  "${IMAGE}" > /dev/null

echo "✓ Stalmail démarré"
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Ouvre http://$(hostname -I | awk '{print $1}') dans ton navigateur  ║"
echo "║  Le wizard de configuration va démarrer.     ║"
echo "╚══════════════════════════════════════════════╝"
```

- [ ] **Tester le script en mode dry-run (vérification syntaxe)**

```bash
bash -n install.sh
```

Résultat attendu : aucune sortie (syntaxe valide).

- [ ] **Commit**

```bash
git add install.sh
git commit -m "feat: add install script"
```

---

## Smoke test final

- [ ] **Lancer le dev server**

```bash
bun run dev
```

- [ ] **Vérifier le redirect first-run**

Ouvrir `http://localhost:3000` — doit rediriger vers `http://localhost:3000/setup`.

- [ ] **Simuler un setup déjà complété**

```bash
# Créer le flag dans /tmp
touch /tmp/.stalmail-configured
STALMAIL_DATA_DIR=/tmp bun run dev
```

Ouvrir `http://localhost:3000` — doit rediriger vers `http://localhost:3000/mail/inbox`.

```bash
rm /tmp/.stalmail-configured
```

- [ ] **Lancer la suite de tests complète**

```bash
bun run test
```

Résultat attendu : `12 tests passed` (4 setup-flag + 6 stalwart + 2 index).
