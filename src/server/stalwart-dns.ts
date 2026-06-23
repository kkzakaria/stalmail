import { jmapCall, resolveAccountId, firstResponse, JmapError } from "./jmap"

// Captured from the v0.16 schema enum DnsServerBootstrapType. The enum lists 71
// entries; the deprecated placeholder ("Deprecated1") is omitted here, leaving 70.
// See docs/superpowers/specs/2026-06-09-stalwart-api-capture.md §6.
export const DNS_PROVIDERS = [
  "Manual",
  "Tsig",
  "Cloudflare",
  "DigitalOcean",
  "DeSEC",
  "Ovh",
  "Bunny",
  "Porkbun",
  "Dnsimple",
  "Spaceship",
  "Route53",
  "GoogleCloudDns",
  "Alidns",
  "ArvanCloud",
  "Autodns",
  "AzureDns",
  "BaiduCloud",
  "BluecatV2",
  "ClouDns",
  "Constellix",
  "Cpanel",
  "Ddnss",
  "DnsMadeEasy",
  "Domeneshop",
  "Dreamhost",
  "DuckDns",
  "Dynu",
  "EasyDns",
  "EdgeDns",
  "Exoscale",
  "FreeMyIp",
  "GandiV5",
  "Gcore",
  "Glesys",
  "Godaddy",
  "Hetzner",
  "HostingDe",
  "Hostinger",
  "HuaweiCloud",
  "Hurricane",
  "IbmCloud",
  "Infoblox",
  "Infomaniak",
  "Inwx",
  "Ionos",
  "Ipv64",
  "Joker",
  "Lightsail",
  "Linode",
  "LuaDns",
  "MythicBeasts",
  "Namecheap",
  "NameDotCom",
  "NameSilo",
  "Netcup",
  "Netlify",
  "Nifcloud",
  "Ns1",
  "OracleCloud",
  "Plesk",
  "Safedns",
  "Scaleway",
  "TencentCloud",
  "Transip",
  "UltraDns",
  "Vercel",
  "Volcengine",
  "Vultr",
  "WebSupport",
  "YandexCloud",
] as const

export type DnsProvider = (typeof DNS_PROVIDERS)[number]

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

export async function createDnsServer(input: DnsServerInput): Promise<string> {
  const accountId = await resolveAccountId()
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
