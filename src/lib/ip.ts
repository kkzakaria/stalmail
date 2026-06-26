// Validateurs IP purs partagés (wizard client + BFF). Volontairement pragmatiques :
// la vérification DNS live confirme de toute façon la valeur réelle.

/** IPv4 stricte : 4 octets 0–255. */
export function isIpv4(s: string): boolean {
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  return m.slice(1).every((o) => {
    const n = Number(o)
    return n >= 0 && n <= 255 && String(n) === String(Number(o))
  })
}

/** IPv6 : hex groups séparés par ':', avec compression '::' tolérée. Pas une validation
 * RFC complète — exclut simplement l'IPv4 et le bruit évident. */
export function isIpv6(s: string): boolean {
  const v = s.trim()
  if (!v.includes(":")) return false
  if (!/^[0-9a-fA-F:]+$/.test(v)) return false
  // au plus une compression '::'
  if ((v.match(/::/g) ?? []).length > 1) return false
  return true
}
