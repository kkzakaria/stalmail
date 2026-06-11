import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { stalwartUserFetch, fetchJmapAccount } from './stalwart-user'

const mockResponse = (body: unknown) => ({ ok: true, json: async () => body } as unknown as Response)

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  process.env.STALWART_URL = 'http://stalwart:8080'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('stalwartUserFetch', () => {
  it('sends a Bearer authorization header', async () => {
    fetchMock.mockResolvedValue(mockResponse({}))
    await stalwartUserFetch('/jmap/session', 'AT', { method: 'GET' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://stalwart:8080/jmap/session')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer AT')
  })
})

describe('fetchJmapAccount', () => {
  it('returns the primary account id and username', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        username: 'alice@probe.test',
        primaryAccounts: { 'urn:ietf:params:jmap:core': 'c', 'urn:ietf:params:jmap:mail': 'c' },
      }),
    )
    expect(await fetchJmapAccount('AT')).toEqual({ accountId: 'c', accountName: 'alice@probe.test' })
  })

  it('throws when the session lacks an account', async () => {
    fetchMock.mockResolvedValue(mockResponse({}))
    await expect(fetchJmapAccount('AT')).rejects.toThrow()
  })

  it('throws on HTTP error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    await expect(fetchJmapAccount('AT')).rejects.toThrow('jmap session HTTP 401')
  })

  it('throws on a non-JSON body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('x')
      },
    })
    await expect(fetchJmapAccount('AT')).rejects.toThrow(/non-JSON/)
  })
})
