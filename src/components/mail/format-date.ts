// Format de date d'une ligne de liste (FR), aligné sur la maquette.
// `now` injecté pour des tests déterministes.
export function formatThreadDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayMs = 86_400_000
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / dayMs)

  if (diffDays <= 0) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) return 'Hier'
  if (diffDays < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' })
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}
