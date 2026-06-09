export type Strength = 'weak' | 'medium' | 'strong'

const COMMON = new Set(['password', '12345678', 'qwerty', 'azerty', 'admin'])

// Lightweight UX heuristic only — the server enforces real strength (zxcvbn).
export function scorePassword(pw: string): Strength {
  if (pw.length < 8 || COMMON.has(pw.toLowerCase())) return 'weak'
  let variety = 0
  if (/[a-z]/.test(pw)) variety++
  if (/[A-Z]/.test(pw)) variety++
  if (/[0-9]/.test(pw)) variety++
  if (/[^a-z0-9]/i.test(pw)) variety++
  if (pw.length >= 20 || (pw.length >= 12 && variety >= 3)) return 'strong'
  if (pw.length >= 10 && variety >= 2) return 'medium'
  return variety >= 3 ? 'medium' : 'weak'
}
