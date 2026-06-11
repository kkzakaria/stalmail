export class OAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthError'
  }
}

function base(): string {
  return process.env.STALWART_URL ?? 'http://localhost:8080'
}

export type ApiAuthResult =
  | { type: 'authenticated'; clientCode: string }
  | { type: 'mfaRequired' }
  | { type: 'failure' }

export async function postApiAuth(input: {
  accountName: string
  accountSecret: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  forwardedFor?: string
  mfaToken?: string
}): Promise<ApiAuthResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (input.forwardedFor) headers['X-Forwarded-For'] = input.forwardedFor
  const res = await fetch(`${base()}/api/auth`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'authCode',
      accountName: input.accountName,
      accountSecret: input.accountSecret,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      ...(input.mfaToken ? { mfaToken: input.mfaToken } : {}),
    }),
  })
  // /api/auth always answers 200 with the business status in `type`.
  if (!res.ok) throw new OAuthError(`/api/auth HTTP ${res.status}`)
  let body: { type?: string; client_code?: string }
  try {
    body = (await res.json()) as { type?: string; client_code?: string }
  } catch {
    throw new OAuthError(`/api/auth: non-JSON body (status ${res.status})`)
  }
  if (body.type === 'authenticated') {
    if (!body.client_code) throw new OAuthError('authenticated response missing client_code')
    return { type: 'authenticated', clientCode: body.client_code }
  }
  if (body.type === 'mfaRequired') return { type: 'mfaRequired' }
  return { type: 'failure' }
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  expiresIn: number
}

async function tokenRequest(form: Record<string, string>): Promise<TokenSet> {
  // Public PKCE client: NO Authorization/client_secret (Stalwart → invalid_client).
  const res = await fetch(`${base()}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  if (!res.ok) throw new OAuthError(`/auth/token HTTP ${res.status}`)
  let body: {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  try {
    body = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
  } catch {
    throw new OAuthError(`/auth/token: non-JSON body (status ${res.status})`)
  }
  if (!body.access_token) throw new OAuthError('no access_token in token response')
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresIn: body.expires_in ?? 3600,
  }
}

export function exchangeCode(input: {
  code: string
  codeVerifier: string
  clientId: string
  redirectUri: string
}): Promise<TokenSet> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
  })
}

export function refreshTokens(input: { refreshToken: string; clientId: string }): Promise<TokenSet> {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  })
}
