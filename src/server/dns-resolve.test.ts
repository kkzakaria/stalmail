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
})
