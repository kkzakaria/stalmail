import { describe, it, expect } from 'vitest'
import { parseLangCookie } from './setup-lang'

describe('parseLangCookie', () => {
  it('returns the lang from the cookie header', () => {
    expect(parseLangCookie('foo=1; stalmail_lang=en; bar=2')).toBe('en')
  })
  it('defaults to fr when absent or unknown', () => {
    expect(parseLangCookie('foo=1')).toBe('fr')
    expect(parseLangCookie('stalmail_lang=zz')).toBe('fr')
    expect(parseLangCookie(undefined)).toBe('fr')
  })
})
