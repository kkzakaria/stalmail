import {
  jmapCall,
  resolveAccountId,
  firstResponse,
  expectResult,
  JmapError,
} from "./jmap"
// DNS_PROVIDERS / DnsProvider live in a client-safe shared module so the wizard
// UI can import the runtime constant without pulling this server-only file
// (node:fs, JMAP transport) into the browser bundle. Re-exported here for the
// server-side call sites.
import { DNS_PROVIDERS } from "@/lib/dns-providers"
import type { DnsProvider } from "@/lib/dns-providers"

export { DNS_PROVIDERS, type DnsProvider }

export interface DnsServerInput {
  provider: DnsProvider
  secret: string
  description?: string
}

// Stalwart v0.16 : le champ credential d'un DnsServer est de type `SecretKey`,
// une union typée — PAS une chaîne nue. La variante en clair est `Value` :
// `{ "@type": "Value", "secret": "<token>" }` (cf. l'exemple JMAP de la doc
// officielle https://stalw.art/docs/ref/object/dns-server/). Envoyer une string
// fait échouer la création (`invalidPatch: Missing or invalid '@type' property`).
// Générique : ce wrapping vaut pour tous les providers « à secret unique »
// (Cloudflare, DeSEC, Bunny, DigitalOcean, OVH, Porkbun…). Les providers multi-
// credentials (Route53 : accessKeyId + secretAccessKey ; Tsig : host/keyName/key)
// exigent des champs supplémentaires non collectés par le wizard — hors périmètre.
function secretKey(value: string): { "@type": "Value"; secret: string } {
  return { "@type": "Value", secret: value }
}

export async function findDnsServerId(
  provider: DnsProvider
): Promise<string | null> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ["x:DnsServer/query", { accountId }, "0"],
    [
      "x:DnsServer/get",
      {
        accountId,
        "#ids": { resultOf: "0", name: "x:DnsServer/query", path: "/ids" },
      },
      "1",
    ],
  ])
  const list =
    (
      expectResult(responses, 1) as {
        list?: Array<{ id: string; "@type"?: string }>
      }
    ).list ?? []
  return list.find((s) => s["@type"] === provider)?.id ?? null
}

export async function createDnsServer(input: DnsServerInput): Promise<string> {
  const accountId = await resolveAccountId()

  // Idempotent reuse: a DnsServer for this provider already exists. Update its
  // secret rather than returning it unchanged so a retry with a CORRECTED token
  // takes effect (a known-bad token must not be replayed). Still no duplicate.
  const existing = await findDnsServerId(input.provider)
  if (existing) {
    const responses = await jmapCall([
      [
        "x:DnsServer/set",
        {
          accountId,
          update: { [existing]: { secret: secretKey(input.secret) } },
        },
        "0",
      ],
    ])
    const upd = firstResponse(responses)[1] as {
      updated?: Record<string, unknown>
      notUpdated?: unknown
    }
    if (!upd.updated || !(existing in upd.updated))
      throw new JmapError("dns server secret update rejected", upd.notUpdated)
    return existing
  }

  const responses = await jmapCall([
    [
      "x:DnsServer/set",
      {
        accountId,
        create: {
          new1: {
            "@type": input.provider,
            description: input.description ?? `${input.provider} (Stalmail)`,
            secret: secretKey(input.secret),
          },
        },
      },
      "0",
    ],
  ])
  const result = firstResponse(responses)[1] as {
    created?: { new1?: { id: string } }
    notCreated?: unknown
  }
  const created = result.created?.new1
  if (!created)
    throw new JmapError("dns server creation rejected", result.notCreated)
  return created.id
}

export type DnsManagementStatus = "pending" | "failed" | "published"

export interface DnsManagementTask {
  "@type"?: string
  status?: { "@type"?: string }
  due?: string
}

/**
 * Décide le statut de publication à partir de la tâche DnsManagement.
 * Pure. Probe live (#62) : succès → la tâche disparaît ; échec → la tâche
 * persiste en `Failed`. Pas de fenêtre temporelle (publication one-shot, pas
 * de cycle de renouvellement comme AcmeRenewal).
 *
 *  - aucune tâche → published (publiée puis nettoyée)
 *  - statut Failed → failed
 *  - Pending / Retry / statut absent → pending (en cours)
 */
export function classifyDnsManagement(
  task: DnsManagementTask | undefined
): DnsManagementStatus {
  if (!task) return "published"
  if (task.status?.["@type"] === "Failed") return "failed"
  return "pending"
}

/** Sonde la tâche DnsManagement. Voir classifyDnsManagement pour le mapping. */
export async function getDnsManagementStatus(): Promise<DnsManagementStatus> {
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
    (expectResult(responses, 1) as { list?: DnsManagementTask[] }).list ?? []
  const task = list.find((t) => t["@type"] === "DnsManagement")
  return classifyDnsManagement(task)
}
