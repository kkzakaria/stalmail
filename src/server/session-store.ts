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
    } catch (err) {
      console.error('[session-store] corrupt sessions.json, starting empty:', err)
    }
  }
  cache = m
  return m
}

function persist(m: Map<string, SessionRecord>): void {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
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
  for (const [k, r] of m) if (r.accountId === accountId) {
    m.delete(k)
    changed = true
  }
  if (changed) persist(m)
}

export function sweep(isExpired: (r: SessionRecord) => boolean): void {
  const m = load()
  let changed = false
  for (const [k, r] of m) if (isExpired(r)) {
    m.delete(k)
    changed = true
  }
  if (changed) persist(m)
}

// test-only: drop the in-memory cache so the next call reloads from disk
export function __resetCacheForTest(): void {
  cache = null
}
