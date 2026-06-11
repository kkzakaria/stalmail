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
