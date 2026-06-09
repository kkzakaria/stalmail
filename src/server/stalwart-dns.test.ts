import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./jmap', () => ({
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'd333333'),
  firstResponse: (responses: unknown[], index = 0) => {
    const r = responses[index]
    if (!r) throw new Error('empty')
    return r
  },
  JmapError: class JmapError extends Error {
    constructor(message: string, readonly detail?: unknown) { super(message); this.name = 'JmapError' }
  },
}))

// eslint-disable-next-line import/first
import { jmapCall } from './jmap'
// eslint-disable-next-line import/first
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
