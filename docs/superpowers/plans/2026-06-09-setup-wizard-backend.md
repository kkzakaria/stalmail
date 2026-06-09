# Setup Wizard Backend (Plan 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side capability to drive a fresh Stalwart v0.16 instance through first-run setup (bootstrap → restart → normal-mode config), exposed as server functions, with no wizard UI yet.

**Architecture:** A thin JMAP-management client (`urn:stalwart:jmap` over `POST /jmap/`) layered on the existing `stalwartAdminFetch`. Focused modules per concern (bootstrap, domain, account, dns, zone-file parsing, state derivation). The entrypoint is corrected to the v0.16 bootstrap model with a Stalwart supervisor that the BFF can ask to restart. State is derived from the live Stalwart objects — no separate wizard state.

**Tech Stack:** TypeScript (Node), TanStack Start server functions, Vitest (server project, `src/server/**/*.test.ts`), Node `dns/promises`, Bash (entrypoint).

**Reference specs:**
- Design: `docs/superpowers/specs/2026-06-09-setup-wizard-design.md`
- API capture (real payloads / fixtures): `docs/superpowers/specs/2026-06-09-stalwart-api-capture.md`

**Existing code this builds on:**
- `src/server/stalwart.ts` — `stalwartAdminFetch(path, init)`, `stalwartHealthy()`.
- `src/server/setup-flag.ts` — `isSetupComplete()`, `markSetupComplete()`.
- Test pattern: `vi.stubGlobal('fetch', mockFetch)` then import; server tests run under the `server` Vitest project (node env).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/server/jmap.ts` | Generic JMAP-management transport: build envelope, POST `/jmap/`, resolve management `accountId`, classify errors (incl. bootstrap `forbidden`). |
| `src/server/jmap.test.ts` | Tests for the transport. |
| `src/server/dns-zone.ts` | Parse `Domain.dnsZoneFile` text into structured records. |
| `src/server/dns-zone.test.ts` | Parser tests (real zone fixture). |
| `src/server/stalwart-bootstrap.ts` | `isBootstrapMode()`, `getBootstrap()`, `submitBootstrap()`. |
| `src/server/stalwart-bootstrap.test.ts` | Bootstrap tests. |
| `src/server/stalwart-domain.ts` | `getPrimaryDomain()`, `setDnsManagementAutomatic()`. |
| `src/server/stalwart-domain.test.ts` | Domain tests. |
| `src/server/stalwart-account.ts` | `createAdminAccount()`. |
| `src/server/stalwart-account.test.ts` | Account tests (incl. weak-password). |
| `src/server/stalwart-dns.ts` | `createDnsServer()`, `DNS_PROVIDERS` list. |
| `src/server/stalwart-dns.test.ts` | DnsServer tests. |
| `src/server/dns-resolve.ts` | `resolveRecordStatus()` — BFF-side DNS check for the grid. |
| `src/server/dns-resolve.test.ts` | Resolution tests (mocked `dns/promises`). |
| `src/server/stalwart-restart.ts` | `requestStalwartRestart()` — touch the restart sentinel. |
| `src/server/stalwart-restart.test.ts` | Restart-trigger tests. |
| `src/server/setup-state.ts` | `deriveSetupStep()` — current wizard step from live state. |
| `src/server/setup-state.test.ts` | State-derivation tests. |
| `src/server/setup-actions.ts` | TanStack server functions wrapping the above (consumed by Plan 2b UI). |
| `src/server/setup-actions.test.ts` | Server-function handler tests. |
| `entrypoint.sh` (modify) | v0.16 bootstrap model + Stalwart supervisor + restart sentinel. |

---

## Task 1: JMAP management transport (`src/server/jmap.ts`)

**Files:**
- Create: `src/server/jmap.ts`
- Test: `src/server/jmap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/jmap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// eslint-disable-next-line import/first
import { jmapCall, resolveAccountId, isBootstrapForbidden, JmapError, _resetAccountIdCache } from './jmap'

const okJson = (body: unknown) => ({ ok: true, json: async () => body })

describe('resolveAccountId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetAccountIdCache() // resolveAccountId memoises; reset between cases
    process.env.STALWART_URL = 'http://localhost:8080'
    process.env.STALWART_RECOVERY_ADMIN = 'stalmail-admin:test'
  })

  it('reads primaryAccounts[urn:stalwart:jmap] from the session', async () => {
    mockFetch.mockResolvedValue(
      okJson({ primaryAccounts: { 'urn:stalwart:jmap': 'd333333' } }),
    )
    expect(await resolveAccountId()).toBe('d333333')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/jmap/session',
      expect.any(Object),
    )
  })

  it('throws when the management capability is absent', async () => {
    mockFetch.mockResolvedValue(okJson({ primaryAccounts: {} }))
    await expect(resolveAccountId()).rejects.toThrow(/management account/i)
  })
})

describe('jmapCall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STALWART_URL = 'http://localhost:8080'
    process.env.STALWART_RECOVERY_ADMIN = 'stalmail-admin:test'
  })

  it('posts the JMAP envelope to /jmap/ and returns the method result', async () => {
    mockFetch.mockResolvedValue(
      okJson({
        methodResponses: [['x:Bootstrap/get', { list: [{ id: 'singleton' }] }, '0']],
        sessionState: 's1',
      }),
    )
    const res = await jmapCall([['x:Bootstrap/get', { ids: null }, '0']])
    expect(res).toEqual([['x:Bootstrap/get', { list: [{ id: 'singleton' }] }, '0']])
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }]
    expect(url).toBe('http://localhost:8080/jmap/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      using: ['urn:stalwart:jmap'],
      methodCalls: [['x:Bootstrap/get', { ids: null }, '0']],
    })
  })

  it('throws JmapError when an HTTP error occurs', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    await expect(jmapCall([['x:Bootstrap/get', {}, '0']])).rejects.toBeInstanceOf(JmapError)
  })
})

