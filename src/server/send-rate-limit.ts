// Throttle d'envoi par compte (in-memory, BFF mono-process). Borne le spam sortant
// avant EmailSubmission/set (audit 4c B4). La clé `account` est l'accountId de session
// fourni par sendMailFn (P2) — jamais une chaîne vide (sinon throttle global).
// Limite assumée (R-H) : mono-process, remis à zéro au redémarrage (comme login-rate-limit).
const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_ACCOUNT = 30

const sends = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const list = (sends.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length === 0) sends.delete(key)
  else sends.set(key, list)
  return list
}

// Garde défensive (P2) : un account vide ferait `a:` → pool global partagé entre tous
// les comptes (contournement de l'anti-abus). On rejette plutôt que de dégrader en silence.
// Clé normalisée (trim + lowercase) : `"me@x.fr"`, `" me@x.fr "` et `"ME@X.FR"` partagent
// le même bucket (sinon les espaces de bord créeraient un bucket distinct — contournement).
function keyFor(account: string): string {
  const normalized = account.trim().toLowerCase()
  if (!normalized) {
    throw new Error("send-rate-limit: account must be non-empty")
  }
  return `a:${normalized}`
}

export function isSendRateLimited(account: string, now = Date.now()): boolean {
  return recent(keyFor(account), now).length >= MAX_PER_ACCOUNT
}

export function recordSend(account: string, now = Date.now()): void {
  const key = keyFor(account)
  const list = recent(key, now)
  list.push(now)
  sends.set(key, list)
}

// Atomique : élague + vérifie + consomme un créneau en UNE passe synchrone (pas d'await
// intercalé). À appeler en tête de sendMailFn — sinon deux envois concurrents passent tous
// deux le check avant que l'un n'enregistre, dépassant le cap (CodeRabbit #7). Retourne false
// si le compte est déjà au plafond (créneau NON consommé). Compte les tentatives, pas les succès.
export function consumeSendSlot(account: string, now = Date.now()): boolean {
  const key = keyFor(account)
  const list = recent(key, now)
  if (list.length >= MAX_PER_ACCOUNT) return false
  list.push(now)
  sends.set(key, list)
  return true
}

export function __resetForTest(): void {
  sends.clear()
}
