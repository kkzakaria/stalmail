import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// eslint-disable-next-line import/first
import { jmapCall, resolveAccountId, isBootstrapForbidden, JmapError, _resetAccountIdCache, firstResponse, expectResult } from './jmap'

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

  it('returns the cached value on a second call (no second fetch)', async () => {
    mockFetch.mockResolvedValue(okJson({ primaryAccounts: { 'urn:stalwart:jmap': 'd333333' } }))
    await resolveAccountId()
    await resolveAccountId()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws when the session endpoint returns an HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    await expect(resolveAccountId()).rejects.toBeInstanceOf(JmapError)
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

describe('firstResponse', () => {
  it('returns the tuple at the given index', () => {
    const r: [string, Record<string, unknown>, string] = ['x:Domain/get', { list: [] }, '0']
    expect(firstResponse([r])).toBe(r)
  })
  it('throws JmapError on an empty response set', () => {
    expect(() => firstResponse([])).toThrow(JmapError)
  })
  it('throws on a negative index', () => {
    const r: [string, Record<string, unknown>, string] = ['x:Domain/get', {}, '0']
    expect(() => firstResponse([r], -1)).toThrow(JmapError)
  })
  it('throws on a non-integer index', () => {
    const r: [string, Record<string, unknown>, string] = ['x:Domain/get', {}, '0']
    expect(() => firstResponse([r], 1.5)).toThrow(JmapError)
  })
})

describe('expectResult', () => {
  it('returns the result payload for a successful response', () => {
    const r: [string, Record<string, unknown>, string] = ['x:Domain/get', { list: [] }, '0']
    expect(expectResult([r])).toEqual({ list: [] })
  })
  it('throws JmapError when the response is a method-level error', () => {
    const r: [string, Record<string, unknown>, string] = ['error', { type: 'serverFail' }, '0']
    expect(() => expectResult([r])).toThrow(JmapError)
  })
  it('throws when the slot is missing', () => {
    expect(() => expectResult([], 0)).toThrow(JmapError)
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
