import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./jmap', () => ({
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'd333333'),
  isBootstrapForbidden: vi.fn(),
  JmapError: class JmapError extends Error {
    constructor(message: string, readonly detail?: unknown) { super(message); this.name = 'JmapError' }
  },
  firstResponse: vi.fn((responses: unknown[], index = 0) => {
    const r = responses[index]
    if (!r) {
      const err = new Error('empty or truncated JMAP response')
      err.name = 'JmapError'
      throw err
    }
    return r
  }),
}))

// eslint-disable-next-line import/first
import { jmapCall, isBootstrapForbidden } from './jmap'
// eslint-disable-next-line import/first
import { isBootstrapMode, getBootstrap, submitBootstrap } from './stalwart-bootstrap'

const mj = vi.mocked(jmapCall)
const mf = vi.mocked(isBootstrapForbidden)

beforeEach(() => vi.clearAllMocks())

describe('isBootstrapMode', () => {
  it('returns true when probing a domain yields the bootstrap forbidden error', async () => {
    mj.mockResolvedValue([['error', { type: 'forbidden', description: 'bootstrap mode' }, '0']])
    mf.mockReturnValue(true)
    expect(await isBootstrapMode()).toBe(true)
  })

  it('returns false when x:Domain/query succeeds (normal mode)', async () => {
    mj.mockResolvedValue([['x:Domain/query', { ids: ['b'] }, '0']])
    mf.mockReturnValue(false)
    expect(await isBootstrapMode()).toBe(false)
  })
})

describe('getBootstrap', () => {
  it('returns the singleton object', async () => {
    mj.mockResolvedValue([
      ['x:Bootstrap/get', { list: [{ id: 'singleton', defaultDomain: 'example.org' }] }, '0'],
    ])
    expect(await getBootstrap()).toEqual({ id: 'singleton', defaultDomain: 'example.org' })
  })

  it('throws when the singleton list is empty', async () => {
    mj.mockResolvedValue([['x:Bootstrap/get', { list: [] }, '0']])
    await expect(getBootstrap()).rejects.toThrow(/not found/i)
  })
})

describe('submitBootstrap', () => {
  it('updates the singleton and returns the generated admin credentials', async () => {
    mj.mockResolvedValue([
      ['x:Bootstrap/set', { updated: { singleton: { username: 'admin@exemple.fr', secret: 'gen' } } }, '0'],
    ])
    const out = await submitBootstrap({
      serverHostname: 'mail.exemple.fr',
      defaultDomain: 'exemple.fr',
    })
    expect(out).toEqual({ username: 'admin@exemple.fr', secret: 'gen' })
    const [[, args]] = mj.mock.calls[0][0] as [[string, Record<string, unknown>, string]]
    expect(args.update).toEqual({
      singleton: {
        serverHostname: 'mail.exemple.fr',
        defaultDomain: 'exemple.fr',
        requestTlsCertificate: false,
        generateDkimKeys: true,
        directory: { '@type': 'Internal' },
        dnsServer: { '@type': 'Manual' },
      },
    })
  })

  it('throws when the set is rejected', async () => {
    mj.mockResolvedValue([['x:Bootstrap/set', { notUpdated: { singleton: { type: 'invalidProperties' } } }, '0']])
    await expect(
      submitBootstrap({ serverHostname: 'h', defaultDomain: 'd' }),
    ).rejects.toThrow(/bootstrap/i)
  })
})