describe('isBootstrapForbidden', () => {
  it('detects the bootstrap-mode forbidden error', () => {
    expect(
      isBootstrapForbidden({
        type: 'forbidden',
        description: "The server is in bootstrap mode. Only the 'Bootstrap' object type can be accessed until the bootstrap process is complete.",
      }),
    ).toBe(true)
  })
  it('is false for other errors', () => {
    expect(isBootstrapForbidden({ type: 'unknownMethod', description: 'x' })).toBe(false)
    expect(isBootstrapForbidden(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/jmap.test.ts`
Expected: FAIL — `Cannot find module './jmap'` / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/jmap.ts
import { stalwartAdminFetch } from './stalwart'

export const MANAGEMENT_CAPABILITY = 'urn:stalwart:jmap'

export type JmapMethodCall = [string, Record<string, unknown>, string]
export type JmapMethodResponse = [string, Record<string, unknown>, string]

export class JmapError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'JmapError'
  }
}

export interface JmapErrorBody {
  type: string
  description?: string
}

export function isBootstrapForbidden(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as JmapErrorBody
  return e.type === 'forbidden' && /bootstrap mode/i.test(e.description ?? '')
}

let cachedAccountId: string | undefined

export async function resolveAccountId(force = false): Promise<string> {
  if (cachedAccountId && !force) return cachedAccountId
  const res = await stalwartAdminFetch('/jmap/session', { method: 'GET' })
  if (!res.ok) throw new JmapError(`session request failed: HTTP ${res.status}`)
  const session = (await res.json()) as {
    primaryAccounts?: Record<string, string>
  }
  const id = session.primaryAccounts?.[MANAGEMENT_CAPABILITY]
  if (!id) throw new JmapError('no management account in session')
  cachedAccountId = id
  return id
}

export async function jmapCall(
  methodCalls: JmapMethodCall[],
): Promise<JmapMethodResponse[]> {
  const res = await stalwartAdminFetch('/jmap/', {
    method: 'POST',
    body: JSON.stringify({ using: [MANAGEMENT_CAPABILITY], methodCalls }),
  })
  if (!res.ok) throw new JmapError(`jmap request failed: HTTP ${res.status}`)
  const body = (await res.json()) as { methodResponses?: JmapMethodResponse[] }
  return body.methodResponses ?? []
}

// test-only: reset the cached account id between tests if needed
export function _resetAccountIdCache(): void {
  cachedAccountId = undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/jmap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/jmap.ts src/server/jmap.test.ts
git commit -m "feat(setup): add JMAP management transport client"
```

---

## Task 2: dnsZoneFile parser (`src/server/dns-zone.ts`)

The zone file uses BIND master-file syntax, including multi-line TXT records wrapped in `( ... )` with several quoted strings that must be concatenated (DKIM RSA key). The parser must collapse those.

**Files:**
- Create: `src/server/dns-zone.ts`
- Test: `src/server/dns-zone.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/dns-zone.test.ts
import { describe, it, expect } from 'vitest'
import { parseZoneFile } from './dns-zone'

// Real fragment captured from a Stalwart v0.16 Domain.dnsZoneFile (spike.test).
const ZONE = `v1-ed25519-20260609._domainkey.spike.test. IN TXT "v=DKIM1; k=ed25519; h=sha256; p=StaTKnFk94rQvROcjVy//KbEaJce9DI5FJNVmz1fXOE="
v1-rsa-20260609._domainkey.spike.test. IN TXT (
    "v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkqAAA"
    "kKFFwjGWtnHN0WIDAQAB"
)
mail.spike.test. IN TXT "v=spf1 a -all"
spike.test. IN TXT "v=spf1 mx -all"
spike.test. IN MX 10 mail.spike.test.
_dmarc.spike.test. IN TXT "v=DMARC1; p=reject; rua=mailto:postmaster@spike.test"
_imaps._tcp.spike.test. IN SRV 0 1 993 mail.spike.test.`

describe('parseZoneFile', () => {
  it('parses each record into {name, type, value}', () => {
    const records = parseZoneFile(ZONE)
    expect(records).toHaveLength(7)
    expect(records[4]).toEqual({
      name: 'spike.test.',
      type: 'MX',
      value: '10 mail.spike.test.',
    })
  })

  it('concatenates multi-line parenthesised TXT into one value', () => {
    const rsa = parseZoneFile(ZONE).find((r) => r.name.startsWith('v1-rsa'))
    expect(rsa?.type).toBe('TXT')
    expect(rsa?.value).toBe('v=DKIM1; k=rsa; h=sha256; p=MIIBIjANBgkqAAAkKFFwjGWtnHN0WIDAQAB')
  })

  it('classifies records by mail record type', () => {
    const records = parseZoneFile(ZONE)
    expect(records.filter((r) => r.type === 'TXT')).toHaveLength(5)
    expect(records.filter((r) => r.type === 'SRV')).toHaveLength(1)
  })

  it('ignores blank lines and comments', () => {
    expect(parseZoneFile('\n; a comment\n   \n')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/dns-zone.test.ts`
Expected: FAIL — `parseZoneFile` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/dns-zone.ts
export interface ZoneRecord {
  name: string
  type: string
  value: string
}

const TYPES = new Set(['TXT', 'MX', 'SRV', 'CNAME', 'A', 'AAAA', 'CAA', 'NS', 'TLSA'])

// Join the quoted character-strings inside a TXT rdata into one logical value.
function joinTxt(rdata: string): string {
  const quoted = rdata.match(/"([^"]*)"/g)
  if (quoted) return quoted.map((q) => q.slice(1, -1)).join('')
  return rdata.trim()
}

export function parseZoneFile(text: string): ZoneRecord[] {
  const records: ZoneRecord[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';')) continue

    // Collapse a parenthesised multi-line rdata into a single line.
    if (line.includes('(') && !line.includes(')')) {
      const buf = [line]
      while (i + 1 < lines.length && !lines[i + 1].includes(')')) {
        buf.push(lines[++i])
      }
      if (i + 1 < lines.length) buf.push(lines[++i])
      line = buf.join(' ').replace(/[()]/g, ' ')
    }

    // <name> IN <TYPE> <rdata...>
    const m = line.match(/^(\S+)\s+IN\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const [, name, type, rawRdata] = m
    if (!TYPES.has(type)) continue
    const value = type === 'TXT' ? joinTxt(rawRdata) : rawRdata.trim()
    records.push({ name, type, value })
  }
  return records
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/dns-zone.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/dns-zone.ts src/server/dns-zone.test.ts
git commit -m "feat(setup): parse Stalwart dnsZoneFile into structured records"
```

---

## Task 3: Bootstrap operations (`src/server/stalwart-bootstrap.ts`)

**Files:**
- Create: `src/server/stalwart-bootstrap.ts`
- Test: `src/server/stalwart-bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/stalwart-bootstrap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./jmap', () => ({
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'd333333'),
  isBootstrapForbidden: vi.fn(),
}))

import { jmapCall, isBootstrapForbidden } from './jmap'
import { isBootstrapMode, getBootstrap, submitBootstrap } from './stalwart-bootstrap'

const mj = vi.mocked(jmapCall)
const mf = vi.mocked(isBootstrapForbidden)

beforeEach(() => vi.clearAllMocks())

describe('isBootstrapMode', () => {
  it('returns true when probing a domain yields the bootstrap forbidden error', async () => {
    mj.mockResolvedValue([['error', { type: 'forbidden', description: 'bootstrap mode' }, '0']])
    mf.mockReturnValue(true)
    expect(await isBootstrapMode()).toBe(true)
  })

  it('returns false when x:Domain/query succeeds (normal mode)', async () => {
    mj.mockResolvedValue([['x:Domain/query', { ids: ['b'] }, '0']])
    mf.mockReturnValue(false)
    expect(await isBootstrapMode()).toBe(false)
  })
})

describe('getBootstrap', () => {
  it('returns the singleton object', async () => {
    mj.mockResolvedValue([
      ['x:Bootstrap/get', { list: [{ id: 'singleton', defaultDomain: 'example.org' }] }, '0'],
    ])
    expect(await getBootstrap()).toEqual({ id: 'singleton', defaultDomain: 'example.org' })
  })
})

describe('submitBootstrap', () => {
  it('updates the singleton and returns the generated admin credentials', async () => {
    mj.mockResolvedValue([
      ['x:Bootstrap/set', { updated: { singleton: { username: 'admin@exemple.fr', secret: 'gen' } } }, '0'],
    ])
    const out = await submitBootstrap({
      serverHostname: 'mail.exemple.fr',
      defaultDomain: 'exemple.fr',
    })
    expect(out).toEqual({ username: 'admin@exemple.fr', secret: 'gen' })
    const [[, args]] = mj.mock.calls[0][0] as [[string, Record<string, unknown>, string]]
    expect(args.update).toEqual({
      singleton: {
        serverHostname: 'mail.exemple.fr',
        defaultDomain: 'exemple.fr',
        requestTlsCertificate: false,
        generateDkimKeys: true,
        directory: { '@type': 'Internal' },
        dnsServer: { '@type': 'Manual' },
      },
    })
  })

  it('throws when the set is rejected', async () => {
    mj.mockResolvedValue([['x:Bootstrap/set', { notUpdated: { singleton: { type: 'invalidProperties' } } }, '0']])
    await expect(
      submitBootstrap({ serverHostname: 'h', defaultDomain: 'd' }),
    ).rejects.toThrow(/bootstrap/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/stalwart-bootstrap.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/stalwart-bootstrap.ts
import {
  jmapCall,
  resolveAccountId,
  isBootstrapForbidden,
  JmapError,
} from './jmap'

export interface BootstrapInput {
  serverHostname: string
  defaultDomain: string
}

export interface GeneratedAdmin {
  username: string
  secret: string
}

export async function isBootstrapMode(): Promise<boolean> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([['x:Domain/query', { accountId }, '0']])
  const [name, result] = responses[0]
  if (name === 'error' && isBootstrapForbidden(result)) return true
  return false
}

export async function getBootstrap(): Promise<Record<string, unknown>> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Bootstrap/get', { accountId, ids: null }, '0'],
  ])
  const result = responses[0][1] as { list?: Record<string, unknown>[] }
  const obj = result.list?.[0]
  if (!obj) throw new JmapError('bootstrap singleton not found')
  return obj
}

export async function submitBootstrap(
  input: BootstrapInput,
): Promise<GeneratedAdmin> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      'x:Bootstrap/set',
      {
        accountId,
        update: {
          singleton: {
            serverHostname: input.serverHostname,
            defaultDomain: input.defaultDomain,
            requestTlsCertificate: false, // ACME triggered after DNS, in normal mode
            generateDkimKeys: true,
            directory: { '@type': 'Internal' },
            dnsServer: { '@type': 'Manual' },
          },
        },
      },
      '0',
    ],
  ])
  const result = responses[0][1] as {
    updated?: { singleton?: GeneratedAdmin }
    notUpdated?: unknown
  }
  const admin = result.updated?.singleton
  if (!admin) {
    throw new JmapError('bootstrap submission rejected', result.notUpdated)
  }
  return admin
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/stalwart-bootstrap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/stalwart-bootstrap.ts src/server/stalwart-bootstrap.test.ts
git commit -m "feat(setup): add bootstrap detection, read and submit"
```

---

## Task 4: Stalwart restart trigger (`src/server/stalwart-restart.ts`)

After `submitBootstrap`, the Stalwart process must be restarted to enter normal mode. The BFF cannot signal Stalwart's PID directly (separate process), so it touches a **sentinel file**; the entrypoint supervisor (Task 9) watches it and restarts Stalwart.

**Files:**
- Create: `src/server/stalwart-restart.ts`
- Test: `src/server/stalwart-restart.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/stalwart-restart.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const writeFileSync = vi.fn()
vi.mock('node:fs', () => ({ writeFileSync: (...a: unknown[]) => writeFileSync(...a) }))

