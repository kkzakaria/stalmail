import { describe, expect, it } from 'vitest'
import { formatThreadDate } from './format-date'

const now = new Date('2026-06-12T10:00:00')

describe('formatThreadDate', () => {
  it('aujourd\'hui → heure HH:MM', () => {
    expect(formatThreadDate('2026-06-12T08:30:00', now)).toBe('08:30')
  })
  it('hier → "Hier"', () => {
    expect(formatThreadDate('2026-06-11T22:00:00', now)).toBe('Hier')
  })
  it('même semaine → jour de la semaine', () => {
    // 2026-06-08 = lundi
    expect(formatThreadDate('2026-06-08T09:00:00', now)).toBe('lun.')
  })
  it('plus ancien → JJ/MM', () => {
    expect(formatThreadDate('2026-05-02T09:00:00', now)).toBe('02/05')
  })
})
