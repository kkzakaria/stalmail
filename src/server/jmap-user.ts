import { redirect } from "@tanstack/react-router"
import { withFreshAccessToken } from "./session"
import { stalwartUserFetch } from "./stalwart-user"
import type { JmapMethodCall, JmapMethodResponse } from "./jmap"

export class JmapUserError extends Error {
  constructor(
    message: string,
    readonly type?: string,
    readonly detail?: unknown
  ) {
    super(message)
    this.name = "JmapUserError"
  }
}

const MAIL_CAPABILITIES = [
  "urn:ietf:params:jmap:core",
  "urn:ietf:params:jmap:mail",
]

// Capabilities pour l'envoi (R5) : submission ajouté UNIQUEMENT pour sendMailFn.
export const SUBMISSION_CAPABILITIES = [
  ...MAIL_CAPABILITIES,
  "urn:ietf:params:jmap:submission",
]

// Identity/* et EmailSubmission/* relèvent de la spec JMAP submission : Stalwart les
// rejette en `unknownMethod` si `urn:ietf:params:jmap:submission` est absent de `using`.
// On dérive donc les capabilities du batch et on ajoute submission AU STRICT BESOIN
// (R5, moindre privilège) — uniquement quand une de ces méthodes est présente. Cela
// évite qu'un appel mêlant Mailbox/get + Identity/get (cf. sendMailFn) échoue faute de
// capability déclarée.
const SUBMISSION_METHOD = /^(Identity|EmailSubmission)\//
export function capabilitiesForBatch(
  methodCalls: JmapMethodCall[],
  base: string[] = MAIL_CAPABILITIES
): string[] {
  return methodCalls.some(([name]) => SUBMISSION_METHOD.test(name))
    ? [...base, "urn:ietf:params:jmap:submission"]
    : [...base] // copie : ne jamais exposer la constante MAIL_CAPABILITIES partagée
}

// Appel JMAP batch avec le token Bearer de l'utilisateur. Session expirée → redirect /login.
// `capabilities` explicite l'emporte ; sinon on les dérive du batch (capabilitiesForBatch).
export async function jmapUserCall(
  sid: string,
  methodCalls: JmapMethodCall[],
  capabilities?: string[]
): Promise<JmapMethodResponse[]> {
  const accessToken = await withFreshAccessToken(sid)
  if (accessToken === null) throw redirect({ to: "/login" })

  const using = capabilities ?? capabilitiesForBatch(methodCalls)
  const res = await stalwartUserFetch("/jmap/", accessToken, {
    method: "POST",
    body: JSON.stringify({ using, methodCalls }),
  })
  if (!res.ok)
    throw new JmapUserError(`jmap request failed: HTTP ${res.status}`)

  let body: { methodResponses?: JmapMethodResponse[] }
  try {
    body = (await res.json()) as { methodResponses?: JmapMethodResponse[] }
  } catch {
    throw new JmapUserError(
      `jmap response: non-JSON body (status ${res.status})`
    )
  }
  if (!Array.isArray(body.methodResponses)) {
    throw new JmapUserError(
      "jmap response missing methodResponses",
      undefined,
      body
    )
  }
  const responses = body.methodResponses
  for (const [name, args] of responses) {
    if (name === "error") {
      const e = args as { type?: string; description?: string }
      throw new JmapUserError(
        e.description ?? "jmap method error",
        e.type,
        args
      )
    }
  }
  return responses
}
