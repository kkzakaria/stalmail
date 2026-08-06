/**
 * Le focus quitte-t-il la zone destinataires ?
 *
 * Règle partagée par les deux composeurs (design 2026-08-06) : une rangée
 * Cc/Cci vide ne se referme qu'en SORTANT de la zone — circuler entre ses
 * champs et ses bascules ne referme rien.
 */
export function leavesZone(
  zone: HTMLElement,
  related: Element | null
): boolean {
  // relatedTarget nul = la fenêtre a perdu le focus (alt-tab) : ne rien
  // refermer, l'utilisateur va probablement chercher une adresse ailleurs.
  if (related === null) return false
  return !zone.contains(related)
}
