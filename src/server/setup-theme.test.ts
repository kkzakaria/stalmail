import { describe, expect, it } from 'vitest'
import { parseThemeCookie, isTheme, DEFAULT_THEME } from './setup-theme'

describe('parseThemeCookie', () => {
  it('returns the default when no header', () => {
    expect(parseThemeCookie(undefined)).toBe(DEFAULT_THEME)
  })
  it('reads a valid theme', () => {
    expect(parseThemeCookie('stalmail_theme=dark')).toBe('dark')
    expect(parseThemeCookie('foo=1; stalmail_theme=light; bar=2')).toBe('light')
  })
  it('falls back on an invalid value', () => {
    expect(parseThemeCookie('stalmail_theme=purple')).toBe(DEFAULT_THEME)
  })
})

describe('isTheme', () => {
  it('narrows valid themes', () => {
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('nope')).toBe(false)
  })
})
