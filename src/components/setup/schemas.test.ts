import { describe, it, expect } from 'vitest'
import { domainSchema, dnsProviderSchema, adminAccountSchema } from './schemas'

describe('domainSchema', () => {
  it('accepts a valid hostname and domain', () => {
    expect(
      domainSchema.safeParse({ serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' }).success,
    ).toBe(true)
  })
  it('rejects a hostname without a dot', () => {
    expect(domainSchema.safeParse({ serverHostname: 'mail', defaultDomain: 'exemple.fr' }).success).toBe(false)
  })
  it('rejects labels with a leading hyphen (RFC 1123)', () => {
    expect(
      domainSchema.safeParse({ serverHostname: '-mail.exemple.fr', defaultDomain: 'exemple.fr' }).success,
    ).toBe(false)
  })
  it('rejects labels with a trailing hyphen (RFC 1123)', () => {
    expect(
      domainSchema.safeParse({ serverHostname: 'mail-.exemple.fr', defaultDomain: 'exemple.fr' }).success,
    ).toBe(false)
  })
  it('still accepts a well-formed hostname (regression)', () => {
    expect(
      domainSchema.safeParse({ serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' }).success,
    ).toBe(true)
  })
})

describe('dnsProviderSchema', () => {
  it('requires a secret when provider is not Manual', () => {
    expect(dnsProviderSchema.safeParse({ provider: 'Cloudflare', secret: '' }).success).toBe(false)
    expect(dnsProviderSchema.safeParse({ provider: 'Cloudflare', secret: 'tok' }).success).toBe(true)
  })
  it('allows an empty secret for Manual', () => {
    expect(dnsProviderSchema.safeParse({ provider: 'Manual', secret: '' }).success).toBe(true)
  })
  it('trims the secret value before storing', () => {
    const result = dnsProviderSchema.safeParse({ provider: 'Cloudflare', secret: '  tok  ' })
    expect(result.success).toBe(true)
    expect(result.success && result.data.secret).toBe('tok')
  })
  it('rejects a whitespace-only secret for Cloudflare', () => {
    expect(dnsProviderSchema.safeParse({ provider: 'Cloudflare', secret: '   ' }).success).toBe(false)
  })
})

describe('adminAccountSchema', () => {
  it('accepts a valid account', () => {
    expect(
      adminAccountSchema.safeParse({ name: 'koffi', password: 'correct horse battery staple' }).success,
    ).toBe(true)
  })
  it('rejects an empty name or short password', () => {
    expect(adminAccountSchema.safeParse({ name: '', password: 'correct horse battery staple' }).success).toBe(false)
    expect(adminAccountSchema.safeParse({ name: 'koffi', password: 'short' }).success).toBe(false)
  })
  it('reserves the "admin" username (collides with the bootstrap system admin)', () => {
    const r = adminAccountSchema.safeParse({ name: 'admin', password: 'correct horse battery staple' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('reserved-admin')
    expect(adminAccountSchema.safeParse({ name: 'Admin', password: 'correct horse battery staple' }).success).toBe(false)
  })
})
