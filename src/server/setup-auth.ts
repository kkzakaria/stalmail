import { createHash, timingSafeEqual } from "node:crypto"
import {
  getCookie,
  setCookie,
  deleteCookie,
} from "@tanstack/react-start/server"
import { encryptToken, decryptToken } from "./session-crypto"
import { assertSameOrigin, clientIp } from "./session-cookie"
import { isSetupComplete } from "./setup-flag"
import { SetupError } from "./setup-errors"

// AAD domain-separates this cookie from the session cookie under the same root key.
const AAD = "stalmail-setup"
const TTL_MS = 3_600_000 // 1 h, enforced server-side (do NOT trust maxAge alone)
const TTL_S = 3600

function secure(): boolean {
  return process.env.NODE_ENV === "production"
}

// __Host- requires Secure + Path=/ + no Domain; only valid over https (prod).
function cookieName(): string {
  return secure() ? "__Host-stalmail_setup" : "stalmail_setup"
}

// Set the encrypted, timestamped setup cookie. The plaintext is the issue time
// (ms epoch); confidentiality + authenticity come from AES-GCM (session-crypto).
export function issueSetupCookie(): void {
  const value = encryptToken(String(Date.now()), AAD)
  setCookie(cookieName(), value, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    maxAge: TTL_S,
  })
}

// Read + decrypt + enforce age server-side. Any failure (absent, tampered, wrong
// aad, non-numeric, expired) → false. Never throws.
export function isSetupAuthed(): boolean {
  const raw = getCookie(cookieName())
  if (!raw) return false
  let issuedAt: number
  try {
    issuedAt = Number(decryptToken(raw, AAD))
  } catch {
    return false // invalid / tampered / wrong-aad ciphertext (GCM auth failure)
  }
  if (!Number.isFinite(issuedAt)) return false
  return Date.now() - issuedAt <= TTL_MS
}

export function requireSetupAuth(): void {
  if (!isSetupAuthed()) throw new SetupError("SETUP-UNAUTHENTICATED")
}

export function clearSetupCookie(): void {
  // __Host- deletion needs the same Path/Secure attributes as when it was set.
  deleteCookie(cookieName(), { path: "/", secure: secure() })
}

// --- Per-IP unlock rate-limit (sliding window, in-memory, mono-process) ------
// Mirrors send-rate-limit.ts. Resets at restart. Counts ATTEMPTS, not failures,
// so a flood of guesses (even interleaved with the correct token) is throttled.
const RL_WINDOW_MS = 15 * 60 * 1000 // 15 min
const RL_MAX_PER_IP = 10
const attempts = new Map<string, number[]>()

function recentAttempts(key: string, now: number): number[] {
  const list = (attempts.get(key) ?? []).filter((t) => now - t < RL_WINDOW_MS)
  if (list.length === 0) attempts.delete(key)
  else attempts.set(key, list)
  return list
}

// Atomic prune+check+consume in one synchronous pass. Returns false if the IP is
// already at the cap (slot NOT consumed).
function consumeUnlockSlot(key: string, now = Date.now()): boolean {
  const list = recentAttempts(key, now)
  if (list.length >= RL_MAX_PER_IP) return false
  list.push(now)
  attempts.set(key, list)
  return true
}

// Decode the env hash (hex) to a Buffer. Returns null on missing/malformed/wrong
// length — caller treats null as a failure (never an error that leaks the reason).
function envHashBuffer(): Buffer | null {
  const hex = process.env.STALMAIL_SETUP_TOKEN_HASH
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) return null
  return Buffer.from(hex, "hex") // 32 bytes (sha256)
}

// Verify a candidate token against the env hash. ALL failure modes return false;
// only an exact, constant-time digest match returns true.
function tokenMatches(token: string): boolean {
  const expected = envHashBuffer()
  if (!expected) return false
  const actual = createHash("sha256").update(token).digest()
  // Guard equal lengths first: timingSafeEqual throws on length mismatch.
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

// Unlock the setup wizard with the bootstrap token.
// Order matters for security:
//   1. CSRF guard (assertSameOrigin).
//   2. Consume a rate-limit slot (counts every attempt).
//   3. Refuse if setup is already complete (generic — NO oracle).
//   4. Constant-time token verification.
// Every refusal surfaces the SAME generic SETUP-UNLOCK-FAILED so a caller cannot
// distinguish "bad token" / "already complete" / "rate-limited".
export function unlockSetup(token: string): void {
  assertSameOrigin()
  const ip = clientIp() ?? "unknown"

  if (!consumeUnlockSlot(ip)) {
    console.warn("[setup-auth] unlock", {
      ip,
      ok: false,
      reason: "rate-limited",
    })
    throw new SetupError("SETUP-UNLOCK-FAILED")
  }

  if (isSetupComplete()) {
    console.warn("[setup-auth] unlock", {
      ip,
      ok: false,
      reason: "already-complete",
    })
    throw new SetupError("SETUP-UNLOCK-FAILED")
  }

  if (!tokenMatches(token)) {
    console.warn("[setup-auth] unlock", { ip, ok: false, reason: "mismatch" })
    throw new SetupError("SETUP-UNLOCK-FAILED")
  }

  console.warn("[setup-auth] unlock", { ip, ok: true })
  issueSetupCookie()
}

export function __resetSetupRateLimitForTest(): void {
  attempts.clear()
}
