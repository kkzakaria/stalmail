import { getCookie, setCookie, deleteCookie, getRequestHeader } from '@tanstack/react-start/server'

const ABSOLUTE_TTL_S = 30 * 24 * 60 * 60 // 30d, aligned with the session absolute TTL

function secure(): boolean {
  return process.env.NODE_ENV === 'production'
}

// __Host- requires Secure + Path=/ + no Domain; only valid over https (prod).
export function cookieName(): string {
  return secure() ? '__Host-stalmail_session' : 'stalmail_session'
}

export function readSid(): string | undefined {
  return getCookie(cookieName())
}

export function writeSid(sid: string): void {
  setCookie(cookieName(), sid, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_TTL_S,
  })
}

export function clearSid(): void {
  // h3's deleteCookie emits Set-Cookie with Max-Age=0; __Host- deletion needs the same attributes.
  deleteCookie(cookieName(), { path: '/', secure: secure() })
}

// CSRF: reject state-changing requests whose Origin (or, failing that, Referer)
// host ≠ our host. Trust model: x-forwarded-host MUST be overwritten by Caddy —
// never relayed from the client (see spec §8/§9).
export function assertSameOrigin(): void {
  const origin = getRequestHeader('origin') ?? getRequestHeader('referer')
  if (!origin) return // same-origin navigations may omit both headers
  const host = getRequestHeader('x-forwarded-host') ?? getRequestHeader('host')
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw new Error('invalid Origin/Referer header')
  }
  if (!host || originHost !== host.toLowerCase()) throw new Error('cross-origin request rejected')
}

// Real client IP from the proxy chain, for Stalwart rate-limiting/Fail2Ban.
// First X-Forwarded-For hop — safe ONLY because Caddy overwrites the incoming
// header for untrusted clients (do NOT add Internet to trusted_proxies).
export function clientIp(): string | undefined {
  const ip = getRequestHeader('x-forwarded-for')?.split(',')[0]?.trim()
  return ip || undefined
}
