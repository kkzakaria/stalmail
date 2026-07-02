export const SETUP_CODES = [
  "SETUP-RESTART-TIMEOUT",
  "SETUP-DNS-REJECTED",
  "SETUP-DNS-MANAGEMENT-REJECTED",
  "SETUP-ACCOUNT-WEAK",
  "SETUP-ACCOUNT-REJECTED",
  "SETUP-SSL-REJECTED",
  "SETUP-UNKNOWN",
  "SETUP-FORBIDDEN",
  "SETUP-ORIGIN-REJECTED",
  "SETUP-BACKEND-UNAVAILABLE",
  "SETUP-UNAUTHENTICATED",
  "SETUP-UNLOCK-FAILED",
] as const

export type SetupErrorCode = (typeof SETUP_CODES)[number]

export class SetupError extends Error {
  constructor(readonly code: SetupErrorCode) {
    super(code)
    this.name = "SetupError"
  }
}

export function toSetupErrorCode(
  err: unknown,
  fallback: SetupErrorCode
): SetupErrorCode {
  if (err instanceof SetupError) return err.code
  const name = (err as { name?: string } | null | undefined)?.name
  if (name === "WeakPasswordError") return "SETUP-ACCOUNT-WEAK"
  const msg = (err as { message?: string } | null | undefined)?.message ?? ""
  if (/dns server creation rejected/.test(msg)) return "SETUP-DNS-REJECTED"
  if (/dnsManagement.*rejected/.test(msg))
    return "SETUP-DNS-MANAGEMENT-REJECTED"
  return fallback
}
