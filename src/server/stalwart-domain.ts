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

  // Retry (token corrigé) — deux écueils vérifiés par probe (#62) :
  //  1. Une ancienne tâche DnsManagement `Failed` PERSISTE et masquerait le nouvel
  //     essai (getDnsManagementStatus la retrouverait → erreur/blocage). On purge les
  //     tâches DnsManagement ÉCHOUÉES uniquement (jamais une tâche active/en cours).
  //  2. Re-poser `Automatic` sur un domaine DÉJÀ `Automatic` est un NO-OP : aucune
  //     re-publication n'est planifiée. Seul le PASSAGE en `Automatic` crée une tâche
  //     fraîche → on force la transition `Manual` → `Automatic`.
  // Au premier passage (domaine `Manual`), la purge est vide et le setManual est un
  // no-op inoffensif ; le succès nettoie ensuite sa propre tâche (pas de résiduel).
  const taskResp = await jmapCall([
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
  const failedTaskIds = (
    (
      expectResult(taskResp, 1) as {
        list?: Array<{
          "@type"?: string
          id?: string
          status?: { "@type"?: string }
        }>
      }
    ).list ?? []
  )
    .filter(
      (t) =>
        t["@type"] === "DnsManagement" &&
        t.status?.["@type"] === "Failed" &&
        typeof t.id === "string"
    )
    .map((t) => t.id as string)
  if (failedTaskIds.length > 0) {
    const destroyResp = await jmapCall([
      ["x:Task/set", { accountId, destroy: failedTaskIds }, "0"],
    ])
    // jmapCall ne throw que sur erreur HTTP : une erreur de méthode remonte en
    // réponse `["error", …]` — la traiter pour ne pas laisser de tâche périmée.
    if (firstResponse(destroyResp)[0] === "error") {
      throw new JmapError(
        "stale DnsManagement task purge rejected",
        firstResponse(destroyResp)[1]
      )
    }
  }

  // Force la transition `Manual` → `Automatic` : le passage EN Automatic est la seule
  // façon de planifier une publication fraîche. On vérifie qu'elle a bien pris (sinon
  // l'écriture Automatic suivante serait un no-op et rien ne serait republié).
  const manualResp = await jmapCall([
    [
      "x:Domain/set",
      {
        accountId,
        update: { [domainId]: { dnsManagement: { "@type": "Manual" } } },
      },
      "0",
    ],
  ])
  const manual = firstResponse(manualResp)[1] as {
    updated?: Record<string, unknown>
    notUpdated?: unknown
  }
  if (!manual.updated || !(domainId in manual.updated)) {
    throw new JmapError(
      "transient Manual dnsManagement update rejected",
      manual.notUpdated
    )
  }

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
