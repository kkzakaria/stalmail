import { createHash, randomBytes } from 'node:crypto'
import { generatePkce } from './oauth-pkce'
import { encryptToken, decryptToken } from './session-crypto'
import * as store from './session-store'
import { postApiAuth, exchangeCode, refreshTokens } from './stalwart-oauth'
import { fetchJmapAccount } from './stalwart-user'

export const CLIENT_ID = 'stalmail'
export const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // aligned with refreshTokenExpiry
const REFRESH_SKEW_MS = 60_000
const TOUCH_THROTTLE_MS = 60_000 // persist lastSeenAt at most once per minute

export type LoginResult = { ok: true; sid: string } | { ok: false; reason: 'failure' | 'mfa' }

// Only SHA-256(sid) ever reaches the store: the cleartext sid lives in the httpOnly
// cookie alone, so stealing the store file does not allow replaying sessions.
export function hashSid(sid: string): string {
  return createHash('sha256').update(sid).digest('hex')
}

function isExpired(r: store.SessionRecord, now: number): boolean {
  return now - r.lastSeenAt > IDLE_TTL_MS || now - r.createdAt > ABSOLUTE_TTL_MS
}

export async function login(input: {
  accountName: string
  accountSecret: string
  redirectUri: string
  forwardedFor?: string
  previousSid?: string
  now?: number
}): Promise<LoginResult> {
  const now = input.now ?? Date.now()
  store.sweep((r) => isExpired(r, now)) // global GC — expired records never linger on disk
  const { verifier, challenge } = generatePkce()
  const auth = await postApiAuth({
    accountName: input.accountName,
    accountSecret: input.accountSecret,
    clientId: CLIENT_ID,
    redirectUri: input.redirectUri,
    codeChallenge: challenge,
    forwardedFor: input.forwardedFor,
  })
  if (auth.type === 'mfaRequired') return { ok: false, reason: 'mfa' }
  if (auth.type === 'failure') return { ok: false, reason: 'failure' }

  const tokens = await exchangeCode({
    code: auth.clientCode,
    codeVerifier: verifier,
    clientId: CLIENT_ID,
    redirectUri: input.redirectUri,
  })
  const { accountId, accountName } = await fetchJmapAccount(tokens.accessToken)
  // Anti-fixation: a pre-existing session must not survive a successful re-login.
  if (input.previousSid) store.deleteSession(hashSid(input.previousSid))
  const sid = randomBytes(32).toString('base64url')
  const sidHash = hashSid(sid)
  store.createSession({
    sidHash,
    accountId,
    accountName,
    encAccess: encryptToken(tokens.accessToken, sidHash),
    encRefresh: tokens.refreshToken ? encryptToken(tokens.refreshToken, sidHash) : null,
    accessExp: now + tokens.expiresIn * 1000,
    createdAt: now,
    lastSeenAt: now,
  })
  return { ok: true, sid }
}

export function logout(sid: string): void {
  store.deleteSession(hashSid(sid))
}

export function logoutAllForAccount(accountId: string): void {
  store.deleteAllForAccount(accountId)
}

export function currentSession(
  sid: string | undefined,
  now: number = Date.now(),
): { accountId: string; accountName: string } | null {
  if (!sid) return null
  const sidHash = hashSid(sid)
  const r = store.getSession(sidHash)
  if (!r) return null
  if (isExpired(r, now)) {
    store.deleteSession(sidHash)
    return null
  }
  // Throttled touch: one store write per minute per session, not one per request.
  if (now - r.lastSeenAt > TOUCH_THROTTLE_MS) store.updateSession(sidHash, { lastSeenAt: now })
  return { accountId: r.accountId, accountName: r.accountName }
}

// Per-session mutex: a single refresh in flight per sid. Without it, two concurrent
// requests inside the RT rotation window (its last 4 days) can lose the rotated RT
// or fail the second exchange → spurious logout.
const inFlight = new Map<string, Promise<string | null>>()

export function withFreshAccessToken(
  sid: string,
  now: number = Date.now(),
): Promise<string | null> {
  const sidHash = hashSid(sid)
  const pending = inFlight.get(sidHash)
  if (pending) return pending
  const p = freshAccessToken(sidHash, now).finally(() => inFlight.delete(sidHash))
  inFlight.set(sidHash, p)
  return p
}

async function freshAccessToken(sidHash: string, now: number): Promise<string | null> {
  const r = store.getSession(sidHash)
  if (!r) return null
  if (isExpired(r, now)) {
    store.deleteSession(sidHash)
    return null
  }
  // Decrypt failure (corrupt record or rotated STALMAIL_SECRET) self-heals by dropping the session.
  try {
    if (now < r.accessExp - REFRESH_SKEW_MS) return decryptToken(r.encAccess, sidHash)
    // No refresh token: if the access token is already expired, the session is unusable
    // → drop it so the user is prompted to re-login rather than getting a stale token.
    if (!r.encRefresh) {
      if (now >= r.accessExp) {
        store.deleteSession(sidHash)
        return null
      }
      return decryptToken(r.encAccess, sidHash) // still valid, inside the skew window
    }
    const tokens = await refreshTokens({ refreshToken: decryptToken(r.encRefresh, sidHash), clientId: CLIENT_ID })
    store.updateSession(sidHash, {
      encAccess: encryptToken(tokens.accessToken, sidHash),
      // Stalwart rotates the refresh token only in its last 4 days — persist when present.
      encRefresh: tokens.refreshToken ? encryptToken(tokens.refreshToken, sidHash) : r.encRefresh,
      // accessExp uses pre-roundtrip `now` (conservative — refreshes slightly early on next call).
      accessExp: now + tokens.expiresIn * 1000,
    })
    return tokens.accessToken
  } catch {
    store.deleteSession(sidHash) // decrypt failure or refresh failure → force re-login
    return null
  }
}
