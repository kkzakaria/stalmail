import { stalwartAdminFetch } from './stalwart'

export const MANAGEMENT_CAPABILITY = 'urn:stalwart:jmap'

export type JmapMethodCall = [string, Record<string, unknown>, string]
export type JmapMethodResponse = [string, Record<string, unknown>, string]

export class JmapError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'JmapError'
  }
}

interface JmapErrorBody {
  type: string
  description?: string
}

export function isBootstrapForbidden(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as JmapErrorBody
  return e.type === 'forbidden' && /bootstrap mode/i.test(e.description ?? '')
}

let cachedAccountId: Promise<string> | undefined

export function resolveAccountId(force = false): Promise<string> {
  if (force) cachedAccountId = undefined
  if (cachedAccountId) return cachedAccountId
  const pending = (async () => {
    const res = await stalwartAdminFetch('/jmap/session', { method: 'GET' })
    if (!res.ok) throw new JmapError(`session request failed: HTTP ${res.status}`)
    const session = (await res.json()) as { primaryAccounts?: Record<string, string> }
    const id = session.primaryAccounts?.[MANAGEMENT_CAPABILITY]
    if (!id) throw new JmapError('no management account in session')
    return id
  })()
  // On rejection, evict so the next caller retries instead of getting a rejected cache.
  pending.catch(() => {
    if (cachedAccountId === pending) cachedAccountId = undefined
  })
  cachedAccountId = pending
  return cachedAccountId
}

export async function jmapCall(
  methodCalls: JmapMethodCall[],
): Promise<JmapMethodResponse[]> {
  const res = await stalwartAdminFetch('/jmap/', {
    method: 'POST',
    body: JSON.stringify({ using: [MANAGEMENT_CAPABILITY], methodCalls }),
  })
  if (!res.ok) throw new JmapError(`jmap request failed: HTTP ${res.status}`)
  const body = (await res.json()) as { methodResponses?: JmapMethodResponse[] }
  return body.methodResponses ?? []
}

export function firstResponse(
  responses: JmapMethodResponse[],
  index = 0,
): JmapMethodResponse {
  if (!Number.isInteger(index) || index < 0 || index >= responses.length) {
    throw new JmapError(`no JMAP response at index ${index}`)
  }
  return responses[index]
}

// Returns the result payload of the response at `index`, throwing JmapError when
// the slot is missing OR the response is a JMAP method-level error
// (["error", {...}, id]). This prevents callers from mistaking a transient
// backend error for an empty/normal result.
export function expectResult(
  responses: JmapMethodResponse[],
  index = 0,
): Record<string, unknown> {
  const [name, result] = firstResponse(responses, index)
  if (name === 'error') {
    const type = (result as { type?: string }).type ?? 'unknown'
    throw new JmapError(`JMAP method error: ${type}`, result)
  }
  return result
}

// test-only: reset the cached account id between tests if needed
export function _resetAccountIdCache(): void {
  cachedAccountId = undefined
}

