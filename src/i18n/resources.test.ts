import { describe, expect, it } from 'vitest'
import { fr, en } from './resources'

function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keyPaths(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

describe('i18n resources', () => {
  it('fr and en have identical key paths', () => {
    expect(keyPaths(en)).toEqual(keyPaths(fr))
  })
  it('interpolation placeholders match between fr and en', () => {
    const frFlat = Object.fromEntries(keyPaths(fr).map((p) => [p, p]))
    // spot-check a couple of interpolated keys exist
    expect(frFlat['wizard.domain.ext']).toBeDefined()
    expect(fr.wizard.recap.dnsAuto).toContain('{{provider}}')
    expect(en.wizard.recap.dnsAuto).toContain('{{provider}}')
  })
})
