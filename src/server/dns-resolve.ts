import { resolveTxt, resolveMx } from 'node:dns/promises'
import type { ZoneRecord } from './dns-zone'

export type RecordStatus = 'verified' | 'mismatch' | 'missing' | 'unsupported'

const stripDot = (s: string) => s.replace(/\.$/, '')
const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

export async function resolveRecordStatus(record: ZoneRecord): Promise<RecordStatus> {
  const host = stripDot(record.name)
  try {
    if (record.type === 'TXT') {
      const chunks = await resolveTxt(host)
      const values = chunks.map((parts) => parts.join(''))
      if (values.some((v) => norm(v) === norm(record.value))) return 'verified'
      return values.length ? 'mismatch' : 'missing'
    }
    if (record.type === 'MX') {
      const [prio, exchange] = record.value.split(/\s+/)
      const mx = await resolveMx(host)
      const found = mx.some(
        (r) => stripDot(r.exchange) === stripDot(exchange) && Number(r.priority) === Number(prio),
      )
      return found ? 'verified' : mx.length ? 'mismatch' : 'missing'
    }
    return 'unsupported'
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') return 'missing'
    throw e
  }
}
