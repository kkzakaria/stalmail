import {
  jmapCall,
  resolveAccountId,
  firstResponse,
  expectResult,
  JmapError,
} from "./jmap"

const LETSENCRYPT_DIRECTORY = "https://acme-v02.api.letsencrypt.org/directory"

export interface ConfigureAcmeInput {
  domainId: string
  hostname: string
  contactEmail: string
  /** Override the ACME directory (e.g. Let's Encrypt staging in tests). */
  directory?: string
}

/**
 * Creates an AcmeProvider (LE / DNS-01) and flips the domain to Automatic cert management.
 *
 * DNS-01 (et non TLS-ALPN-01) : la validation publie un TXT `_acme-challenge` via le
 * provider DNS déjà configuré (DnsServer + domaine en `dnsManagement: Automatic`, posés
 * aux étapes précédentes du wizard). Aucun port 443 requis — indispensable derrière un
 * reverse proxy (Caddy) qui possède :443, sinon le défi TLS-ALPN-01 frapperait le proxy
 * et l'émission échouerait. Stalwart obtient ainsi son cert (ports mail) indépendamment.
 */
export async function configureAcme(
  input: ConfigureAcmeInput
): Promise<string> {
  const accountId = await resolveAccountId()
  // 1) Create the ACME provider — VERIFIED v0.16 shapes (recon §9):
  //    challengeType: enum string; contact: map {"mailto:<email>": true}; renewBefore omitted.
  //    DNS-01 s'appuie sur le dnsManagement: Automatic (dnsServerId) du domaine.
  const createResp = await jmapCall([
    [
      "x:AcmeProvider/set",
      {
        accountId,
        create: {
          p1: {
            directory: input.directory ?? LETSENCRYPT_DIRECTORY,
            challengeType: "Dns01",
            contact: { [`mailto:${input.contactEmail}`]: true },
          },
        },
      },
      "0",
    ],
  ])
  const created = firstResponse(createResp)[1] as {
    created?: { p1?: { id: string } }
    notCreated?: { p1?: unknown }
  }
  const providerId = created.created?.p1?.id
  if (!providerId)
    throw new JmapError("ACME provider creation rejected", created.notCreated)

  // 2) Flip the domain to Automatic — SAN is a map {"<host>": true}, optional.
  const updResp = await jmapCall([
    [
      "x:Domain/set",
      {
        accountId,
        update: {
          [input.domainId]: {
            certificateManagement: {
              "@type": "Automatic",
              acmeProviderId: providerId,
              subjectAlternativeNames: { [input.hostname]: true },
            },
          },
        },
      },
      "0",
    ],
  ])
  const upd = firstResponse(updResp)[1] as {
    updated?: Record<string, unknown>
    notUpdated?: unknown
  }
  if (!upd.updated || !(input.domainId in upd.updated)) {
    throw new JmapError(
      "domain certificateManagement update rejected",
      upd.notUpdated
    )
  }
  return providerId
}

export type AcmeStatus = "pending" | "failed" | "valid"

// Une tâche de renouvellement planifiée plus loin que ce seuil signifie qu'un
// certificat est DÉJÀ en place : Stalwart planifie le renouvellement ~30 j avant
// l'expiration à 90 j. Une émission/retry encore en cours est due de façon imminente
// ou dépassée. 1 jour sépare nettement le délai de renouvellement (~30-60 j) de tout
// backoff de retry ACME (minutes/heures). Confirmé en prod : tâche Pending due à +60 j
// alors que `openssl s_client` renvoyait déjà un cert Let's Encrypt valide.
export const RENEWAL_LEAD_MS = 24 * 60 * 60 * 1000

export interface AcmeRenewalTask {
  "@type"?: string
  status?: { "@type"?: string }
  due?: string
}

/**
 * Décide le statut SSL à partir de la tâche AcmeRenewal et de l'instant courant.
 * Pure et temps-injecté pour des tests déterministes.
 *
 *  - aucune tâche → valid (rien en attente)
 *  - statut Failed → failed
 *  - Pending/Retry due loin dans le futur → valid (cert obtenu, renouvellement planifié)
 *  - Pending/Retry due imminente/dépassée/absente → pending (émission en cours)
 */
export function classifyAcmeRenewal(
  task: AcmeRenewalTask | undefined,
  nowMs: number
): AcmeStatus {
  if (!task) return "valid"
  if (task.status?.["@type"] === "Failed") return "failed"
  const dueMs = Date.parse(task.due ?? "")
  if (Number.isFinite(dueMs) && dueMs - nowMs > RENEWAL_LEAD_MS) return "valid"
  return "pending"
}

/** Sonde la tâche AcmeRenewal (non bloquant). Voir classifyAcmeRenewal pour le mapping. */
export async function getAcmeStatus(): Promise<AcmeStatus> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ["x:Task/query", { accountId }, "0"],
    [
      "x:Task/get",
      {
        accountId,
        "#ids": { resultOf: "0", name: "x:Task/query", path: "/ids" },
      },
      "1",
    ],
  ])
  const list =
    (expectResult(responses, 1) as { list?: AcmeRenewalTask[] }).list ?? []
  const task = list.find((t) => t["@type"] === "AcmeRenewal")
  return classifyAcmeRenewal(task, Date.now())
}
