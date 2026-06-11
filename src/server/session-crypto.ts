import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const KEY_INFO = 'stalmail/session-enc'
const MIN_SECRET_CHARS = 32

// Key separation: STALMAIL_SECRET is the ONLY accepted root. Never fall back to
// another credential (e.g. the recovery-admin password) — a misconfigured prod must
// fail hard, not silently encrypt with an admin secret.
function rootSecret(): string {
  const secret = process.env.STALMAIL_SECRET ?? ''
  if (secret.length < MIN_SECRET_CHARS)
    throw new Error(`session-crypto: STALMAIL_SECRET must be set (>= ${MIN_SECRET_CHARS} chars)`)
  return secret
}

function deriveKey(info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', rootSecret(), new Uint8Array(0), info, 32)) // empty salt: RFC 5869 §2.2 compliant — the info string provides domain separation
}

// Layout: base64( iv(12) | tag(16) | ciphertext ). `aad` binds the ciphertext to its
// session record (sidHash): ciphertexts cannot be swapped between records.
export function encryptToken(plaintext: string, aad: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(KEY_INFO), iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function decryptToken(payload: string, aad: string): string {
  const buf = Buffer.from(payload, 'base64')
  if (buf.length < 29)
    throw new Error('session-crypto: payload too short to be a valid ciphertext')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(KEY_INFO), iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
