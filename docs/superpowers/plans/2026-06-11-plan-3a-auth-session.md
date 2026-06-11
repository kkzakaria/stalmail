# Plan 3a — Auth & Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un utilisateur de se connecter via le formulaire Stalmail (email + mot de passe), établir une session sécurisée (cookie opaque httpOnly + store serveur, tokens OAuth chiffrés au repos), protéger les routes `/mail/*`, et se déconnecter.

**Architecture:** Pattern BFF / token-handler. Le BFF rate-limite les tentatives (par compte + IP), relaie les identifiants à `POST /api/auth` (Stalwart v0.16, client public PKCE `stalmail`), échange le code à `POST /auth/token` (`redirect_uri` = `STALMAIL_PUBLIC_URL` fixe, jamais dérivé des headers), et garde les tokens **côté serveur** (Map en mémoire + write-through fichier `node:fs` mode 0600, AES-256-GCM avec AAD, store indexé par `SHA-256(sid)`). Le navigateur ne détient qu'un `sid` opaque. JMAP user via `Authorization: Bearer`. Logout = purge côté BFF (pas d'endpoint de révocation Stalwart). `useXForwarded` est activé côté Stalwart au finalize du wizard (`x:Http/set`) — condition de mise en service du login (auto-ban par IP). Voir spec `docs/superpowers/specs/2026-06-11-plan-3a-auth-session-design.md`, revue sécurité `docs/superpowers/reviews/2026-06-11-plan-3a-security-review.md` et capture `docs/superpowers/specs/2026-06-09-stalwart-api-capture.md` §10 (capturé en **mode normal** ; ⚠️ divergence doc ↔ capture sur l'exigence https du `redirect_uri` — on retient https, à éclaircir avant mise en service, cf. spec §16).

**Tech Stack:** TanStack Start (server functions, cookies via `@tanstack/react-start/server`), React 19, `node:crypto` (HKDF + AES-256-GCM + PKCE), `node:fs` (store), Zod, Vitest, i18next.

---

## File Structure

Tous les nouveaux modules serveur suivent la convention du repo : les fichiers tirés dans le bundle client (server functions, routes) importent les modules `node:*` / serveur **paresseusement dans le handler**.

```
Créer :
  src/server/oauth-pkce.ts            — génération PKCE (verifier + challenge S256)
  src/server/oauth-pkce.test.ts
  src/server/session-crypto.ts        — HKDF(STALMAIL_SECRET) + AES-256-GCM des tokens
  src/server/session-crypto.test.ts
  src/server/session-store.ts         — store fichier node:fs (Map + write-through atomique)
  src/server/session-store.test.ts
  src/server/stalwart-oauth.ts        — postApiAuth / exchangeCode / refreshTokens
  src/server/stalwart-oauth.test.ts
  src/server/stalwart-user.ts         — stalwartUserFetch (Bearer) + fetchJmapAccount
  src/server/stalwart-user.test.ts
  src/server/session.ts               — login/logout/logoutAllForAccount/currentSession/withFreshAccessToken
  src/server/session.test.ts
  src/server/session-cookie.ts        — cookie sid + CSRF Origin/Referer + IP client
  src/server/session-cookie.test.ts
  src/server/login-rate-limit.ts      — rate-limiting BFF des tentatives (compte + IP)
  src/server/login-rate-limit.test.ts
  src/server/stalwart-hardening.ts    — enableXForwarded() via x:Http/set (wizard)
  src/server/stalwart-hardening.test.ts
  src/server/auth-actions.ts          — server functions loginFn/logoutFn/sessionStatusFn
  src/server/auth-actions.test.ts
  src/lib/auth-guard.ts               — requireAuth() pour beforeLoad
  src/lib/auth-guard.test.ts
  src/routes/login.test.tsx

Modifier :
  src/routes/login.tsx                — formulaire de connexion (remplace le placeholder)
  src/routes/mail/$folder.tsx         — beforeLoad: requireAuth()
  src/i18n/resources.ts               — namespace `login` (fr + en)
  src/server/setup-actions.ts         — finishSetupHandler appelle enableXForwarded()
                                        AVANT markSetupComplete()
  compose.yml, compose.dev.yml        — STALMAIL_DATA_DIR + STALMAIL_SECRET +
                                        STALMAIL_PUBLIC_URL + volume app-data
```

**Note de couverture :** la route `/` (`src/routes/index.tsx`) redirige déjà vers `/mail/$folder`; la garde sur `/mail` suffit donc à renvoyer un visiteur non authentifié vers `/login` (root → /mail → guard → /login). On ne modifie pas `index.tsx` (évite de coupler son test à `auth-actions`).

---

## Task 1: PKCE helper

**Files:**
- Create: `src/server/oauth-pkce.ts`
- Test: `src/server/oauth-pkce.test.ts`

- [ ] **Step 1: Write the failing test** (vecteur RFC 7636 annexe B)

```ts
// src/server/oauth-pkce.test.ts
import { describe, it, expect } from 'vitest'
import { challengeFromVerifier, generatePkce } from './oauth-pkce'

describe('oauth-pkce', () => {
  it('derives the RFC 7636 appendix B challenge from a known verifier', () => {
    expect(challengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('generates a verifier of 43-128 url-safe chars and a matching challenge', () => {
    const { verifier, challenge } = generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]{43,128}$/)
    expect(challenge).toBe(challengeFromVerifier(verifier))
    expect(challenge).not.toMatch(/[+/=]/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/oauth-pkce.test.ts`
Expected: FAIL ("Cannot find module './oauth-pkce'").

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/oauth-pkce.ts
import { randomBytes, createHash } from 'node:crypto'

export interface Pkce {
  verifier: string
  challenge: string
}

export function challengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function generatePkce(): Pkce {
  // 32 random bytes → 43-char base64url string (unreserved per RFC 7636).
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: challengeFromVerifier(verifier) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/oauth-pkce.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/oauth-pkce.ts src/server/oauth-pkce.test.ts
git commit -m "feat(auth): PKCE verifier/challenge helper"
```

---

## Task 2: Session token crypto

**Files:**
- Create: `src/server/session-crypto.ts`
- Test: `src/server/session-crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/session-crypto.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { encryptToken, decryptToken } from './session-crypto'

beforeEach(() => {
  process.env.STALMAIL_SECRET = 'test-install-secret-32-chars-min!!'
})

describe('session-crypto', () => {
  it('round-trips a token through encrypt/decrypt with its AAD', () => {
    const plain = 'sw1.t10Ynnzx.abcdef'
    const enc = encryptToken(plain, 'sid-hash-1')
    expect(enc).not.toContain(plain)
    expect(decryptToken(enc, 'sid-hash-1')).toBe(plain)
  })

  it('produces distinct ciphertexts for the same plaintext (random IV)', () => {
    expect(encryptToken('same', 'a')).not.toBe(encryptToken('same', 'a'))
  })

  it('fails to decrypt tampered ciphertext', () => {
    const enc = encryptToken('secret', 'a')
    const tampered = Buffer.from(enc, 'base64')
    tampered[tampered.length - 1] ^= 0xff
    expect(() => decryptToken(tampered.toString('base64'), 'a')).toThrow()
  })

  it('fails to decrypt with the wrong AAD (no cross-record token swap)', () => {
    const enc = encryptToken('secret', 'sid-hash-1')
    expect(() => decryptToken(enc, 'sid-hash-2')).toThrow()
  })

  it('refuses to run without a strong STALMAIL_SECRET (no fallback)', () => {
    process.env.STALMAIL_SECRET = ''
    expect(() => encryptToken('x', 'a')).toThrow(/STALMAIL_SECRET/)
    process.env.STALMAIL_SECRET = 'too-short'
    expect(() => encryptToken('x', 'a')).toThrow(/STALMAIL_SECRET/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/session-crypto.test.ts`
Expected: FAIL ("Cannot find module './session-crypto'").

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/session-crypto.ts
import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const KEY_INFO = 'stalmail/session-enc'
const MIN_SECRET_CHARS = 32

// Key separation: STALMAIL_SECRET is the ONLY accepted root. Never fall back to
// another credential (e.g. the recovery-admin password) — a misconfigured prod must
// fail hard, not silently encrypt with an admin secret.
function rootSecret(): string {
  const secret = process.env.STALMAIL_SECRET ?? ''
  if (secret.length < MIN_SECRET_CHARS)
    throw new Error(`session-crypto: STALMAIL_SECRET must be set (>= ${MIN_SECRET_CHARS} chars)`)
  return secret
}

function deriveKey(info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', rootSecret(), new Uint8Array(0), info, 32))
}

// Layout: base64( iv(12) | tag(16) | ciphertext ). `aad` binds the ciphertext to its
// session record (sidHash): ciphertexts cannot be swapped between records.
export function encryptToken(plaintext: string, aad: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(KEY_INFO), iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function decryptToken(payload: string, aad: string): string {
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(KEY_INFO), iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/session-crypto.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/session-crypto.ts src/server/session-crypto.test.ts
git commit -m "feat(auth): AES-256-GCM+AAD token encryption, fail-hard on weak STALMAIL_SECRET"
```

---

## Task 3: Session store (file-backed)

**Files:**
- Create: `src/server/session-store.ts`
- Test: `src/server/session-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/session-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as store from './session-store'

const rec = (sidHash: string, accountId = 'c'): store.SessionRecord => ({
  sidHash, accountId, accountName: 'alice@probe.test',
  encAccess: 'enc', encRefresh: 'encR', accessExp: 0, createdAt: 0, lastSeenAt: 0,
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stalmail-sess-'))
  process.env.STALMAIL_DATA_DIR = dir
  store.__resetCacheForTest()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('session-store', () => {
  it('creates and reads a session', () => {
    store.createSession(rec('a'))
    expect(store.getSession('a')?.accountName).toBe('alice@probe.test')
  })

  it('persists across a cache reset (reloads from disk)', () => {
    store.createSession(rec('a'))
    store.__resetCacheForTest()
    expect(store.getSession('a')?.sidHash).toBe('a')
  })

  it('writes the store file with owner-only permissions (0600)', () => {
    store.createSession(rec('a'))
    const mode = statSync(join(dir, 'sessions.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('updates a record', () => {
    store.createSession(rec('a'))
    store.updateSession('a', { accessExp: 999 })
    expect(store.getSession('a')?.accessExp).toBe(999)
  })

  it('deletes a session', () => {
    store.createSession(rec('a'))
    store.deleteSession('a')
    expect(store.getSession('a')).toBeUndefined()
  })

  it('deletes all sessions for an account', () => {
    store.createSession(rec('a', 'c'))
    store.createSession(rec('b', 'c'))
    store.createSession(rec('d', 'other'))
    store.deleteAllForAccount('c')
    expect(store.getSession('a')).toBeUndefined()
    expect(store.getSession('b')).toBeUndefined()
    expect(store.getSession('d')?.sidHash).toBe('d')
  })

  it('sweeps records matching a predicate', () => {
    store.createSession(rec('a'))
    store.createSession(rec('b'))
    store.sweep((r) => r.sidHash === 'a')
    expect(store.getSession('a')).toBeUndefined()
    expect(store.getSession('b')?.sidHash).toBe('b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/session-store.test.ts`
Expected: FAIL ("Cannot find module './session-store'").

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/session-store.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

// Keyed by SHA-256(sid): the cleartext sid only ever lives in the browser cookie, so
// stealing this file does not allow replaying sessions (tokens are encrypted too).
export interface SessionRecord {
  sidHash: string
  accountId: string
  accountName: string
  encAccess: string
  encRefresh: string | null
  accessExp: number // epoch ms
  createdAt: number // epoch ms
  lastSeenAt: number // epoch ms
}

// The session store is app-only state on the app data volume (NOT the shared
// cross-container dir). Default mirrors compose's STALMAIL_DATA_DIR.
function dataDir(): string {
  return process.env.STALMAIL_DATA_DIR ?? '/var/lib/stalmail'
}
function storePath(): string {
  return join(dataDir(), 'sessions.json')
}

let cache: Map<string, SessionRecord> | null = null

function load(): Map<string, SessionRecord> {
  if (cache) return cache
  const m = new Map<string, SessionRecord>()
  const p = storePath()
  if (existsSync(p)) {
    try {
      for (const r of JSON.parse(readFileSync(p, 'utf8')) as SessionRecord[]) m.set(r.sidHash, r)
    } catch {
      // Corrupt store → start empty. Sessions are disposable; users re-login.
    }
  }
  cache = m
  return m
}

function persist(m: Map<string, SessionRecord>): void {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `sessions.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify([...m.values()]), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, storePath()) // atomic replace
}

export function createSession(rec: SessionRecord): void {
  const m = load()
  m.set(rec.sidHash, rec)
  persist(m)
}

export function getSession(sidHash: string): SessionRecord | undefined {
  return load().get(sidHash)
}

export function updateSession(sidHash: string, patch: Partial<SessionRecord>): void {
  const m = load()
  const cur = m.get(sidHash)
  if (!cur) return
  m.set(sidHash, { ...cur, ...patch })
  persist(m)
}

export function deleteSession(sidHash: string): void {
  const m = load()
  if (m.delete(sidHash)) persist(m)
}

export function deleteAllForAccount(accountId: string): void {
  const m = load()
  let changed = false
  for (const [k, r] of m) if (r.accountId === accountId) changed = m.delete(k) || changed
  if (changed) persist(m)
}

export function sweep(isExpired: (r: SessionRecord) => boolean): void {
  const m = load()
  let changed = false
  for (const [k, r] of m) if (isExpired(r)) changed = m.delete(k) || changed
  if (changed) persist(m)
}

// test-only: drop the in-memory cache so the next call reloads from disk
export function __resetCacheForTest(): void {
  cache = null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/session-store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/session-store.ts src/server/session-store.test.ts
git commit -m "feat(auth): file-backed session store keyed by SHA-256(sid), mode 0600"
```

---

## Task 4: Stalwart OAuth client

**Files:**
- Create: `src/server/stalwart-oauth.ts`
- Test: `src/server/stalwart-oauth.test.ts`

Comportements ancrés sur la capture §10 (mode normal, v0.16.8) : `/api/auth` renvoie toujours 200, statut dans `type`, clé `client_code`; `/auth/token` en `x-www-form-urlencoded`, **sans** secret client. ⚠️ Rappel (spec §7/§16) : le `redirect_uri` est toujours l'URL https fixe `STALMAIL_PUBLIC_URL` — la doc Stalwart exige https hors recovery/dev même si la capture a observé http accepté (divergence à éclaircir).

- [ ] **Step 1: Write the failing test**

```ts
// src/server/stalwart-oauth.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { postApiAuth, exchangeCode, refreshTokens } from './stalwart-oauth'

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  process.env.STALWART_URL = 'http://stalwart:8080'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('postApiAuth', () => {
  it('maps an authenticated response to a clientCode and forwards the client IP', async () => {
    fetchMock.mockResolvedValue(okJson({ type: 'authenticated', client_code: 'W6V0' }))
    const res = await postApiAuth({
      accountName: 'alice@probe.test', accountSecret: 'pw', clientId: 'stalmail',
      redirectUri: 'http://h/login', codeChallenge: 'CH', forwardedFor: '203.0.113.7',
    })
    expect(res).toEqual({ type: 'authenticated', clientCode: 'W6V0' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://stalwart:8080/api/auth')
    expect((init.headers as Record<string, string>)['X-Forwarded-For']).toBe('203.0.113.7')
    const sent = JSON.parse(init.body as string)
    expect(sent).toMatchObject({ type: 'authCode', accountName: 'alice@probe.test', codeChallengeMethod: 'S256' })
  })

  it('maps mfaRequired and failure', async () => {
    fetchMock.mockResolvedValue(okJson({ type: 'mfaRequired' }))
    expect(await postApiAuth({ accountName: 'a', accountSecret: 'b', clientId: 'stalmail', redirectUri: 'r', codeChallenge: 'c' })).toEqual({ type: 'mfaRequired' })
    fetchMock.mockResolvedValue(okJson({ type: 'failure' }))
    expect(await postApiAuth({ accountName: 'a', accountSecret: 'b', clientId: 'stalmail', redirectUri: 'r', codeChallenge: 'c' })).toEqual({ type: 'failure' })
  })
})

describe('exchangeCode / refreshTokens', () => {
  it('posts a urlencoded authorization_code grant with PKCE and no client secret', async () => {
    fetchMock.mockResolvedValue(okJson({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }))
    const tokens = await exchangeCode({ code: 'CODE', codeVerifier: 'VER', clientId: 'stalmail', redirectUri: 'http://h/login' })
    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresIn: 3600 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://stalwart:8080/auth/token')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(init.headers as Record<string, string>).not.toHaveProperty('Authorization')
    const form = new URLSearchParams(init.body as string)
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code_verifier')).toBe('VER')
    expect(form.has('client_secret')).toBe(false)
  })

  it('refreshes and tolerates a missing refresh_token (non-rotated)', async () => {
    fetchMock.mockResolvedValue(okJson({ access_token: 'AT2', expires_in: 3600 }))
    const tokens = await refreshTokens({ refreshToken: 'RT', clientId: 'stalmail' })
    expect(tokens).toEqual({ accessToken: 'AT2', refreshToken: null, expiresIn: 3600 })
    expect(new URLSearchParams((fetchMock.mock.calls[0][1].body as string)).get('grant_type')).toBe('refresh_token')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/stalwart-oauth.test.ts`
Expected: FAIL ("Cannot find module './stalwart-oauth'").

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/stalwart-oauth.ts
export class OAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthError'
  }
}

function base(): string {
  return process.env.STALWART_URL ?? 'http://localhost:8080'
}

export type ApiAuthResult =
  | { type: 'authenticated'; clientCode: string }
  | { type: 'mfaRequired' }
  | { type: 'failure' }

export async function postApiAuth(input: {
  accountName: string
  accountSecret: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  forwardedFor?: string
  mfaToken?: string
}): Promise<ApiAuthResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (input.forwardedFor) headers['X-Forwarded-For'] = input.forwardedFor
  const res = await fetch(`${base()}/api/auth`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'authCode',
      accountName: input.accountName,
      accountSecret: input.accountSecret,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      ...(input.mfaToken ? { mfaToken: input.mfaToken } : {}),
    }),
  })
  // /api/auth always answers 200 with the business status in `type`.
  if (!res.ok) throw new OAuthError(`/api/auth HTTP ${res.status}`)
  const body = (await res.json()) as { type?: string; client_code?: string }
  if (body.type === 'authenticated' && body.client_code)
    return { type: 'authenticated', clientCode: body.client_code }
  if (body.type === 'mfaRequired') return { type: 'mfaRequired' }
  return { type: 'failure' }
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  expiresIn: number
}

async function tokenRequest(form: Record<string, string>): Promise<TokenSet> {
  // Public PKCE client: NO Authorization/client_secret (Stalwart → invalid_client).
  const res = await fetch(`${base()}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  if (!res.ok) throw new OAuthError(`/auth/token HTTP ${res.status}`)
  const body = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!body.access_token) throw new OAuthError('no access_token in token response')
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresIn: body.expires_in ?? 3600,
  }
}

export function exchangeCode(input: {
  code: string
  codeVerifier: string
  clientId: string
  redirectUri: string
}): Promise<TokenSet> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
  })
}

export function refreshTokens(input: { refreshToken: string; clientId: string }): Promise<TokenSet> {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/stalwart-oauth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/stalwart-oauth.ts src/server/stalwart-oauth.test.ts
git commit -m "feat(auth): Stalwart OAuth client (/api/auth + /auth/token, public PKCE)"
```

---

## Task 5: Bearer JMAP fetch + account probe

**Files:**
- Create: `src/server/stalwart-user.ts`
- Test: `src/server/stalwart-user.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/stalwart-user.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { stalwartUserFetch, fetchJmapAccount } from './stalwart-user'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  process.env.STALWART_URL = 'http://stalwart:8080'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('stalwartUserFetch', () => {
  it('sends a Bearer authorization header', async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response)
    await stalwartUserFetch('/jmap/session', 'AT', { method: 'GET' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://stalwart:8080/jmap/session')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer AT')
  })
})

describe('fetchJmapAccount', () => {
  it('returns the primary account id and username', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        username: 'alice@probe.test',
        primaryAccounts: { 'urn:ietf:params:jmap:core': 'c', 'urn:ietf:params:jmap:mail': 'c' },
      }),
    } as Response)
    expect(await fetchJmapAccount('AT')).toEqual({ accountId: 'c', accountName: 'alice@probe.test' })
  })

  it('throws when the session lacks an account', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
    await expect(fetchJmapAccount('AT')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/stalwart-user.test.ts`
Expected: FAIL ("Cannot find module './stalwart-user'").

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/stalwart-user.ts
function base(): string {
  return process.env.STALWART_URL ?? 'http://localhost:8080'
}

// User-scoped Stalwart call with an OAuth access token (parallels stalwartAdminFetch).
export async function stalwartUserFetch(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${base()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}

// Minimal authenticated probe: proves the Bearer token reaches JMAP and yields
// the principal id + email used to label the session.
export async function fetchJmapAccount(
  accessToken: string,
): Promise<{ accountId: string; accountName: string }> {
  const res = await stalwartUserFetch('/jmap/session', accessToken, { method: 'GET' })
  if (!res.ok) throw new Error(`jmap session HTTP ${res.status}`)
  const s = (await res.json()) as { username?: string; primaryAccounts?: Record<string, string> }
  const accountId =
    s.primaryAccounts?.['urn:ietf:params:jmap:core'] ?? Object.values(s.primaryAccounts ?? {})[0]
  if (!accountId || !s.username) throw new Error('jmap session missing account')
  return { accountId, accountName: s.username }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/stalwart-user.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/stalwart-user.ts src/server/stalwart-user.test.ts
git commit -m "feat(auth): Bearer JMAP fetch + authenticated account probe"
```

---

## Task 6: Session business layer

**Files:**
- Create: `src/server/session.ts`
- Test: `src/server/session.test.ts`

Mocke uniquement les modules réseau (`stalwart-oauth`, `stalwart-user`); utilise le vrai store (répertoire temp) + la vraie crypto (secret en env).

- [ ] **Step 1: Write the failing test**

```ts
// src/server/session.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./stalwart-oauth', () => ({
  postApiAuth: vi.fn(),
  exchangeCode: vi.fn(),
  refreshTokens: vi.fn(),
}))
vi.mock('./stalwart-user', () => ({ fetchJmapAccount: vi.fn() }))

// eslint-disable-next-line import/first
import { postApiAuth, exchangeCode, refreshTokens } from './stalwart-oauth'
// eslint-disable-next-line import/first
import { fetchJmapAccount } from './stalwart-user'
// eslint-disable-next-line import/first
import * as store from './session-store'
// eslint-disable-next-line import/first
import { login, logout, currentSession, withFreshAccessToken, hashSid, ABSOLUTE_TTL_MS } from './session'

const pa = vi.mocked(postApiAuth)
const xc = vi.mocked(exchangeCode)
const rt = vi.mocked(refreshTokens)
const ja = vi.mocked(fetchJmapAccount)

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stalmail-session-'))
  process.env.STALMAIL_DATA_DIR = dir
  process.env.STALMAIL_SECRET = 'test-install-secret-32-chars-min!!'
  store.__resetCacheForTest()
  vi.clearAllMocks()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const baseLogin = { accountName: 'alice@probe.test', accountSecret: 'pw', redirectUri: 'https://h/login' }

const mockSuccess = () => {
  pa.mockResolvedValue({ type: 'authenticated', clientCode: 'CC' })
  xc.mockResolvedValue({ accessToken: 'AT', refreshToken: 'RT', expiresIn: 3600 })
  ja.mockResolvedValue({ accountId: 'c', accountName: 'alice@probe.test' })
}

describe('login', () => {
  it('creates a session keyed by hashSid — the raw sid never keys the store', async () => {
    mockSuccess()
    const res = await login(baseLogin)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(store.getSession(res.sid)).toBeUndefined()
    expect(store.getSession(hashSid(res.sid))?.accountId).toBe('c')
  })

  it('deletes the previous session on re-login (a stolen sid does not survive)', async () => {
    mockSuccess()
    const first = await login(baseLogin)
    if (!first.ok) throw new Error('login failed')
    const second = await login({ ...baseLogin, previousSid: first.sid })
    if (!second.ok) throw new Error('login failed')
    expect(store.getSession(hashSid(first.sid))).toBeUndefined()
    expect(store.getSession(hashSid(second.sid))).toBeDefined()
  })

  it('sweeps absolutely-expired sessions from the store on login', async () => {
    mockSuccess()
    const old = await login({ ...baseLogin, now: 0 })
    if (!old.ok) throw new Error('login failed')
    const fresh = await login({ ...baseLogin, now: ABSOLUTE_TTL_MS + 1 })
    if (!fresh.ok) throw new Error('login failed')
    expect(store.getSession(hashSid(old.sid))).toBeUndefined()
  })

  it('returns reason mfa / failure without creating a session', async () => {
    pa.mockResolvedValue({ type: 'mfaRequired' })
    expect(await login(baseLogin)).toEqual({ ok: false, reason: 'mfa' })
    pa.mockResolvedValue({ type: 'failure' })
    expect(await login(baseLogin)).toEqual({ ok: false, reason: 'failure' })
    expect(xc).not.toHaveBeenCalled()
  })
})

describe('currentSession', () => {
  it('returns null for an unknown sid and resolves a valid one', async () => {
    expect(currentSession('nope')).toBeNull()
    mockSuccess()
    const res = await login(baseLogin)
    if (!res.ok) throw new Error('login failed')
    expect(currentSession(res.sid)?.accountName).toBe('alice@probe.test')
  })

  it('drops and rejects an absolutely-expired session', async () => {
    mockSuccess()
    const res = await login({ ...baseLogin, now: 0 })
    if (!res.ok) throw new Error('login failed')
    expect(currentSession(res.sid, ABSOLUTE_TTL_MS + 1)).toBeNull()
    expect(store.getSession(hashSid(res.sid))).toBeUndefined()
  })
})

describe('logout / withFreshAccessToken', () => {
  it('logout removes the session', async () => {
    mockSuccess()
    const res = await login(baseLogin)
    if (!res.ok) throw new Error('login failed')
    logout(res.sid)
    expect(store.getSession(hashSid(res.sid))).toBeUndefined()
  })

  it('refreshes a near-expiry access token and persists a rotated refresh token', async () => {
    mockSuccess()
    const res = await login({ ...baseLogin, now: 1000 })
    if (!res.ok) throw new Error('login failed')
    rt.mockResolvedValue({ accessToken: 'AT2', refreshToken: 'RT2', expiresIn: 3600 })
    // now well past accessExp → triggers refresh
    const fresh = await withFreshAccessToken(res.sid, 1000 + 3600_000)
    expect(fresh).toBe('AT2')
    expect(rt).toHaveBeenCalledOnce()
  })

  it('serializes concurrent refreshes — a single token exchange in flight per sid', async () => {
    mockSuccess()
    const res = await login({ ...baseLogin, now: 1000 })
    if (!res.ok) throw new Error('login failed')
    rt.mockResolvedValue({ accessToken: 'AT2', refreshToken: null, expiresIn: 3600 })
    const now = 1000 + 3600_000
    const [a, b] = await Promise.all([
      withFreshAccessToken(res.sid, now),
      withFreshAccessToken(res.sid, now),
    ])
    expect(a).toBe('AT2')
    expect(b).toBe('AT2')
    expect(rt).toHaveBeenCalledOnce()
  })

  it('drops the session and returns null when refresh fails', async () => {
    mockSuccess()
    const res = await login({ ...baseLogin, now: 1000 })
    if (!res.ok) throw new Error('login failed')
    rt.mockRejectedValue(new Error('bad RT'))
    expect(await withFreshAccessToken(res.sid, 1000 + 3600_000)).toBeNull()
    expect(store.getSession(hashSid(res.sid))).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/session.test.ts`
Expected: FAIL ("Cannot find module './session'").

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/session.ts
import { createHash, randomBytes } from 'node:crypto'
import { generatePkce } from './oauth-pkce'
import { encryptToken, decryptToken } from './session-crypto'
import * as store from './session-store'
import { postApiAuth, exchangeCode, refreshTokens } from './stalwart-oauth'
import { fetchJmapAccount } from './stalwart-user'

export const CLIENT_ID = 'stalmail'
export const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // aligned with refreshTokenExpiry
const REFRESH_SKEW_MS = 60_000
const TOUCH_THROTTLE_MS = 60_000 // persist lastSeenAt at most once per minute

export type LoginResult = { ok: true; sid: string } | { ok: false; reason: 'failure' | 'mfa' }

// Only SHA-256(sid) ever reaches the store: the cleartext sid lives in the httpOnly
// cookie alone, so stealing the store file does not allow replaying sessions.
export function hashSid(sid: string): string {
  return createHash('sha256').update(sid).digest('hex')
}

function isExpired(r: store.SessionRecord, now: number): boolean {
  return now - r.lastSeenAt > IDLE_TTL_MS || now - r.createdAt > ABSOLUTE_TTL_MS
}

export async function login(input: {
  accountName: string
  accountSecret: string
  redirectUri: string
  forwardedFor?: string
  previousSid?: string
  now?: number
}): Promise<LoginResult> {
  const now = input.now ?? Date.now()
  store.sweep((r) => isExpired(r, now)) // global GC — expired records never linger on disk
  const { verifier, challenge } = generatePkce()
  const auth = await postApiAuth({
    accountName: input.accountName,
    accountSecret: input.accountSecret,
    clientId: CLIENT_ID,
    redirectUri: input.redirectUri,
    codeChallenge: challenge,
    forwardedFor: input.forwardedFor,
  })
  if (auth.type === 'mfaRequired') return { ok: false, reason: 'mfa' }
  if (auth.type === 'failure') return { ok: false, reason: 'failure' }

  const tokens = await exchangeCode({
    code: auth.clientCode,
    codeVerifier: verifier,
    clientId: CLIENT_ID,
    redirectUri: input.redirectUri,
  })
  const { accountId, accountName } = await fetchJmapAccount(tokens.accessToken)
  // Anti-fixation: a pre-existing session must not survive a successful re-login.
  if (input.previousSid) store.deleteSession(hashSid(input.previousSid))
  const sid = randomBytes(32).toString('base64url')
  const sidHash = hashSid(sid)
  store.createSession({
    sidHash,
    accountId,
    accountName,
    encAccess: encryptToken(tokens.accessToken, sidHash),
    encRefresh: tokens.refreshToken ? encryptToken(tokens.refreshToken, sidHash) : null,
    accessExp: now + tokens.expiresIn * 1000,
    createdAt: now,
    lastSeenAt: now,
  })
  return { ok: true, sid }
}

export function logout(sid: string): void {
  store.deleteSession(hashSid(sid))
}

export function logoutAllForAccount(accountId: string): void {
  store.deleteAllForAccount(accountId)
}

export function currentSession(
  sid: string | undefined,
  now: number = Date.now(),
): { accountId: string; accountName: string } | null {
  if (!sid) return null
  const sidHash = hashSid(sid)
  const r = store.getSession(sidHash)
  if (!r) return null
  if (isExpired(r, now)) {
    store.deleteSession(sidHash)
    return null
  }
  // Throttled touch: one store write per minute per session, not one per request.
  if (now - r.lastSeenAt > TOUCH_THROTTLE_MS) store.updateSession(sidHash, { lastSeenAt: now })
  return { accountId: r.accountId, accountName: r.accountName }
}

// Per-session mutex: a single refresh in flight per sid. Without it, two concurrent
// requests inside the RT rotation window (its last 4 days) can lose the rotated RT
// or fail the second exchange → spurious logout.
const inFlight = new Map<string, Promise<string | null>>()

export function withFreshAccessToken(
  sid: string,
  now: number = Date.now(),
): Promise<string | null> {
  const sidHash = hashSid(sid)
  const pending = inFlight.get(sidHash)
  if (pending) return pending
  const p = freshAccessToken(sidHash, now).finally(() => inFlight.delete(sidHash))
  inFlight.set(sidHash, p)
  return p
}

async function freshAccessToken(sidHash: string, now: number): Promise<string | null> {
  const r = store.getSession(sidHash)
  if (!r) return null
  if (isExpired(r, now)) {
    store.deleteSession(sidHash)
    return null
  }
  if (now < r.accessExp - REFRESH_SKEW_MS) return decryptToken(r.encAccess, sidHash)
  if (!r.encRefresh) return decryptToken(r.encAccess, sidHash)
  try {
    const tokens = await refreshTokens({ refreshToken: decryptToken(r.encRefresh, sidHash), clientId: CLIENT_ID })
    store.updateSession(sidHash, {
      encAccess: encryptToken(tokens.accessToken, sidHash),
      // Stalwart rotates the refresh token only in its last 4 days — persist when present.
      encRefresh: tokens.refreshToken ? encryptToken(tokens.refreshToken, sidHash) : r.encRefresh,
      accessExp: now + tokens.expiresIn * 1000,
    })
    return tokens.accessToken
  } catch {
    store.deleteSession(sidHash) // refresh failed → force re-login
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/session.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/session.ts src/server/session.test.ts
git commit -m "feat(auth): session layer (hashed sids, serialized refresh, login sweep)"
```

---

## Task 7: Session cookie + CSRF + client IP

**Files:**
- Create: `src/server/session-cookie.ts`
- Test: `src/server/session-cookie.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/session-cookie.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@tanstack/react-start/server', () => ({
  getCookie: vi.fn(),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
  getRequestHeader: vi.fn(),
}))

// eslint-disable-next-line import/first
import { getCookie, setCookie, deleteCookie, getRequestHeader } from '@tanstack/react-start/server'
// eslint-disable-next-line import/first
import { readSid, writeSid, clearSid, assertSameOrigin, clientIp, cookieName } from './session-cookie'

const headers = (map: Record<string, string | undefined>) =>
  vi.mocked(getRequestHeader).mockImplementation((n: string) => map[n.toLowerCase()])

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODE_ENV = 'production'
})
afterEach(() => {
  process.env.NODE_ENV = 'test'
})

describe('session cookie', () => {
  it('uses the __Host- name in production and reads/writes/clears it', () => {
    expect(cookieName()).toBe('__Host-stalmail_session')
    vi.mocked(getCookie).mockReturnValue('SID')
    expect(readSid()).toBe('SID')
    writeSid('NEW')
    expect(setCookie).toHaveBeenCalledWith(
      '__Host-stalmail_session',
      'NEW',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    )
    clearSid()
    expect(deleteCookie).toHaveBeenCalledWith('__Host-stalmail_session', { path: '/' })
  })
})

describe('assertSameOrigin', () => {
  it('passes when Origin host matches the forwarded host', () => {
    headers({ origin: 'https://mail.x/login', 'x-forwarded-host': 'mail.x' })
    expect(() => assertSameOrigin()).not.toThrow()
  })
  it('falls back to Referer when Origin is absent', () => {
    headers({ referer: 'https://mail.x/login', 'x-forwarded-host': 'mail.x' })
    expect(() => assertSameOrigin()).not.toThrow()
  })
  it('throws on a cross-origin Referer when Origin is absent', () => {
    headers({ referer: 'https://evil.x/csrf', host: 'mail.x' })
    expect(() => assertSameOrigin()).toThrow()
  })
  it('passes when there is neither Origin nor Referer (same-origin navigation)', () => {
    headers({})
    expect(() => assertSameOrigin()).not.toThrow()
  })
  it('throws on a cross-origin request', () => {
    headers({ origin: 'https://evil.x', host: 'mail.x' })
    expect(() => assertSameOrigin()).toThrow()
  })
})

describe('clientIp', () => {
  it('returns the first X-Forwarded-For hop', () => {
    headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    expect(clientIp()).toBe('203.0.113.7')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/session-cookie.test.ts`
Expected: FAIL ("Cannot find module './session-cookie'").

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/session-cookie.ts
import { getCookie, setCookie, deleteCookie, getRequestHeader } from '@tanstack/react-start/server'

const ABSOLUTE_TTL_S = 30 * 24 * 60 * 60 // 30d, aligned with the session absolute TTL

function secure(): boolean {
  return process.env.NODE_ENV === 'production'
}

// __Host- requires Secure + Path=/ + no Domain; only valid over https (prod).
export function cookieName(): string {
  return secure() ? '__Host-stalmail_session' : 'stalmail_session'
}

export function readSid(): string | undefined {
  return getCookie(cookieName())
}

export function writeSid(sid: string): void {
  setCookie(cookieName(), sid, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_TTL_S,
  })
}

export function clearSid(): void {
  deleteCookie(cookieName(), { path: '/' })
}

// CSRF: reject state-changing requests whose Origin (or, failing that, Referer)
// host ≠ our host. Trust model: x-forwarded-host MUST be overwritten by Caddy —
// never relayed from the client (see spec §8/§9).
export function assertSameOrigin(): void {
  const origin = getRequestHeader('origin') ?? getRequestHeader('referer')
  if (!origin) return // same-origin navigations may omit both headers
  const host = getRequestHeader('x-forwarded-host') ?? getRequestHeader('host')
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw new Error('invalid Origin/Referer header')
  }
  if (!host || originHost !== host) throw new Error('cross-origin request rejected')
}

// Real client IP from the proxy chain, for Stalwart rate-limiting/Fail2Ban.
// First X-Forwarded-For hop — safe ONLY because Caddy overwrites the incoming
// header for untrusted clients (do NOT add Internet to trusted_proxies).
export function clientIp(): string | undefined {
  const xff = getRequestHeader('x-forwarded-for')
  return xff ? xff.split(',')[0]!.trim() : undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/session-cookie.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/session-cookie.ts src/server/session-cookie.test.ts
git commit -m "feat(auth): session cookie helpers + CSRF Origin/Referer check + client IP"
```

---

## Task 8: Login rate-limit + auth server functions

**Files:**
- Create: `src/server/login-rate-limit.ts`
- Test: `src/server/login-rate-limit.test.ts`
- Create: `src/server/auth-actions.ts`
- Test: `src/server/auth-actions.test.ts`

Le rate-limiting BFF est une exigence de la spec §9 : il amortit le bruteforce **avant**
`/api/auth` pour que les échecs ne s'accumulent pas sur l'IP du BFF côté Stalwart
(auto-ban `authBanRate` = 100 échecs/jour par IP source) et limite l'oracle `mfaRequired`.
⚠️ Rappel (spec §7/§16) : `redirectUri` vient exclusivement de `STALMAIL_PUBLIC_URL`
(https en prod) — jamais des headers de la requête.

- [ ] **Step 1: Write the failing rate-limit test**

```ts
// src/server/login-rate-limit.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { isRateLimited, recordFailure, __resetForTest } from './login-rate-limit'

beforeEach(() => __resetForTest())

describe('login-rate-limit', () => {
  it('allows attempts below the per-account threshold', () => {
    for (let i = 0; i < 9; i++) recordFailure('a@x', '203.0.113.7', 1000)
    expect(isRateLimited('a@x', '203.0.113.7', 1000)).toBe(false)
  })

  it('blocks an account after too many failures (any IP)', () => {
    for (let i = 0; i < 10; i++) recordFailure('a@x', `198.51.100.${i}`, 1000)
    expect(isRateLimited('a@x', '203.0.113.7', 1000)).toBe(true)
    expect(isRateLimited('A@X', '203.0.113.7', 1000)).toBe(true) // case-insensitive
    expect(isRateLimited('b@x', '203.0.113.7', 1000)).toBe(false)
  })

  it('blocks an IP after too many failures (any account)', () => {
    for (let i = 0; i < 30; i++) recordFailure(`u${i}@x`, '203.0.113.7', 1000)
    expect(isRateLimited('fresh@x', '203.0.113.7', 1000)).toBe(true)
    expect(isRateLimited('fresh@x', '198.51.100.9', 1000)).toBe(false)
  })

  it('unblocks once the sliding window has passed', () => {
    for (let i = 0; i < 10; i++) recordFailure('a@x', undefined, 1000)
    expect(isRateLimited('a@x', undefined, 1000)).toBe(true)
    expect(isRateLimited('a@x', undefined, 1000 + 15 * 60_000 + 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/login-rate-limit.test.ts`
Expected: FAIL ("Cannot find module './login-rate-limit'").

- [ ] **Step 3: Write the rate limiter**

```ts
// src/server/login-rate-limit.ts
// Sliding-window login throttle (in-memory — the BFF is single-process). Counts
// failed attempts per account AND per client IP before /api/auth is ever called,
// so brute force is absorbed here instead of pooling failures on the BFF's IP in
// Stalwart (auto-ban: authBanRate 100/day per source IP).
const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_ACCOUNT = 10
const MAX_PER_IP = 30

const attempts = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const list = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  attempts.set(key, list)
  return list
}

export function isRateLimited(account: string, ip: string | undefined, now = Date.now()): boolean {
  if (recent(`a:${account.toLowerCase()}`, now).length >= MAX_PER_ACCOUNT) return true
  if (ip && recent(`i:${ip}`, now).length >= MAX_PER_IP) return true
  return false
}

export function recordFailure(account: string, ip: string | undefined, now = Date.now()): void {
  recent(`a:${account.toLowerCase()}`, now).push(now)
  if (ip) recent(`i:${ip}`, now).push(now)
}

// test-only
export function __resetForTest(): void {
  attempts.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/login-rate-limit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing auth-actions test**

```ts
// src/server/auth-actions.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: () => ({ handler: (fn: unknown) => fn }),
    handler: (fn: unknown) => fn,
  }),
}))
vi.mock('./session', () => ({ login: vi.fn(), logout: vi.fn(), currentSession: vi.fn() }))
vi.mock('./session-cookie', () => ({
  assertSameOrigin: vi.fn(),
  writeSid: vi.fn(),
  clearSid: vi.fn(),
  readSid: vi.fn(),
  clientIp: vi.fn(() => '203.0.113.7'),
}))
vi.mock('./login-rate-limit', () => ({ isRateLimited: vi.fn(), recordFailure: vi.fn() }))

// eslint-disable-next-line import/first
import { login, logout, currentSession } from './session'
// eslint-disable-next-line import/first
import { assertSameOrigin, writeSid, clearSid, readSid } from './session-cookie'
// eslint-disable-next-line import/first
import { isRateLimited, recordFailure } from './login-rate-limit'
// eslint-disable-next-line import/first
import { loginHandler, logoutHandler, sessionStatusHandler } from './auth-actions'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isRateLimited).mockReturnValue(false)
  process.env.STALMAIL_PUBLIC_URL = 'https://mail.x'
})

describe('loginHandler', () => {
  it('checks CSRF, uses the fixed public URL, replaces the previous session, writes the sid', async () => {
    vi.mocked(readSid).mockReturnValue('OLD-SID')
    vi.mocked(login).mockResolvedValue({ ok: true, sid: 'SID' })
    const res = await loginHandler({ data: { email: 'a@x', password: 'pw' } })
    expect(assertSameOrigin).toHaveBeenCalledOnce()
    expect(vi.mocked(login).mock.calls[0][0]).toMatchObject({
      accountName: 'a@x', accountSecret: 'pw', redirectUri: 'https://mail.x/login',
      forwardedFor: '203.0.113.7', previousSid: 'OLD-SID',
    })
    expect(writeSid).toHaveBeenCalledWith('SID')
    expect(res).toEqual({ status: 'ok' })
  })

  it('maps failure and mfa, records the failed attempt, writes no sid', async () => {
    vi.mocked(login).mockResolvedValue({ ok: false, reason: 'failure' })
    expect(await loginHandler({ data: { email: 'a@x', password: 'pw' } })).toEqual({ status: 'invalid' })
    vi.mocked(login).mockResolvedValue({ ok: false, reason: 'mfa' })
    expect(await loginHandler({ data: { email: 'a@x', password: 'pw' } })).toEqual({ status: 'mfa' })
    expect(recordFailure).toHaveBeenCalledTimes(2)
    expect(writeSid).not.toHaveBeenCalled()
  })

  it('short-circuits with rateLimited before any Stalwart call', async () => {
    vi.mocked(isRateLimited).mockReturnValue(true)
    expect(await loginHandler({ data: { email: 'a@x', password: 'pw' } })).toEqual({ status: 'rateLimited' })
    expect(login).not.toHaveBeenCalled()
  })

  it('maps unexpected errors to a generic error status (no internals in the response)', async () => {
    vi.mocked(login).mockRejectedValue(new Error('OAuthError: /auth/token HTTP 500'))
    expect(await loginHandler({ data: { email: 'a@x', password: 'pw' } })).toEqual({ status: 'error' })
  })
})

describe('logoutHandler', () => {
  it('logs out the current sid and clears the cookie', async () => {
    vi.mocked(readSid).mockReturnValue('SID')
    expect(await logoutHandler()).toEqual({ ok: true })
    expect(logout).toHaveBeenCalledWith('SID')
    expect(clearSid).toHaveBeenCalledOnce()
  })
})

describe('sessionStatusHandler', () => {
  it('reports authenticated with the account name', async () => {
    vi.mocked(readSid).mockReturnValue('SID')
    vi.mocked(currentSession).mockReturnValue({ accountId: 'c', accountName: 'a@x' })
    expect(await sessionStatusHandler()).toEqual({ authenticated: true, accountName: 'a@x' })
  })
  it('reports unauthenticated when there is no session', async () => {
    vi.mocked(readSid).mockReturnValue(undefined)
    vi.mocked(currentSession).mockReturnValue(null)
    expect(await sessionStatusHandler()).toEqual({ authenticated: false })
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/server/auth-actions.test.ts`
Expected: FAIL ("Cannot find module './auth-actions'").

- [ ] **Step 7: Write minimal implementation**

```ts
// src/server/auth-actions.ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export type LoginStatus =
  | { status: 'ok' }
  | { status: 'invalid' }
  | { status: 'mfa' }
  | { status: 'rateLimited' }
  | { status: 'error' }

export async function loginHandler({
  data,
}: {
  data: { email: string; password: string }
}): Promise<LoginStatus> {
  const { assertSameOrigin, writeSid, readSid, clientIp } = await import('./session-cookie')
  const { login } = await import('./session')
  const { isRateLimited, recordFailure } = await import('./login-rate-limit')
  assertSameOrigin()
  const ip = clientIp()
  if (isRateLimited(data.email, ip)) return { status: 'rateLimited' }
  try {
    // Fixed public base URL — never derived from request headers (spec §7/§13):
    // no proxy-chain dependency, and https as Stalwart requires outside recovery/dev.
    const publicUrl = process.env.STALMAIL_PUBLIC_URL
    if (!publicUrl) throw new Error('STALMAIL_PUBLIC_URL is not set')
    const res = await login({
      accountName: data.email,
      accountSecret: data.password,
      redirectUri: `${publicUrl.replace(/\/+$/, '')}/login`,
      forwardedFor: ip,
      previousSid: readSid(),
    })
    if (!res.ok) {
      // mfaRequired confirms a valid password → throttle that oracle too.
      recordFailure(data.email, ip)
      return { status: res.reason === 'mfa' ? 'mfa' : 'invalid' }
    }
    writeSid(res.sid)
    return { status: 'ok' }
  } catch {
    // Never leak internals (OAuthError, Stalwart HTTP codes) in the network response.
    return { status: 'error' }
  }
}

const loginSchema = z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(1024) })

export const loginFn = createServerFn({ method: 'POST' })
  .validator((d: { email: string; password: string }) => loginSchema.parse(d))
  .handler(loginHandler)

export async function logoutHandler(): Promise<{ ok: true }> {
  const { readSid, clearSid, assertSameOrigin } = await import('./session-cookie')
  const { logout } = await import('./session')
  assertSameOrigin()
  const sid = readSid()
  if (sid) logout(sid)
  clearSid()
  return { ok: true }
}

export const logoutFn = createServerFn({ method: 'POST' }).handler(logoutHandler)

export type SessionStatus = { authenticated: false } | { authenticated: true; accountName: string }

export async function sessionStatusHandler(): Promise<SessionStatus> {
  const { readSid } = await import('./session-cookie')
  const { currentSession } = await import('./session')
  const s = currentSession(readSid())
  return s ? { authenticated: true, accountName: s.accountName } : { authenticated: false }
}

export const sessionStatusFn = createServerFn({ method: 'GET' }).handler(sessionStatusHandler)
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/server/auth-actions.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Commit**

```bash
git add src/server/login-rate-limit.ts src/server/login-rate-limit.test.ts \
        src/server/auth-actions.ts src/server/auth-actions.test.ts
git commit -m "feat(auth): BFF login rate-limit + loginFn/logoutFn/sessionStatusFn"
```

---

## Task 9: i18n login strings

**Files:**
- Modify: `src/i18n/resources.ts`
- Test: `src/i18n/resources.test.ts` (existing — extend with a fr/en parity assertion if present; otherwise the login.test in Task 10 covers usage)

- [ ] **Step 1: Add the `login` namespace to the `fr` object**

In `src/i18n/resources.ts`, inside `export const fr = { ... }`, add a sibling key to `wizard`:

```ts
  login: {
    title: 'Connexion',
    subtitle: 'Connectez-vous à votre boîte Stalmail.',
    email: 'Adresse e-mail',
    emailPlaceholder: 'vous@exemple.fr',
    password: 'Mot de passe',
    submit: 'Se connecter',
    signingIn: 'Connexion…',
    invalid: 'Adresse e-mail ou mot de passe invalide.',
    mfa: "L'authentification à deux facteurs n'est pas encore prise en charge.",
    rateLimited: 'Trop de tentatives. Réessayez dans quelques minutes.',
    error: 'Connexion impossible. Réessayez.',
  },
```

- [ ] **Step 2: Add the matching `login` namespace to the `en` object**

```ts
  login: {
    title: 'Sign in',
    subtitle: 'Sign in to your Stalmail inbox.',
    email: 'Email address',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    submit: 'Sign in',
    signingIn: 'Signing in…',
    invalid: 'Invalid email or password.',
    mfa: 'Two-factor authentication is not supported yet.',
    rateLimited: 'Too many attempts. Try again in a few minutes.',
    error: 'Could not sign in. Please try again.',
  },
```

- [ ] **Step 3: Run the i18n tests + typecheck**

Run: `npx vitest run src/i18n && npx tsc --noEmit`
Expected: PASS. (If `resources.test.ts` asserts fr/en key parity, both namespaces match.)

- [ ] **Step 4: Commit**

```bash
git add src/i18n/resources.ts
git commit -m "feat(i18n): login namespace (fr + en)"
```

---

## Task 10: Login route / form

**Files:**
- Modify: `src/routes/login.tsx`
- Test: `src/routes/login.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/routes/login.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  useRouter: () => ({ navigate }),
}))
vi.mock('@/server/auth-actions', () => ({ loginFn: vi.fn() }))

// eslint-disable-next-line import/first
import { loginFn } from '@/server/auth-actions'
// eslint-disable-next-line import/first
import { LoginPage } from './login'

const wrap = () =>
  render(
    <I18nextProvider i18n={createI18n('fr')}>
      <LoginPage />
    </I18nextProvider>,
  )

beforeEach(() => vi.clearAllMocks())

describe('LoginPage', () => {
  it('navigates to the inbox after a successful login', async () => {
    vi.mocked(loginFn).mockResolvedValue({ status: 'ok' })
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/mail/$folder', params: { folder: 'inbox' } }),
    )
    expect(loginFn).toHaveBeenCalledWith({ data: { email: 'a@x.fr', password: 'pw' } })
  })

  it('shows the invalid-credentials error', async () => {
    vi.mocked(loginFn).mockResolvedValue({ status: 'invalid' })
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('invalide')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('shows the 2FA-not-supported message on mfa', async () => {
    vi.mocked(loginFn).mockResolvedValue({ status: 'mfa' })
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('deux facteurs')
  })

  it('shows the rate-limited message', async () => {
    vi.mocked(loginFn).mockResolvedValue({ status: 'rateLimited' })
    wrap()
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'a@x.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routes/login.test.tsx`
Expected: FAIL (no `LoginPage` export / placeholder component).

- [ ] **Step 3: Replace the placeholder with the form**

```tsx
// src/routes/login.tsx
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { loginFn } from '@/server/auth-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

export function LoginPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await loginFn({ data: { email, password } })
      if (res.status === 'ok') {
        await router.navigate({ to: '/mail/$folder', params: { folder: 'inbox' } })
        return
      }
      setError(
        res.status === 'mfa'
          ? t('login.mfa')
          : res.status === 'rateLimited'
            ? t('login.rateLimited')
            : res.status === 'invalid'
              ? t('login.invalid')
              : t('login.error'),
      )
    } catch {
      setError(t('login.error'))
    }
    setBusy(false)
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{t('login.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('login.subtitle')}</p>
        </div>
        {error && (
          <div role="alert" className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('login.email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            placeholder={t('login.emailPlaceholder')}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('login.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('login.signingIn') : t('login.submit')}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/routes/login.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/login.tsx src/routes/login.test.tsx
git commit -m "feat(auth): login form wired to loginFn"
```

---

## Task 11: Auth guard + protect /mail

**Files:**
- Create: `src/lib/auth-guard.ts`
- Test: `src/lib/auth-guard.test.ts`
- Modify: `src/routes/mail/$folder.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth-guard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn((opts: unknown) => ({ __redirect: opts }))
vi.mock('@tanstack/react-router', () => ({ redirect }))
vi.mock('@/server/auth-actions', () => ({ sessionStatusFn: vi.fn() }))

// eslint-disable-next-line import/first
import { sessionStatusFn } from '@/server/auth-actions'
// eslint-disable-next-line import/first
import { requireAuth } from './auth-guard'

beforeEach(() => vi.clearAllMocks())

describe('requireAuth', () => {
  it('returns the account name when authenticated', async () => {
    vi.mocked(sessionStatusFn).mockResolvedValue({ authenticated: true, accountName: 'a@x' })
    expect(await requireAuth()).toEqual({ accountName: 'a@x' })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('throws a redirect to /login when unauthenticated', async () => {
    vi.mocked(sessionStatusFn).mockResolvedValue({ authenticated: false })
    await expect(requireAuth()).rejects.toMatchObject({ __redirect: { to: '/login' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth-guard.test.ts`
Expected: FAIL ("Cannot find module './auth-guard'").

- [ ] **Step 3: Write the guard**

```ts
// src/lib/auth-guard.ts
import { redirect } from '@tanstack/react-router'
import { sessionStatusFn } from '@/server/auth-actions'

// Use in a route `beforeLoad`. Runs the status server fn; bounces to /login if unauthenticated.
export async function requireAuth(): Promise<{ accountName: string }> {
  const status = await sessionStatusFn()
  if (!status.authenticated) throw redirect({ to: '/login' })
  return { accountName: status.accountName }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth-guard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Protect the mail route**

Replace `src/routes/mail/$folder.tsx` with:

```tsx
// src/routes/mail/$folder.tsx
import { createFileRoute } from '@tanstack/react-router'
import { requireAuth } from '@/lib/auth-guard'

export const Route = createFileRoute('/mail/$folder')({
  beforeLoad: () => requireAuth(),
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

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS (all existing + new tests; no type errors).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth-guard.ts src/lib/auth-guard.test.ts src/routes/mail/$folder.tsx
git commit -m "feat(auth): requireAuth guard protecting /mail/*"
```

---

## Task 12: Compose env + app data volume + Stalwart `useXForwarded`

**Files:**
- Create: `src/server/stalwart-hardening.ts`
- Test: `src/server/stalwart-hardening.test.ts`
- Modify: `src/server/setup-actions.ts` (+ son test)
- Modify: `compose.yml`
- Modify: `compose.dev.yml`

The BFF already forwards the client IP to `/api/auth` (Task 4/8). This task provisions the app's persistent session store, the secret used to encrypt tokens, the fixed public URL — **and enables `server.http.use-x-forwarded` on Stalwart**. The latter is a **go-live condition** (spec §9): without it, every `/api/auth` failure pools on the BFF's IP and ~100 bad passwords (auto-ban `authBanRate` default) get the BFF banned **for everyone**. It must run during the wizard finalize, while the recovery admin is still active (it is dropped at the next restart).

- [ ] **Step 1: Write the failing stalwart-hardening test**

```ts
// src/server/stalwart-hardening.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./jmap', () => ({
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'acc'),
  firstResponse: (r: unknown[][]) => r[0],
  JmapError: class JmapError extends Error {},
}))

// eslint-disable-next-line import/first
import { jmapCall } from './jmap'
// eslint-disable-next-line import/first
import { enableXForwarded } from './stalwart-hardening'

beforeEach(() => vi.clearAllMocks())

describe('enableXForwarded', () => {
  it('sets useXForwarded:true on the Http singleton', async () => {
    vi.mocked(jmapCall).mockResolvedValue([
      ['x:Http/set', { updated: { singleton: {} } }, '0'],
    ])
    await enableXForwarded()
    const [calls] = vi.mocked(jmapCall).mock.calls[0]
    expect(calls[0][0]).toBe('x:Http/set')
    expect(calls[0][1]).toMatchObject({ update: { singleton: { useXForwarded: true } } })
  })

  it('throws when the update is rejected', async () => {
    vi.mocked(jmapCall).mockResolvedValue([['error', { type: 'forbidden' }, '0']])
    await expect(enableXForwarded()).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/stalwart-hardening.test.ts`
Expected: FAIL ("Cannot find module './stalwart-hardening'").

- [ ] **Step 3: Write the hardening module**

```ts
// src/server/stalwart-hardening.ts
import { jmapCall, resolveAccountId, firstResponse, JmapError } from './jmap'

// Stalwart only honours X-Forwarded-For when the Http singleton's useXForwarded is
// on. Without it, every /api/auth failure pools on the BFF's IP → auto-ban of the
// BFF for all users (authBanRate default 100/day). Must run while the recovery
// admin is still active, i.e. during the wizard, before markSetupComplete().
export async function enableXForwarded(): Promise<void> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Http/set', { accountId, update: { singleton: { useXForwarded: true } } }, '0'],
  ])
  const [name, result] = firstResponse(responses)
  const updated = (result as { updated?: Record<string, unknown> }).updated
  if (name === 'error' || !updated || !('singleton' in updated)) {
    throw new JmapError('failed to enable useXForwarded', result)
  }
}
```

(Adapter les signatures exactes à `src/server/jmap.ts` — même idiome que `x:AcmeProvider/set` dans `stalwart-acme.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/stalwart-hardening.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire it into the wizard finalize**

Dans `src/server/setup-actions.ts`, `finishSetupHandler()` appelle `enableXForwarded()` **avant** `markSetupComplete()` :

```ts
export async function finishSetupHandler(): Promise<{ ok: true }> {
  const { enableXForwarded } = await import('./stalwart-hardening')
  const { markSetupComplete } = await import('./setup-flag')
  await enableXForwarded() // go-live condition — recovery admin still active here
  markSetupComplete()
  // … reste inchangé …
}
```

Étendre `src/server/setup-actions.test.ts` : `finishSetupHandler` appelle `enableXForwarded` avant `markSetupComplete`, et **ne marque pas** le setup complet si `enableXForwarded` rejette. (Note migration : les installations déjà finalisées avant ce changement doivent activer le réglage via la WebUI Stalwart — documenté, hors scope du code.)

Run: `npx vitest run src/server/setup-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Add env + volume to the `app` service in `compose.yml`**

Under the `app` service `environment:` block (next to `STALWART_URL`/`STALWART_RECOVERY_ADMIN`), add:

```yaml
      STALMAIL_SECRET: "${STALMAIL_SECRET:?set STALMAIL_SECRET in .env}"
      STALMAIL_DATA_DIR: /var/lib/stalmail
      STALMAIL_PUBLIC_URL: "${STALMAIL_PUBLIC_URL:?set STALMAIL_PUBLIC_URL in .env (e.g. https://mail.example.com)}"
      NODE_ENV: production
```

Under the `app` service `volumes:` block, add a line:

```yaml
      - stalmail-app-data:/var/lib/stalmail
```

Under the top-level `volumes:` block, add:

```yaml
  stalmail-app-data:
```

- [ ] **Step 7: Mirror in `compose.dev.yml`**

Add the same `STALMAIL_SECRET` and `STALMAIL_DATA_DIR: /var/lib/stalmail` env to the dev `app` service, plus `STALMAIL_PUBLIC_URL: http://localhost:3000` (http toléré en dev uniquement ; en prod https, aligné sur la doc Stalwart — cf. spec §7/§16), the `- stalmail-app-data:/var/lib/stalmail` volume and the top-level `stalmail-app-data:` volume. Do **not** set `NODE_ENV: production` in dev (cookies stay non-`__Host-`/non-Secure over http, per `session-cookie.ts`).

- [ ] **Step 8: Validate compose files parse**

Run: `docker compose -f compose.yml config >/dev/null && docker compose -f compose.dev.yml config >/dev/null && echo OK`
Expected: `OK` (no YAML/interpolation errors; `STALMAIL_SECRET` and `STALMAIL_PUBLIC_URL` must be present in `.env`).

- [ ] **Step 9: Commit**

```bash
git add src/server/stalwart-hardening.ts src/server/stalwart-hardening.test.ts \
        src/server/setup-actions.ts src/server/setup-actions.test.ts \
        compose.yml compose.dev.yml
git commit -m "feat(auth): enable Stalwart useXForwarded at wizard finalize + compose env (PUBLIC_URL, DATA_DIR, app-data volume)"
```

---

## Task 13: Final gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green (existing 193 + the new auth/session tests).

- [ ] **Step 2: Run lint + typecheck**

Run: `npx eslint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Sanity self-check of the end-to-end flow (read-through, no code)**

Confirm by reading the code that the login path is whole:
`login.tsx` → `loginFn` → `loginHandler` (CSRF Origin/Referer + rate-limit + `STALMAIL_PUBLIC_URL` + clientIp + previousSid) → `session.login` (sweep → PKCE → `postApiAuth` → `exchangeCode` → `fetchJmapAccount` → store keyed by `hashSid`) → `writeSid`; and that `/mail/$folder` `beforeLoad` → `requireAuth` → `sessionStatusFn` → `currentSession`. Logout: `logoutFn` → `logoutHandler` → `logout` + `clearSid`. Wizard finalize: `finishSetupHandler` → `enableXForwarded` **avant** `markSetupComplete`.

- [ ] **Step 3b: Security gate (read-through, no code)**

Vérifier que les invariants de la revue sécurité (`docs/superpowers/reviews/2026-06-11-plan-3a-security-review.md`) tiennent dans le code livré : aucun `sid` en clair hors cookie ; aucun fallback de `STALMAIL_SECRET` ; `redirect_uri` jamais dérivé des headers ; refresh sous mutex ; `recordFailure` appelé sur tout échec ; aucune erreur interne dans les réponses réseau.

- [ ] **Step 4: Commit (no-op marker if everything was already committed)**

```bash
git commit --allow-empty -m "chore(auth): Plan 3a complete — full suite + typecheck green"
```

---

## Out of scope (deferred)

- JMAP user-scoped server functions (queryEmails/getThread/setEmail/sendEmail/search), SSE/live mail → Plan 4 (UI-driven).
- 2FA TOTP entry UI (only `mfaRequired` detection here) → deferred.
- `logoutAllForAccount` trigger UI ("sign out everywhere") → Plan 4 / settings (the store helper exists, see `session.ts`).
- Caddyfile : vérifier/documenter que Caddy écrase les `X-Forwarded-*` entrants (`trusted_proxies` — défaut sûr, à confirmer) → suivi infra (spec §8/§9).
- **Éclaircir la divergence doc ↔ capture** sur l'exigence https du `redirect_uri` (capture §10 en mode normal : http accepté ; doc Stalwart : https exigé hors recovery/dev) + question ouverte : Stalwart invalide-t-il les tokens au changement de mot de passe ? (spec §16) → avant mise en service / Plan 4.
- App Passwords, external OIDC, multi-account → later.
