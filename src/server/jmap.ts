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

export interface JmapErrorBody {
  type: string
  description?: string
}

export function isBootstrapForbidden(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as JmapErrorBody
  return e.type === 'forbidden' && /bootstrap mode/i.test(e.description ?? '')
}

let cachedAccountId: string | undefined

export async function resolveAccountId(force = false): Promise<string> {
  if (cachedAccountId && !force) return cachedAccountId
  const res = await stalwartAdminFetch('/jmap/session', { method: 'GET' })
  if (!res.ok) throw new JmapError(`session request failed: HTTP ${res.status}`)
  const session = (await res.json()) as {
    primaryAccounts?: Record<string, string>
  }
  const id = session.primaryAccounts?.[MANAGEMENT_CAPABILITY]
  if (!id) throw new JmapError('no management account in session')
  cachedAccountId = id
  return id
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

// test-only: reset the cached account id between tests if needed
export function _resetAccountIdCache(): void {
  cachedAccountId = undefined
}
