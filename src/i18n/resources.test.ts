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
  it('interpolation placeholders match between fr and en for every key', () => {
    const extractPlaceholders = (str: string): string[] =>
      Array.from(str.matchAll(/\{\{(\w+)\}\}/g), (m) => m[1]).sort()
    const getValue = (obj: Record<string, unknown>, path: string): string =>
      path
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as string

    for (const path of keyPaths(fr)) {
      expect(extractPlaceholders(getValue(en, path)), `placeholders mismatch at ${path}`).toEqual(
        extractPlaceholders(getValue(fr, path)),
      )
    }
  })
})
