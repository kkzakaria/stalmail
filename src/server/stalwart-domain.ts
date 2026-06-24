import {
  jmapCall,
  resolveAccountId,
  firstResponse,
  expectResult,
  JmapError,
} from "./jmap"

export interface StalwartDomain {
  id: string
  name: string
  dnsZoneFile?: string
  dnsManagement?: { "@type": string; [k: string]: unknown }
  certificateManagement?: { "@type": string; [k: string]: unknown }
  [k: string]: unknown
}

export async function getPrimaryDomain(): Promise<StalwartDomain | null> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ["x:Domain/query", { accountId }, "0"],
    [
      "x:Domain/get",
      {
        accountId,
        "#ids": { resultOf: "0", name: "x:Domain/query", path: "/ids" },
      },
      "1",
    ],
  ])
  const list =
    (expectResult(responses, 1) as { list?: StalwartDomain[] }).list ?? []
  return list[0] ?? null
}

export async function setDnsManagementAutomatic(opts: {
  domainId: string
  dnsServerId: string
  origin: string
}): Promise<void> {
  const { domainId, dnsServerId, origin } = opts
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      "x:Domain/set",
      {
        accountId,
        update: {
          [domainId]: {
            // publishRecords est OMIS volontairement : Stalwart applique alors son
            // défaut (tous les types d'enregistrement à true). L'envoyer explicitement
            // exige la forme objet-de-booléens ({ dkim: true, ... }) — un tableau est
            // rejeté en invalidPatch. Omettre est aussi forward-compatible : un nouveau
            // type d'enregistrement ajouté par Stalwart sera publié par défaut.
            dnsManagement: {
              "@type": "Automatic",
              dnsServerId,
              origin,
            },
          },
        },
      },
      "0",
    ],
  ])
  const result = firstResponse(responses)[1] as {
    updated?: Record<string, unknown>
    notUpdated?: unknown
  }
  if (!result.updated || !(domainId in result.updated)) {
    throw new JmapError(
      "domain dnsManagement update rejected",
      result.notUpdated
    )
  }
}

export async function setDnsManagementManual(opts: {
  domainId: string
}): Promise<void> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      "x:Domain/set",
      {
        accountId,
        update: { [opts.domainId]: { dnsManagement: { "@type": "Manual" } } },
      },
      "0",
    ],
  ])
  const result = firstResponse(responses)[1] as {
    updated?: Record<string, unknown>
    notUpdated?: unknown
  }
  if (!result.updated || !(opts.domainId in result.updated)) {
    throw new JmapError(
      "domain dnsManagement (manual) update rejected",
      result.notUpdated
    )
  }
}
