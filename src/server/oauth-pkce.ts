import { randomBytes, createHash } from 'node:crypto'

export interface Pkce {
  verifier: string
  challenge: string
}

export function challengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function generatePkce(): Pkce {
  // 32 random bytes → 43-char base64url string (unreserved per RFC 7636).
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: challengeFromVerifier(verifier) }
}
