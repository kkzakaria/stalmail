// Petit utilitaire de délai, isolé pour être mockable dans les tests (les handlers de
// setup l'importent pour espacer un retry sans introduire de vrai sleep sous test).
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
