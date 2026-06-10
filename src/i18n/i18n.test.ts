import { describe, it, expect } from 'vitest'
import { fr, en } from './resources'
import { createI18n, SUPPORTED_LANGS } from './i18n'

const keys = (obj: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )

describe('i18n resources', () => {
  it('FR and EN have identical key sets', () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort())
  })

  it('exposes fr and en as supported languages', () => {
    expect(SUPPORTED_LANGS).toEqual(['fr', 'en'])
  })

  it('resolves a key in the requested language', async () => {
    const i18n = createI18n('en')
    await i18n.init
    expect(i18n.t('wizard.welcome.start')).toBe(en.wizard.welcome.start)
    expect(i18n.getResource('fr', 'translation', 'wizard.welcome.start')).toBe(
      fr.wizard.welcome.start,
    )
  })
})
