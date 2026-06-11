import { describe, it, expect } from 'vitest'
import { challengeFromVerifier, generatePkce } from './oauth-pkce'

describe('oauth-pkce', () => {
  it('derives the RFC 7636 appendix B challenge from a known verifier', () => {
    expect(challengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('generates a verifier of 43-128 url-safe chars and a matching challenge', () => {
    const { verifier, challenge } = generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]{43,128}$/)
    expect(challenge).toBe(challengeFromVerifier(verifier))
    expect(challenge).not.toMatch(/[+/=]/)
  })
})
