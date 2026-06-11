// Sliding-window login throttle (in-memory — the BFF is single-process). Counts
// failed attempts per account AND per client IP before /api/auth is ever called,
// so brute force is absorbed here instead of pooling failures on the BFF's IP in
// Stalwart (auto-ban: authBanRate 100/day per source IP).
const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_ACCOUNT = 10
const MAX_PER_IP = 30

const attempts = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const list = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  attempts.set(key, list)
  return list
}

export function isRateLimited(account: string, ip: string | undefined, now = Date.now()): boolean {
  if (recent(`a:${account.toLowerCase()}`, now).length >= MAX_PER_ACCOUNT) return true
  if (ip && recent(`i:${ip}`, now).length >= MAX_PER_IP) return true
  return false
}

export function recordFailure(account: string, ip: string | undefined, now = Date.now()): void {
  recent(`a:${account.toLowerCase()}`, now).push(now)
  if (ip) recent(`i:${ip}`, now).push(now)
}

// test-only
export function __resetForTest(): void {
  attempts.clear()
}
