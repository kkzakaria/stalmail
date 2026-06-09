import { describe, it, expect } from 'vitest'
import { scorePassword } from './password-strength'

describe('scorePassword', () => {
  it('rates short/common passwords weak', () => {
    expect(scorePassword('pass')).toBe('weak')
    expect(scorePassword('password')).toBe('weak')
  })
  it('rates a long varied passphrase strong', () => {
    expect(scorePassword('correct horse battery staple 9')).toBe('strong')
  })
  it('rates a medium password medium', () => {
    expect(scorePassword('Abcd1234')).toBe('medium')
  })
})
