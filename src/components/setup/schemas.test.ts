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
})

describe('dnsProviderSchema', () => {
  it('requires a secret when provider is not Manual', () => {
    expect(dnsProviderSchema.safeParse({ provider: 'Cloudflare', secret: '' }).success).toBe(false)
    expect(dnsProviderSchema.safeParse({ provider: 'Cloudflare', secret: 'tok' }).success).toBe(true)
  })
  it('allows an empty secret for Manual', () => {
    expect(dnsProviderSchema.safeParse({ provider: 'Manual', secret: '' }).success).toBe(true)
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
})