import { requestStalwartRestart, RESTART_SENTINEL } from './stalwart-restart'

beforeEach(() => vi.clearAllMocks())

describe('requestStalwartRestart', () => {
  it('writes the restart sentinel file', () => {
    requestStalwartRestart()
    expect(writeFileSync).toHaveBeenCalledWith(RESTART_SENTINEL, expect.any(String), 'utf-8')
  })

  it('honours STALMAIL_RUN_DIR override', () => {
    process.env.STALMAIL_RUN_DIR = '/tmp/run'
    requestStalwartRestart()
    expect(writeFileSync).toHaveBeenCalledWith('/tmp/run/restart-stalwart', expect.any(String), 'utf-8')
    delete process.env.STALMAIL_RUN_DIR
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/stalwart-restart.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/stalwart-restart.ts
import { writeFileSync } from 'node:fs'

function runDir(): string {
  return process.env.STALMAIL_RUN_DIR ?? '/run/stalmail'
}

export const RESTART_SENTINEL = `${process.env.STALMAIL_RUN_DIR ?? '/run/stalmail'}/restart-stalwart`

export function requestStalwartRestart(): void {
  writeFileSync(`${runDir()}/restart-stalwart`, String(Date.now()), 'utf-8')
}
```

> Note: `RESTART_SENTINEL` is exported for the test; `requestStalwartRestart` recomputes
> the path so a per-test `STALMAIL_RUN_DIR` override is honoured.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/stalwart-restart.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/stalwart-restart.ts src/server/stalwart-restart.test.ts
git commit -m "feat(setup): add Stalwart restart sentinel trigger"
```

---

## Task 5: Domain operations (`src/server/stalwart-domain.ts`)

**Files:**
- Create: `src/server/stalwart-domain.ts`
- Test: `src/server/stalwart-domain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/stalwart-domain.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./jmap', () => ({
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'd333333'),
}))

import { jmapCall } from './jmap'
import { getPrimaryDomain, setDnsManagementAutomatic } from './stalwart-domain'

const mj = vi.mocked(jmapCall)
beforeEach(() => vi.clearAllMocks())

describe('getPrimaryDomain', () => {
  it('queries then gets the first domain (with dnsZoneFile)', async () => {
    mj.mockResolvedValue([
      ['x:Domain/query', { ids: ['b'] }, '0'],
      ['x:Domain/get', { list: [{ id: 'b', name: 'exemple.fr', dnsZoneFile: 'spike. IN MX 10 mail.' }] }, '1'],
    ])
    const d = await getPrimaryDomain()
    expect(d).toEqual({ id: 'b', name: 'exemple.fr', dnsZoneFile: 'spike. IN MX 10 mail.' })
    // back-reference wiring
    const calls = mj.mock.calls[0][0]
    expect(calls[1][0]).toBe('x:Domain/get')
    expect((calls[1][1] as Record<string, unknown>)['#ids']).toEqual({
      resultOf: '0', name: 'x:Domain/query', path: '/ids',
    })
  })

  it('returns null when no domain exists', async () => {
    mj.mockResolvedValue([
      ['x:Domain/query', { ids: [] }, '0'],
      ['x:Domain/get', { list: [] }, '1'],
    ])
    expect(await getPrimaryDomain()).toBeNull()
  })
})

describe('setDnsManagementAutomatic', () => {
  it('updates the domain dnsManagement to Automatic with the dns server id', async () => {
    mj.mockResolvedValue([['x:Domain/set', { updated: { b: null } }, '0']])
    await setDnsManagementAutomatic('b', 'srv1', 'exemple.fr')
    const [[, args]] = mj.mock.calls[0][0] as [[string, Record<string, unknown>, string]]
    expect(args.update).toEqual({
      b: {
        dnsManagement: {
          '@type': 'Automatic',
          dnsServerId: 'srv1',
          origin: 'exemple.fr',
          publishRecords: ['dkim', 'spf', 'mx', 'dmarc', 'srv', 'mtaSts', 'tlsRpt', 'caa', 'autoConfig', 'autoConfigLegacy', 'autoDiscover'],
        },
      },
    })
  })

  it('throws when the update is rejected', async () => {
    mj.mockResolvedValue([['x:Domain/set', { notUpdated: { b: { type: 'forbidden' } } }, '0']])
    await expect(setDnsManagementAutomatic('b', 'srv1', 'exemple.fr')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/stalwart-domain.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/stalwart-domain.ts
import { jmapCall, resolveAccountId, JmapError } from './jmap'

export interface StalwartDomain {
  id: string
  name: string
  dnsZoneFile?: string
  dnsManagement?: { '@type': string; [k: string]: unknown }
  [k: string]: unknown
}

// Default record set Stalwart publishes (DnsRecordType enum, minus tlsa).
export const DEFAULT_PUBLISH_RECORDS = [
  'dkim', 'spf', 'mx', 'dmarc', 'srv', 'mtaSts',
  'tlsRpt', 'caa', 'autoConfig', 'autoConfigLegacy', 'autoDiscover',
]

export async function getPrimaryDomain(): Promise<StalwartDomain | null> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Domain/query', { accountId }, '0'],
    [
      'x:Domain/get',
      { accountId, '#ids': { resultOf: '0', name: 'x:Domain/query', path: '/ids' } },
      '1',
    ],
  ])
  const get = responses.find((r) => r[0] === 'x:Domain/get')
  const list = (get?.[1] as { list?: StalwartDomain[] })?.list ?? []
  return list[0] ?? null
}

export async function setDnsManagementAutomatic(
  domainId: string,
  dnsServerId: string,
  origin: string,
): Promise<void> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      'x:Domain/set',
      {
        accountId,
        update: {
          [domainId]: {
            dnsManagement: {
              '@type': 'Automatic',
              dnsServerId,
              origin,
              publishRecords: DEFAULT_PUBLISH_RECORDS,
            },
          },
        },
      },
      '0',
    ],
  ])
  const result = responses[0][1] as { updated?: Record<string, unknown>; notUpdated?: unknown }
  if (!result.updated || !(domainId in result.updated)) {
    throw new JmapError('domain dnsManagement update rejected', result.notUpdated)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/stalwart-domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/stalwart-domain.ts src/server/stalwart-domain.test.ts
git commit -m "feat(setup): add domain read and automatic DNS management"
```

---

## Task 6: Admin account creation (`src/server/stalwart-account.ts`)

`emailAddress` is server-set (derived from `name` + `domainId`). Password strength is enforced server-side; a weak password returns `notCreated.<id>.{type:'invalidProperties', properties:['secret']}`.

**Files:**
- Create: `src/server/stalwart-account.ts`
- Test: `src/server/stalwart-account.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/stalwart-account.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./jmap', () => ({
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'd333333'),
}))

import { jmapCall } from './jmap'
import { createAdminAccount, WeakPasswordError } from './stalwart-account'

const mj = vi.mocked(jmapCall)
beforeEach(() => vi.clearAllMocks())

describe('createAdminAccount', () => {
  it('creates a User with name, domainId, password credential and Admin role', async () => {
    mj.mockResolvedValue([['x:Account/set', { created: { u1: { id: 'c' } } }, '0']])
    const id = await createAdminAccount({ name: 'koffi', domainId: 'b', password: 'correct horse battery staple' })
    expect(id).toBe('c')
    const [[, args]] = mj.mock.calls[0][0] as [[string, Record<string, unknown>, string]]
    expect(args.create).toEqual({
      u1: {
        '@type': 'User',
        name: 'koffi',
        domainId: 'b',
        credentials: { '0': { '@type': 'Password', secret: 'correct horse battery staple' } },
        roles: { '@type': 'Admin' },
      },
    })
  })

  it('throws WeakPasswordError when the server rejects a weak secret', async () => {
    mj.mockResolvedValue([
      ['x:Account/set', { notCreated: { u1: { type: 'invalidProperties', properties: ['secret'], description: 'Password is too weak. ...' } } }, '0'],
    ])
    await expect(
      createAdminAccount({ name: 'koffi', domainId: 'b', password: 'password' }),
    ).rejects.toBeInstanceOf(WeakPasswordError)
  })

  it('throws a generic error for other rejections', async () => {
    mj.mockResolvedValue([['x:Account/set', { notCreated: { u1: { type: 'invalidProperties', properties: ['name'] } } }, '0']])
    await expect(
      createAdminAccount({ name: 'bad name', domainId: 'b', password: 'correct horse battery staple' }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/stalwart-account.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/stalwart-account.ts
import { jmapCall, resolveAccountId, JmapError } from './jmap'

export interface AdminAccountInput {
  name: string
  domainId: string
  password: string
}

export class WeakPasswordError extends Error {
  constructor(readonly description?: string) {
    super(description ?? 'Password is too weak')
    this.name = 'WeakPasswordError'
  }
}

export async function createAdminAccount(input: AdminAccountInput): Promise<string> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      'x:Account/set',
      {
        accountId,
        create: {
          u1: {
            '@type': 'User',
            name: input.name,
            domainId: input.domainId,
            credentials: { '0': { '@type': 'Password', secret: input.password } },
            roles: { '@type': 'Admin' },
          },
        },
      },
      '0',
    ],
  ])
  const result = responses[0][1] as {
    created?: { u1?: { id: string } }
    notCreated?: { u1?: { type: string; properties?: string[]; description?: string } }
  }
  const created = result.created?.u1
  if (created) return created.id

  const err = result.notCreated?.u1
  if (err?.type === 'invalidProperties' && err.properties?.includes('secret')) {
    throw new WeakPasswordError(err.description)
  }
  throw new JmapError('account creation rejected', err)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/stalwart-account.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/stalwart-account.ts src/server/stalwart-account.test.ts
git commit -m "feat(setup): add admin account creation with weak-password handling"
```

---

## Task 7: DNS server creation + provider list (`src/server/stalwart-dns.ts`)

**Files:**
- Create: `src/server/stalwart-dns.ts`
- Test: `src/server/stalwart-dns.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/stalwart-dns.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./jmap', () => ({
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'd333333'),
}))

import { jmapCall } from './jmap'
import { createDnsServer, DNS_PROVIDERS } from './stalwart-dns'

const mj = vi.mocked(jmapCall)
beforeEach(() => vi.clearAllMocks())

describe('DNS_PROVIDERS', () => {
  it('lists real Stalwart providers including Cloudflare and Manual', () => {
    expect(DNS_PROVIDERS).toContain('Cloudflare')
    expect(DNS_PROVIDERS).toContain('Ovh')
    expect(DNS_PROVIDERS).toContain('Manual')
    expect(DNS_PROVIDERS.length).toBeGreaterThan(60)
  })
})

describe('createDnsServer', () => {
  it('creates a provider variant with the secret credential and returns its id', async () => {
    mj.mockResolvedValue([['x:DnsServer/set', { created: { new1: { id: 'srv1' } } }, '0']])
    const id = await createDnsServer({ provider: 'Cloudflare', secret: 'tok', description: 'cf' })
    expect(id).toBe('srv1')
    const [[, args]] = mj.mock.calls[0][0] as [[string, Record<string, unknown>, string]]
    expect(args.create).toEqual({
      new1: { '@type': 'Cloudflare', description: 'cf', secret: 'tok' },
    })
  })

  it('throws when creation is rejected', async () => {
    mj.mockResolvedValue([['x:DnsServer/set', { notCreated: { new1: { type: 'invalidProperties' } } }, '0']])
    await expect(createDnsServer({ provider: 'Cloudflare', secret: 'x' })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/stalwart-dns.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/stalwart-dns.ts
import { jmapCall, resolveAccountId, JmapError } from './jmap'

// Captured from the v0.16 schema enum DnsServerBootstrapType (71 variants).
// See docs/superpowers/specs/2026-06-09-stalwart-api-capture.md §6.
export const DNS_PROVIDERS = [
  'Manual', 'Tsig', 'Cloudflare', 'DigitalOcean', 'DeSEC', 'Ovh', 'Bunny',
  'Porkbun', 'Dnsimple', 'Spaceship', 'Route53', 'GoogleCloudDns', 'Alidns',
  'ArvanCloud', 'Autodns', 'AzureDns', 'BaiduCloud', 'BluecatV2', 'ClouDns',
  'Constellix', 'Cpanel', 'Ddnss', 'DnsMadeEasy', 'Domeneshop', 'Dreamhost',
  'DuckDns', 'Dynu', 'EasyDns', 'EdgeDns', 'Exoscale', 'FreeMyIp', 'GandiV5',
  'Gcore', 'Glesys', 'Godaddy', 'Hetzner', 'HostingDe', 'Hostinger',
  'HuaweiCloud', 'Hurricane', 'IbmCloud', 'Infoblox', 'Infomaniak', 'Inwx',
  'Ionos', 'Ipv64', 'Joker', 'Lightsail', 'Linode', 'LuaDns', 'MythicBeasts',
  'Namecheap', 'NameDotCom', 'NameSilo', 'Netcup', 'Netlify', 'Nifcloud', 'Ns1',
  'OracleCloud', 'Plesk', 'Safedns', 'Scaleway', 'TencentCloud', 'Transip',
  'UltraDns', 'Vercel', 'Volcengine', 'Vultr', 'WebSupport', 'YandexCloud',
] as const

export type DnsProvider = (typeof DNS_PROVIDERS)[number]

export interface DnsServerInput {
  provider: DnsProvider
  secret: string
  description?: string
}

export async function createDnsServer(input: DnsServerInput): Promise<string> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      'x:DnsServer/set',
      {
        accountId,
        create: {
          new1: {
            '@type': input.provider,
            description: input.description ?? `${input.provider} (Stalmail)`,
            secret: input.secret,
          },
        },
      },
      '0',
    ],
  ])
  const result = responses[0][1] as {
    created?: { new1?: { id: string } }
    notCreated?: unknown
  }
  const created = result.created?.new1
  if (!created) throw new JmapError('dns server creation rejected', result.notCreated)
  return created.id
}
```

> Note: some providers carry credential fields other than a single `secret` (e.g.
> GoogleCloudDns uses `serviceAccountJson`, Route53 access key pairs). Plan 2b's UI
> renders per-provider fields from the schema; Plan 2a covers the common `secret`
> shape (Cloudflare/OVH/DeSEC/etc.). Extend `DnsServerInput` per provider when 2b
> wires the others.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/stalwart-dns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/stalwart-dns.ts src/server/stalwart-dns.test.ts
git commit -m "feat(setup): add DnsServer creation and provider list"
```

---

## Task 8: BFF-side DNS record status (`src/server/dns-resolve.ts`)

Feeds the per-record grid for the Manual mode and as the propagation check. Uses Node `dns/promises`.

**Files:**
- Create: `src/server/dns-resolve.ts`
- Test: `src/server/dns-resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/dns-resolve.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolveTxt = vi.fn()
const resolveMx = vi.fn()
vi.mock('node:dns/promises', () => ({
  resolveTxt: (...a: unknown[]) => resolveTxt(...a),
  resolveMx: (...a: unknown[]) => resolveMx(...a),
}))

import { resolveRecordStatus } from './dns-resolve'

beforeEach(() => vi.clearAllMocks())

describe('resolveRecordStatus', () => {
  it('returns "verified" when a TXT record matches the expected value', async () => {
    resolveTxt.mockResolvedValue([['v=spf1 mx -all']])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'v=spf1 mx -all' })
    expect(s).toBe('verified')
  })

  it('returns "mismatch" when a TXT record exists with a different value', async () => {
    resolveTxt.mockResolvedValue([['v=spf1 -all']])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'v=spf1 mx -all' })
    expect(s).toBe('mismatch')
  })

  it('returns "missing" when resolution finds nothing (NXDOMAIN/ENODATA)', async () => {
    resolveTxt.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }))
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'v=spf1 mx -all' })
    expect(s).toBe('missing')
  })

  it('verifies MX records by host and priority', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mail.exemple.fr', priority: 10 }])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'MX', value: '10 mail.exemple.fr.' })
    expect(s).toBe('verified')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/dns-resolve.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/dns-resolve.ts
import { resolveTxt, resolveMx } from 'node:dns/promises'
import type { ZoneRecord } from './dns-zone'

export type RecordStatus = 'verified' | 'mismatch' | 'missing' | 'unsupported'

const stripDot = (s: string) => s.replace(/\.$/, '')
const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

export async function resolveRecordStatus(record: ZoneRecord): Promise<RecordStatus> {
  const host = stripDot(record.name)
  try {
    if (record.type === 'TXT') {
      const chunks = await resolveTxt(host)
      const values = chunks.map((parts) => parts.join(''))
      if (values.some((v) => norm(v) === norm(record.value))) return 'verified'
      return values.length ? 'mismatch' : 'missing'
    }
    if (record.type === 'MX') {
      const [prio, exchange] = record.value.split(/\s+/)
      const mx = await resolveMx(host)
      const found = mx.some(
        (r) => stripDot(r.exchange) === stripDot(exchange) && String(r.priority) === prio,
      )
      return found ? 'verified' : mx.length ? 'mismatch' : 'missing'
    }
    return 'unsupported'
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') return 'missing'
    throw e
  }
}
```

> Note: covers TXT and MX (the verifiable-by-public-resolver records that matter
> most: SPF, DKIM, DMARC, MX). SRV/CAA support can be added later; they return
> `unsupported` and the grid shows them as informational rather than verified.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/dns-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/dns-resolve.ts src/server/dns-resolve.test.ts
git commit -m "feat(setup): add BFF-side DNS record verification"
```

---

## Task 9: Wizard state derivation (`src/server/setup-state.ts`)

Derives the current step from live Stalwart state. Steps mirror the design doc §7.

**Files:**
- Create: `src/server/setup-state.ts`
- Test: `src/server/setup-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/setup-state.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./setup-flag', () => ({ isSetupComplete: vi.fn() }))
vi.mock('./stalwart-bootstrap', () => ({ isBootstrapMode: vi.fn() }))
vi.mock('./stalwart-domain', () => ({ getPrimaryDomain: vi.fn() }))
vi.mock('./jmap', () => ({ jmapCall: vi.fn(), resolveAccountId: vi.fn(async () => 'd333333') }))

import { isSetupComplete } from './setup-flag'
import { isBootstrapMode } from './stalwart-bootstrap'
import { getPrimaryDomain } from './stalwart-domain'
import { jmapCall } from './jmap'
import { deriveSetupStep } from './setup-state'

const flag = vi.mocked(isSetupComplete)
const boot = vi.mocked(isBootstrapMode)
const dom = vi.mocked(getPrimaryDomain)
const mj = vi.mocked(jmapCall)

beforeEach(() => {
  vi.clearAllMocks()
  mj.mockResolvedValue([['x:Account/query', { ids: [] }, '0']]) // no admin user by default
})

describe('deriveSetupStep', () => {
  it('returns "done" when the flag is set', async () => {
    flag.mockReturnValue(true)
    expect(await deriveSetupStep()).toBe('done')
  })

  it('returns "collect" in bootstrap mode', async () => {
    flag.mockReturnValue(false)
    boot.mockResolvedValue(true)
    expect(await deriveSetupStep()).toBe('collect')
  })

  it('returns "account" in normal mode with no admin user', async () => {
    flag.mockReturnValue(false)
    boot.mockResolvedValue(false)
    mj.mockResolvedValue([['x:Account/query', { ids: [] }, '0']])
    expect(await deriveSetupStep()).toBe('account')
  })

  it('returns "dns" when an admin exists but dnsManagement is Manual', async () => {
    flag.mockReturnValue(false)
    boot.mockResolvedValue(false)
    mj.mockResolvedValue([['x:Account/query', { ids: ['c'] }, '0']])
    dom.mockResolvedValue({ id: 'b', name: 'exemple.fr', dnsManagement: { '@type': 'Manual' } })
    expect(await deriveSetupStep()).toBe('dns')
  })

  it('returns "ssl" when dnsManagement is Automatic but the finish flag is unset', async () => {
    flag.mockReturnValue(false)
    boot.mockResolvedValue(false)
    mj.mockResolvedValue([['x:Account/query', { ids: ['c'] }, '0']])
    dom.mockResolvedValue({ id: 'b', name: 'exemple.fr', dnsManagement: { '@type': 'Automatic' } })
    expect(await deriveSetupStep()).toBe('ssl')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/setup-state.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/setup-state.ts
import { isSetupComplete } from './setup-flag'
import { isBootstrapMode } from './stalwart-bootstrap'
import { getPrimaryDomain } from './stalwart-domain'
import { jmapCall, resolveAccountId } from './jmap'

export type SetupStep = 'collect' | 'account' | 'dns' | 'ssl' | 'done'

async function hasAdminUser(): Promise<boolean> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([['x:Account/query', { accountId }, '0']])
  const ids = (responses[0]?.[1] as { ids?: string[] })?.ids ?? []
  return ids.length > 0
}

export async function deriveSetupStep(): Promise<SetupStep> {
  if (isSetupComplete()) return 'done'
  if (await isBootstrapMode()) return 'collect'
  if (!(await hasAdminUser())) return 'account'
  const domain = await getPrimaryDomain()
  if (domain?.dnsManagement?.['@type'] !== 'Automatic') return 'dns'
  return 'ssl'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/setup-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/setup-state.ts src/server/setup-state.test.ts
git commit -m "feat(setup): derive wizard step from live Stalwart state"
```

---

## Task 10: Server functions (`src/server/setup-actions.ts`)

Exposes the operations as TanStack Start server functions for Plan 2b. Follows the
repo's tested pattern (`createServerFn({ method }).handler(fn)`, with the handler
exported separately for unit testing — see `src/routes/index.tsx`/`index.test.tsx`).

