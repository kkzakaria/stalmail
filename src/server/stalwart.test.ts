import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// eslint-disable-next-line import/first
import { stalwartHealthy, stalwartAdminFetch } from './stalwart'

describe('stalwartHealthy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STALWART_URL = 'http://localhost:8080'
  })

  it('returns true when /healthz/live responds ok', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    expect(await stalwartHealthy()).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/healthz/live',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('returns false when fetch throws (connection refused)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await stalwartHealthy()).toBe(false)
  })

  it('returns false when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    expect(await stalwartHealthy()).toBe(false)
  })
})

describe('stalwartAdminFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STALWART_URL = 'http://localhost:8080'
    process.env.STALWART_RECOVERY_ADMIN = 'stalmail-admin:test-secret'
  })

  it('calls the correct URL', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    await stalwartAdminFetch('/api/account')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/account',
      expect.any(Object),
    )
  })

  it('adds Basic Authorization header with base64 credentials', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    await stalwartAdminFetch('/api/account')
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    const expected = `Basic ${Buffer.from('stalmail-admin:test-secret').toString('base64')}`
    expect(init.headers['Authorization']).toBe(expected)
  })

  it('merges caller-provided headers', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    await stalwartAdminFetch('/api/account', {
      headers: { 'X-Custom': 'value' },
    })
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(init.headers['X-Custom']).toBe('value')
    expect(init.headers['Authorization']).toMatch(/^Basic /)
  })
})
