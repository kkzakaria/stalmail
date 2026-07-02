// Setup server-functions reject with an `Error` whose `.message` is an opaque
// SetupError code (e.g. "SETUP-DNS-REJECTED"). The wizard surfaces that code via
// SetupErrorBox, mapping it to an i18n message key. Unknown shapes fall back to
// "SETUP-UNKNOWN" (which has a generic localized message).
export function codeFromError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg && /^SETUP-[A-Z-]+$/.test(msg) ? msg : "SETUP-UNKNOWN"
}

// Closed set of codes that have a dedicated localized message under
// wizard.error.codes.*. Anything else falls back to the generic message.
const KNOWN_CODES = new Set([
  "SETUP-RESTART-TIMEOUT",
  "SETUP-DNS-REJECTED",
  "SETUP-DNS-MANAGEMENT-REJECTED",
  "SETUP-DNS-PUBLISH-FAILED",
  "SETUP-ACCOUNT-WEAK",
  "SETUP-ACCOUNT-REJECTED",
  "SETUP-SSL-REJECTED",
  "SETUP-FORBIDDEN",
  "SETUP-ORIGIN-REJECTED",
  "SETUP-BACKEND-UNAVAILABLE",
  "SETUP-UNKNOWN",
  "SETUP-UNAUTHENTICATED",
  "SETUP-UNLOCK-FAILED",
])

export function messageKeyForCode(code: string): string {
  return KNOWN_CODES.has(code)
    ? `wizard.error.codes.${code}`
    : "wizard.error.generic"
}