**Files:**
- Create: `src/server/setup-actions.ts`
- Test: `src/server/setup-actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/setup-actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: () => ({ handler: (fn: unknown) => fn }), handler: (fn: unknown) => fn }),
}))
vi.mock('./setup-state', () => ({ deriveSetupStep: vi.fn(async () => 'collect') }))
vi.mock('./stalwart-bootstrap', () => ({ submitBootstrap: vi.fn(async () => ({ username: 'admin@exemple.fr', secret: 'g' })) }))
vi.mock('./stalwart-restart', () => ({ requestStalwartRestart: vi.fn() }))

import { submitBootstrap } from './stalwart-bootstrap'
import { requestStalwartRestart } from './stalwart-restart'
import { getStepHandler, submitBootstrapHandler } from './setup-actions'

beforeEach(() => vi.clearAllMocks())

describe('getStepHandler', () => {
  it('returns the derived step', async () => {
    expect(await getStepHandler()).toEqual({ step: 'collect' })
  })
})

describe('submitBootstrapHandler', () => {
  it('submits bootstrap then requests a Stalwart restart', async () => {
    const out = await submitBootstrapHandler({ data: { serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' } })
    expect(submitBootstrap).toHaveBeenCalledWith({ serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' })
    expect(requestStalwartRestart).toHaveBeenCalled()
    expect(out).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/setup-actions.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/setup-actions.ts
import { createServerFn } from '@tanstack/react-start'
import { deriveSetupStep } from './setup-state'
import { submitBootstrap, type BootstrapInput } from './stalwart-bootstrap'
import { requestStalwartRestart } from './stalwart-restart'

export async function getStepHandler(): Promise<{ step: string }> {
  return { step: await deriveSetupStep() }
}

export async function submitBootstrapHandler(
  { data }: { data: BootstrapInput },
): Promise<{ ok: true }> {
  await submitBootstrap(data)
  requestStalwartRestart()
  return { ok: true }
}

export const getStep = createServerFn({ method: 'GET' }).handler(getStepHandler)

export const submitBootstrapFn = createServerFn({ method: 'POST' })
  .validator((d: BootstrapInput) => d)
  .handler(submitBootstrapHandler)
```

