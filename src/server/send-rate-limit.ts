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
function assertAccount(account: string): void {
  if (!account.trim()) {
    throw new Error("send-rate-limit: account must be non-empty")
  }
}

export function isSendRateLimited(account: string, now = Date.now()): boolean {
  assertAccount(account)
  return recent(`a:${account.toLowerCase()}`, now).length >= MAX_PER_ACCOUNT
}

export function recordSend(account: string, now = Date.now()): void {
  assertAccount(account)
  const key = `a:${account.toLowerCase()}`
  const list = recent(key, now)
  list.push(now)
  sends.set(key, list)
}

export function __resetForTest(): void {
  sends.clear()
}
