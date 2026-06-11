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
    expect(deleteCookie).toHaveBeenCalledWith('__Host-stalmail_session', { path: '/', secure: true })
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
  it('throws when the scheme does not match (http Origin against https host)', () => {
    headers({ origin: 'http://mail.x/login', 'x-forwarded-host': 'mail.x', 'x-forwarded-proto': 'https' })
    expect(() => assertSameOrigin()).toThrow()
  })
})

describe('clientIp', () => {
  it('returns the first X-Forwarded-For hop', () => {
    headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    expect(clientIp()).toBe('203.0.113.7')
  })
  it('returns undefined when the header is absent', () => {
    headers({})
    expect(clientIp()).toBeUndefined()
  })
  it('returns undefined for a whitespace-only header', () => {
    headers({ 'x-forwarded-for': '   ' })
    expect(clientIp()).toBeUndefined()
  })
})