> Additional server functions (createDnsServer, setDnsManagementAutomatic,
> createAdminAccount, dns grid status) are added here in Plan 2b as the UI wires each
> step; their server-side logic already exists and is tested in Tasks 5–8.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/setup-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/setup-actions.ts src/server/setup-actions.test.ts
git commit -m "feat(setup): expose setup server functions (step, bootstrap submit)"
```

---

## Task 11: Fix entrypoint for v0.16 bootstrap + Stalwart supervisor

Rewrites `entrypoint.sh` to the v0.16 model: no `--init`/`config.toml`; run the
server binary directly so bootstrap triggers on a blank volume; supervise Stalwart
so the BFF can restart it (via the sentinel from Task 4) to enter normal mode.

This is shell, validated by an integration smoke test (Task 12), not unit tests.

**Files:**
- Modify: `entrypoint.sh`

- [ ] **Step 1: Replace the Stalwart launch + supervision section of `entrypoint.sh`**

Replace the block that runs `stalwart --init` / `stalwart --config ...` and the
single `wait -n` supervision with the following. Keep the existing
`STALMAIL_SECRET` guard, the `_RECOVERY_ADMIN` derivation, the Caddy launch, and the
app launch.

```bash
# ── Stalwart (v0.16 bootstrap model) ─────────────────────────────
# No --init / config.toml. On a blank /etc/stalwart the server enters
# bootstrap mode automatically; the BFF drives setup and asks for a restart
# via the sentinel below to switch into normal mode.
export STALWART_RECOVERY_ADMIN="${_RECOVERY_ADMIN}"
export STALWART_URL="http://localhost:8080"

