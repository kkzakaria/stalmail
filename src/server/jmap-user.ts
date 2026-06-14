import { redirect } from '@tanstack/react-router'
import { withFreshAccessToken } from './session'
import { stalwartUserFetch } from './stalwart-user'
import type { JmapMethodCall, JmapMethodResponse } from './jmap'

export class JmapUserError extends Error {
  constructor(
    message: string,
    readonly type?: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'JmapUserError'
  }
}

const MAIL_CAPABILITIES = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail']

// Appel JMAP batch avec le token Bearer de l'utilisateur. Session expirée → redirect /login.
export async function jmapUserCall(
  sid: string,
  methodCalls: JmapMethodCall[],
): Promise<JmapMethodResponse[]> {
  const accessToken = await withFreshAccessToken(sid)
  if (accessToken === null) throw redirect({ to: '/login' })

  const res = await stalwartUserFetch('/jmap/', accessToken, {
    method: 'POST',
    body: JSON.stringify({ using: MAIL_CAPABILITIES, methodCalls }),
  })
  if (!res.ok) throw new JmapUserError(`jmap request failed: HTTP ${res.status}`)

  let body: { methodResponses?: JmapMethodResponse[] }
  try {
    body = (await res.json()) as { methodResponses?: JmapMethodResponse[] }
  } catch {
    throw new JmapUserError(`jmap response: non-JSON body (status ${res.status})`)
  }
  if (!Array.isArray(body.methodResponses)) {
    throw new JmapUserError('jmap response missing methodResponses', undefined, body)
  }
  const responses = body.methodResponses
  for (const [name, args] of responses) {
    if (name === 'error') {
      const e = args as { type?: string; description?: string }
      throw new JmapUserError(e.description ?? 'jmap method error', e.type, args)
    }
  }
  return responses
}
