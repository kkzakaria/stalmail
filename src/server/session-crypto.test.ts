import { describe, it, expect, beforeEach } from 'vitest'
import { encryptToken, decryptToken } from './session-crypto'

beforeEach(() => {
  process.env.STALMAIL_SECRET = 'test-install-secret-32-chars-min!!'
})

describe('session-crypto', () => {
  it('round-trips a token through encrypt/decrypt with its AAD', () => {
    const plain = 'sw1.t10Ynnzx.abcdef'
    const enc = encryptToken(plain, 'sid-hash-1')
    expect(enc).not.toContain(plain)
    expect(decryptToken(enc, 'sid-hash-1')).toBe(plain)
  })

  it('produces distinct ciphertexts for the same plaintext (random IV)', () => {
    expect(encryptToken('same', 'a')).not.toBe(encryptToken('same', 'a'))
  })

  it('fails to decrypt tampered ciphertext', () => {
    const enc = encryptToken('secret', 'a')
    const tampered = Buffer.from(enc, 'base64')
    tampered[tampered.length - 1] ^= 0xff
    expect(() => decryptToken(tampered.toString('base64'), 'a')).toThrow()
  })

  it('fails to decrypt with the wrong AAD (no cross-record token swap)', () => {
    const enc = encryptToken('secret', 'sid-hash-1')
    expect(() => decryptToken(enc, 'sid-hash-2')).toThrow()
  })

  it('refuses to run without a strong STALMAIL_SECRET (no fallback)', () => {
    process.env.STALMAIL_SECRET = ''
    expect(() => encryptToken('x', 'a')).toThrow(/STALMAIL_SECRET/)
    process.env.STALMAIL_SECRET = 'too-short'
    expect(() => encryptToken('x', 'a')).toThrow(/STALMAIL_SECRET/)
  })
})