RUN_DIR="${STALMAIL_RUN_DIR:-/run/stalmail}"
mkdir -p "${RUN_DIR}"
RESTART_SENTINEL="${RUN_DIR}/restart-stalwart"

start_stalwart() {
  /usr/local/bin/stalwart &
  STALWART_PID=$!
}

# Supervisor: (re)start Stalwart for the life of the container. A restart is
# requested by the BFF touching ${RESTART_SENTINEL} (after the Bootstrap submit).
supervise_stalwart() {
  start_stalwart
  while true; do
    if [ -f "${RESTART_SENTINEL}" ]; then
      rm -f "${RESTART_SENTINEL}"
      echo "[stalmail] Restart requested — restarting Stalwart into normal mode..."
      kill "${STALWART_PID}" 2>/dev/null || true
      wait "${STALWART_PID}" 2>/dev/null || true
      start_stalwart
    fi
    # If Stalwart died on its own (crash), exit the supervisor so the container
    # restarts under Docker's restart policy.
    if ! kill -0 "${STALWART_PID}" 2>/dev/null; then
      echo "[stalmail] Stalwart exited unexpectedly" >&2
      return 1
    fi
    sleep 2
  done
}

supervise_stalwart &
SUPERVISOR_PID=$!

# Wait for Stalwart to answer before starting Caddy + app
echo "[stalmail] Waiting for Stalwart..."
_i=0
until curl -sf http://localhost:8080/healthz/live > /dev/null 2>&1; do
  _i=$((_i + 1))
  if [ "${_i}" -ge 60 ]; then
    echo "[stalmail] ERROR: Stalwart failed to start within 60 seconds" >&2
    exit 1
  fi
  sleep 1
