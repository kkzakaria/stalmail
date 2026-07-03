// Throttle des mutations d'allowlist images par compte (#126) — miroir de
// send-rate-limit. Chaque mutation réécrit image-prefs.json en entier : sans borne,
// un client authentifié peut marteler trustSenderFn (amplification d'écriture disque).
// Limite assumée : in-memory mono-process, remis à zéro au redémarrage.
const WINDOW_MS = 60 * 60 * 1000
export const MAX_PREFS_MUTATIONS = 60

const mutations = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const list = (mutations.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length === 0) mutations.delete(key)
  else mutations.set(key, list)
  return list
}

// Garde défensive : un account vide ferait un pool global partagé entre tous les
// comptes (contournement de l'anti-abus). On rejette plutôt que dégrader en silence.
function keyFor(account: string): string {
  const normalized = account.trim().toLowerCase()
  if (!normalized) {
    throw new Error("image-prefs-rate-limit: account must be non-empty")
  }
  return `a:${normalized}`
}

// Atomique : élague + vérifie + consomme en UNE passe synchrone (aucun await intercalé).
// À appeler juste après requireSession() dans les handlers (patron consumeSendSlot).
// Retourne false si le compte est au plafond (créneau NON consommé).
export function consumeMutationSlot(
  account: string,
  now = Date.now()
): boolean {
  const key = keyFor(account)
  const list = recent(key, now)
  if (list.length >= MAX_PREFS_MUTATIONS) return false
  list.push(now)
  mutations.set(key, list)
  return true
}

export function __resetForTest(): void {
  mutations.clear()
}
