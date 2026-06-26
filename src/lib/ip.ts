// Validateurs IP purs partagés (wizard client + BFF). Volontairement pragmatiques :
// la vérification DNS live confirme de toute façon la valeur réelle.

/** IPv4 stricte : 4 octets 0–255, sans zéros de tête. */
export function isIpv4(s: string): boolean {
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  return m.slice(1).every((o) => {
    const n = Number(o)
    return n >= 0 && n <= 255 && String(n) === o
  })
}

/** IPv6 : hex groups séparés par ':', avec compression '::' tolérée une fois.
 * Compte les groupes pour rejeter les formes incomplètes ou ambiguës. */
export function isIpv6(s: string): boolean {
  const v = s.trim()
  if (!v.includes(":")) return false
  if (!/^[0-9a-fA-F:]+$/.test(v)) return false

  const dcParts = v.split("::")
  if (dcParts.length > 2) return false // more than one "::"

  const validGroup = (g: string) => /^[0-9a-fA-F]{1,4}$/.test(g)
  const toGroups = (part: string) => (part.length > 0 ? part.split(":") : [])

  if (dcParts.length === 2) {
    // Compression :: présente : total de groupes explicites < 8
    const left = toGroups(dcParts[0])
    const right = toGroups(dcParts[1])
    if (![...left, ...right].every(validGroup)) return false
    return left.length + right.length < 8
  }
  // Pas de compression : exactement 8 groupes requis
  const allGroups = v.split(":")
  return allGroups.length === 8 && allGroups.every(validGroup)
}