done
echo "[stalmail] Stalwart ready"
```

Then update the final supervision/cleanup so it waits on `SUPERVISOR_PID`,
`CADDY_PID`, and `APP_PID` (replacing the old `STALWART_PID` references):

```bash
cleanup() {
  echo "[stalmail] Shutting down..."
  kill "${SUPERVISOR_PID}" "${STALWART_PID}" "${CADDY_PID}" "${APP_PID}" 2>/dev/null || true
  wait "${SUPERVISOR_PID}" "${CADDY_PID}" "${APP_PID}" 2>/dev/null || true
}
trap cleanup EXIT SIGTERM SIGINT

wait -n "${SUPERVISOR_PID}" "${CADDY_PID}" "${APP_PID}" 2>/dev/null && EXIT_CODE=$? || EXIT_CODE=$?
trap - EXIT
cleanup
exit "${EXIT_CODE}"
```

Also ensure the app process receives the run dir:

```bash
STALWART_RECOVERY_ADMIN="${_RECOVERY_ADMIN}" STALWART_URL="${STALWART_URL}" \
  STALMAIL_RUN_DIR="${RUN_DIR}" \
  node /app/server/server.js &
APP_PID=$!
```

- [ ] **Step 2: Lint the script**

Run: `bash -n entrypoint.sh`
Expected: no syntax errors (no output).

- [ ] **Step 3: Commit**

```bash
git add entrypoint.sh
git commit -m "fix(docker): use v0.16 bootstrap model with Stalwart supervisor"
```

---

## Task 12: Integration smoke test (real image)

Validates the whole backend against the real `stalwartlabs/stalwart:v0.16` image.
This is a scripted manual verification, not a Vitest unit test (it needs Docker).

**Files:**
- Create: `scripts/smoke-setup-backend.sh`

- [ ] **Step 1: Create `scripts/smoke-setup-backend.sh`**

```bash
#!/usr/bin/env bash
# Smoke test: drive a fresh Stalwart v0.16 through the backend setup flow.
set -euo pipefail
SECRET='stalmail-admin:smoke-secret-123'
PORT=18080
NAME=stalmail-smoke

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm ${NAME}-etc ${NAME}-data >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker volume create ${NAME}-etc >/dev/null; docker volume create ${NAME}-data >/dev/null
docker run -d --name "$NAME" -e STALWART_RECOVERY_ADMIN="$SECRET" -p ${PORT}:8080 \
  -v ${NAME}-etc:/etc/stalwart -v ${NAME}-data:/var/lib/stalwart stalwartlabs/stalwart:v0.16 >/dev/null

