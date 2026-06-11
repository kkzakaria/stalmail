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
