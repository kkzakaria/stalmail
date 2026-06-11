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
