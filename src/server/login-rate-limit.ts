// Sliding-window login throttle (in-memory — the BFF is single-process). Counts
// failed attempts per account AND per client IP before /api/auth is ever called,
// so brute force is absorbed here instead of pooling failures on the BFF's IP in
// Stalwart (auto-ban: authBanRate 100/day per source IP).
const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_ACCOUNT = 10
const MAX_PER_IP = 30

const attempts = new Map<string, number[]>()

const PRUNE_THRESHOLD = 10_000
const PRUNE_INTERVAL_MS = WINDOW_MS
let nextPruneAt = 0

function pruneAll(now: number): void {
  for (const [key, list] of attempts) {
    const fresh = list.filter((t) => now - t < WINDOW_MS)
    if (fresh.length === 0) attempts.delete(key)
    else attempts.set(key, fresh)
  }
}

// Prune at most once per window so the throttle path never becomes an O(n)-per-request hotspot.
function maybePruneAll(now: number): void {
  if (attempts.size <= PRUNE_THRESHOLD) return
  if (now < nextPruneAt) return
  pruneAll(now)
  nextPruneAt = now + PRUNE_INTERVAL_MS
}

function recent(key: string, now: number): number[] {
  const list = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length === 0) attempts.delete(key)
  else attempts.set(key, list)
  return list
}

export function isRateLimited(account: string, ip: string | undefined, now = Date.now()): boolean {
  if (recent(`a:${account.toLowerCase()}`, now).length >= MAX_PER_ACCOUNT) return true
  if (ip && recent(`i:${ip}`, now).length >= MAX_PER_IP) return true
  return false
}

export function recordFailure(account: string, ip: string | undefined, now = Date.now()): void {
  maybePruneAll(now)
  for (const key of [`a:${account.toLowerCase()}`, ...(ip ? [`i:${ip}`] : [])]) {
    const list = recent(key, now)
    list.push(now)
    attempts.set(key, list)
  }
}

// test-only
export function __resetForTest(): void {
  attempts.clear()
  nextPruneAt = 0
}

export function __mapSizeForTest(): number {
  return attempts.size
}