AUTH=$(printf '%s' "$SECRET" | base64)
J() { curl -s -m 12 -X POST -H "Authorization: Basic $AUTH" -H 'Content-Type: application/json' -d "$1" http://localhost:${PORT}/jmap/; }

until curl -sf http://localhost:${PORT}/healthz/live >/dev/null 2>&1; do sleep 1; done
echo "1. bootstrap mode reached:"; docker logs "$NAME" 2>&1 | grep -q 'bootstrap mode' && echo "   OK"

echo "2. submit bootstrap:"
J '{"using":["urn:stalwart:jmap"],"methodCalls":[["x:Bootstrap/set",{"accountId":"d333333","update":{"singleton":{"serverHostname":"mail.smoke.test","defaultDomain":"smoke.test","requestTlsCertificate":false,"generateDkimKeys":true,"directory":{"@type":"Internal"},"dnsServer":{"@type":"Manual"}}}},"0"]]}' | grep -q '"username":"admin@smoke.test"' && echo "   OK (admin generated)"

echo "3. restart -> normal mode:"; docker restart "$NAME" >/dev/null; sleep 8
until curl -sf http://localhost:${PORT}/healthz/live >/dev/null 2>&1; do sleep 1; done
DOMAIN=$(J '{"using":["urn:stalwart:jmap"],"methodCalls":[["x:Domain/query",{"accountId":"d333333"},"0"],["x:Domain/get",{"accountId":"d333333","#ids":{"resultOf":"0","name":"x:Domain/query","path":"/ids"}},"1"]]}')
echo "$DOMAIN" | grep -q '"name":"smoke.test"' && echo "   OK (domain present in normal mode)"
echo "$DOMAIN" | grep -q 'dnsZoneFile' && echo "   OK (dnsZoneFile exposed)"

echo "4. create admin account:"
J '{"using":["urn:stalwart:jmap"],"methodCalls":[["x:Account/set",{"accountId":"d333333","create":{"u1":{"@type":"User","name":"koffi","domainId":"b","credentials":{"0":{"@type":"Password","secret":"correct horse battery staple x9"}},"roles":{"@type":"Admin"}}}},"0"]]}' | grep -q '"created"' && echo "   OK (admin user created)"

echo "SMOKE PASSED"
```

- [ ] **Step 2: Make it executable and run it**

Run:
```bash
chmod +x scripts/smoke-setup-backend.sh && ./scripts/smoke-setup-backend.sh
```
Expected: prints `OK` for steps 1–4 and `SMOKE PASSED`.

> While running, confirm the open question from the API capture §8: after step 3,
> inspect whether the Domain (now reachable) exposes a per-record `DnsPublishStatus`
> once `dnsManagement=Automatic` — if so, note it for the Plan 2b grid to consume
> Stalwart's native status instead of relying solely on `dns-resolve.ts`.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-setup-backend.sh
git commit -m "test(setup): add integration smoke test against Stalwart v0.16"
```

---

## Task 13: Full suite + typecheck gate

- [ ] **Step 1: Run the whole unit suite**

Run: `bun run test`
Expected: all server + client tests pass (existing 12 + the new suites).

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore(setup): backend suite green (typecheck + lint)"
```

---

## Self-Review notes (coverage of the spec)

- Bootstrap detection / forbidden error → Tasks 1, 3.
- Single Bootstrap submit (TLS off, no admin) → Task 3.
- Process restart requirement → Tasks 4, 11, 12.
- Admin account created in normal mode + weak-password handling → Task 6.
- DNS provider creation (real `secret` shape) + 71-provider list → Task 7.
- Domain `dnsManagement=Automatic` + publishRecords → Task 5.
- `dnsZoneFile` parsing for the grid / Manual copy-paste → Task 2.
- Per-record status (BFF resolution; native `DnsPublishStatus` to confirm in Task 12) → Tasks 8, 12.
- State derivation (no separate wizard state) → Task 9.
- Server functions for the UI → Task 10.
- Entrypoint v0.16 correction → Task 11.

**Out of scope (Plan 2b):** the React wizard UI (8 steps), the DNS grid component,
per-provider credential forms, ACME/SSL trigger + monitoring screen, and the finish
step that calls `markSetupComplete()` + redirects to `/login`. The SSL trigger
mechanism is intentionally deferred to 2b after Task 12 confirms the normal-mode
ACME/Task shape empirically.
