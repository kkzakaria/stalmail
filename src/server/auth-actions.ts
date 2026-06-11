import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export type LoginStatus =
  | { status: 'ok' }
  | { status: 'invalid' }
  | { status: 'mfa' }
  | { status: 'rateLimited' }
  | { status: 'error' }

export async function loginHandler({
  data,
}: {
  data: { email: string; password: string }
}): Promise<LoginStatus> {
  const { assertSameOrigin, writeSid, readSid, clientIp } = await import('./session-cookie')
  const { login } = await import('./session')
  const { isRateLimited, recordFailure } = await import('./login-rate-limit')
  assertSameOrigin()
  const ip = clientIp()
  if (isRateLimited(data.email, ip)) return { status: 'rateLimited' }
  try {
    // Fixed public base URL — never derived from request headers (spec §7/§13):
    // no proxy-chain dependency, and https as Stalwart requires outside recovery/dev.
    const publicUrl = process.env.STALMAIL_PUBLIC_URL
    if (!publicUrl) throw new Error('STALMAIL_PUBLIC_URL is not set')
    const res = await login({
      accountName: data.email,
      accountSecret: data.password,
      redirectUri: `${publicUrl.replace(/\/+$/, '')}/login`,
      forwardedFor: ip,
      previousSid: readSid(),
    })
    if (!res.ok) {
      // mfaRequired confirms a valid password → throttle that oracle too.
      recordFailure(data.email, ip)
      return { status: res.reason === 'mfa' ? 'mfa' : 'invalid' }
    }
    writeSid(res.sid)
    return { status: 'ok' }
  } catch {
    // Never leak internals (OAuthError, Stalwart HTTP codes) in the network response.
    return { status: 'error' }
  }
}

const loginSchema = z.object({ email: z.string().min(1).max(254), password: z.string().min(1).max(1024) })

export const loginFn = createServerFn({ method: 'POST' })
  .validator((d: { email: string; password: string }) => loginSchema.parse(d))
  .handler(loginHandler)

export async function logoutHandler(): Promise<{ ok: true }> {
  const { readSid, clearSid, assertSameOrigin } = await import('./session-cookie')
  const { logout } = await import('./session')
  assertSameOrigin()
  const sid = readSid()
  if (sid) logout(sid)
  clearSid()
  return { ok: true }
}

export const logoutFn = createServerFn({ method: 'POST' }).handler(logoutHandler)

export type SessionStatus = { authenticated: false } | { authenticated: true; accountName: string }

export async function sessionStatusHandler(): Promise<SessionStatus> {
  const { readSid } = await import('./session-cookie')
  const { currentSession } = await import('./session')
  const s = currentSession(readSid())
  return s ? { authenticated: true, accountName: s.accountName } : { authenticated: false }
}

export const sessionStatusFn = createServerFn({ method: 'GET' }).handler(sessionStatusHandler)
