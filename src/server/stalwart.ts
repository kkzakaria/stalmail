const base = (): string => process.env.STALWART_URL ?? 'http://localhost:8080'

function authHeader(): string {
  const creds = process.env.STALWART_RECOVERY_ADMIN ?? ''
  return `Basic ${Buffer.from(creds).toString('base64')}`
}

export async function stalwartHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/healthz/live`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function stalwartAdminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${base()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}
