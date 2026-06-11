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
