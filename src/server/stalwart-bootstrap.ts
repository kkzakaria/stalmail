import {
  jmapCall,
  resolveAccountId,
  isBootstrapForbidden,
  JmapError,
  firstResponse,
} from "./jmap"

export interface BootstrapInput {
  serverHostname: string
  defaultDomain: string
}

export interface GeneratedAdmin {
  username: string
  secret: string
}

export async function isBootstrapMode(): Promise<boolean> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([["x:Domain/query", { accountId }, "0"]])
  const [name, result] = firstResponse(responses)
  if (name === "error") {
    if (isBootstrapForbidden(result)) return true
    throw new JmapError("unexpected error probing bootstrap mode", result)
  }
  return false
}

export async function getBootstrap(): Promise<Record<string, unknown>> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ["x:Bootstrap/get", { accountId, ids: null }, "0"],
  ])
  const result = firstResponse(responses)[1] as {
    list?: Record<string, unknown>[]
  }
  const obj = result.list?.[0]
  if (!obj) throw new JmapError("bootstrap singleton not found")
  return obj
}

/**
 * Nom que le serveur mail annonce (bannière EHLO, cible MX) — la valeur écrite
 * par le wizard au bootstrap. Source autoritaire pour le SAN du certificat :
 * c'est la seule identité que Stalwart ait besoin de prouver sur ses ports mail.
 * Le webmail, lui, est couvert par Caddy.
 */
export async function getServerHostname(): Promise<string> {
  const bootstrap = await getBootstrap()
  const value = bootstrap.serverHostname
  return typeof value === "string" ? value : ""
}

export async function submitBootstrap(
  input: BootstrapInput
): Promise<GeneratedAdmin> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      "x:Bootstrap/set",
      {
        accountId,
        update: {
          singleton: {
            serverHostname: input.serverHostname,
            defaultDomain: input.defaultDomain,
            requestTlsCertificate: false,
            generateDkimKeys: true,
            directory: { "@type": "Internal" },
            dnsServer: { "@type": "Manual" },
          },
        },
      },
      "0",
    ],
  ])
  const result = firstResponse(responses)[1] as {
    updated?: { singleton?: GeneratedAdmin }
    notUpdated?: unknown
  }
  const admin = result.updated?.singleton
  if (!admin) {
    throw new JmapError("bootstrap submission rejected", result.notUpdated)
  }
  return admin
}
