import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveRecordStatus } from './dns-resolve'

const resolveTxt = vi.fn()
const resolveMx = vi.fn()
vi.mock('node:dns/promises', () => ({
  resolveTxt: (...a: unknown[]) => resolveTxt(...a),
  resolveMx: (...a: unknown[]) => resolveMx(...a),
}))

beforeEach(() => vi.clearAllMocks())

describe('resolveRecordStatus', () => {
  it('returns "verified" when a TXT record matches the expected value', async () => {
    resolveTxt.mockResolvedValue([['v=spf1 mx -all']])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'v=spf1 mx -all' })
    expect(s).toBe('verified')
  })

  it('returns "mismatch" when a TXT record exists with a different value', async () => {
    resolveTxt.mockResolvedValue([['v=spf1 -all']])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'v=spf1 mx -all' })
    expect(s).toBe('mismatch')
  })

  it('returns "missing" when resolution finds nothing (NXDOMAIN/ENODATA)', async () => {
    resolveTxt.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }))
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'v=spf1 mx -all' })
    expect(s).toBe('missing')
  })

  it('verifies MX records by host and priority', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mail.exemple.fr', priority: 10 }])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'MX', value: '10 mail.exemple.fr.' })
    expect(s).toBe('verified')
  })

  it('joins multi-chunk TXT before comparing', async () => {
    resolveTxt.mockResolvedValue([['v=spf1', ' mx', ' -all']])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'v=spf1 mx -all' })
    expect(s).toBe('verified')
  })

  it('returns "missing" when TXT resolves to an empty list', async () => {
    resolveTxt.mockResolvedValue([])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'v=spf1 mx -all' })
    expect(s).toBe('missing')
  })

  it('treats ENODATA as "missing"', async () => {
    resolveTxt.mockRejectedValue(Object.assign(new Error('no data'), { code: 'ENODATA' }))
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'x' })
    expect(s).toBe('missing')
  })

  it('rethrows unexpected resolver errors (e.g. ETIMEDOUT)', async () => {
    resolveTxt.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    await expect(
      resolveRecordStatus({ name: 'exemple.fr.', type: 'TXT', value: 'x' }),
    ).rejects.toThrow(/timeout/i)
  })

  it('returns "mismatch" for an MX with a different host', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'other.exemple.fr', priority: 10 }])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'MX', value: '10 mail.exemple.fr.' })
    expect(s).toBe('mismatch')
  })

  it('returns "missing" for an MX with no records', async () => {
    resolveMx.mockResolvedValue([])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'MX', value: '10 mail.exemple.fr.' })
    expect(s).toBe('missing')
  })

  it('returns "unsupported" for record types other than TXT/MX', async () => {
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'A', value: '203.0.113.1' })
    expect(s).toBe('unsupported')
  })

  it('verifies MX even when the expected priority has a leading zero', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mail.exemple.fr', priority: 10 }])
    const s = await resolveRecordStatus({ name: 'exemple.fr.', type: 'MX', value: '010 mail.exemple.fr.' })
    expect(s).toBe('verified')
  })
})
