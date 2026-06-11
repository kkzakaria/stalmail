function base(): string {
  return process.env.STALWART_URL ?? 'http://localhost:8080'
}

// User-scoped Stalwart call with an OAuth access token (parallels stalwartAdminFetch).
export async function stalwartUserFetch(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${base()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      // assumes object-literal headers (callers in this repo never pass Headers/array forms)
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}

// Minimal authenticated probe: proves the Bearer token reaches JMAP and yields
// the principal id + email used to label the session.
export async function fetchJmapAccount(
  accessToken: string,
): Promise<{ accountId: string; accountName: string }> {
  const res = await stalwartUserFetch('/jmap/session', accessToken, { method: 'GET' })
  if (!res.ok) throw new Error(`jmap session HTTP ${res.status}`)
  let s: { username?: string; primaryAccounts?: Record<string, string> }
  try {
    s = (await res.json()) as { username?: string; primaryAccounts?: Record<string, string> }
  } catch {
    throw new Error(`jmap session: non-JSON body (status ${res.status})`)
  }
  const accountId =
    s.primaryAccounts?.['urn:ietf:params:jmap:core'] ?? Object.values(s.primaryAccounts ?? {})[0]
  if (!accountId || !s.username) throw new Error('jmap session missing account')
  return { accountId, accountName: s.username }
}
