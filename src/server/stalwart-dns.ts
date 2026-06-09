import { jmapCall, resolveAccountId, firstResponse, JmapError } from './jmap'

// Captured from the v0.16 schema enum DnsServerBootstrapType (71 variants).
// See docs/superpowers/specs/2026-06-09-stalwart-api-capture.md §6.
export const DNS_PROVIDERS = [
  'Manual', 'Tsig', 'Cloudflare', 'DigitalOcean', 'DeSEC', 'Ovh', 'Bunny',
  'Porkbun', 'Dnsimple', 'Spaceship', 'Route53', 'GoogleCloudDns', 'Alidns',
  'ArvanCloud', 'Autodns', 'AzureDns', 'BaiduCloud', 'BluecatV2', 'ClouDns',
  'Constellix', 'Cpanel', 'Ddnss', 'DnsMadeEasy', 'Domeneshop', 'Dreamhost',
  'DuckDns', 'Dynu', 'EasyDns', 'EdgeDns', 'Exoscale', 'FreeMyIp', 'GandiV5',
  'Gcore', 'Glesys', 'Godaddy', 'Hetzner', 'HostingDe', 'Hostinger',
  'HuaweiCloud', 'Hurricane', 'IbmCloud', 'Infoblox', 'Infomaniak', 'Inwx',
  'Ionos', 'Ipv64', 'Joker', 'Lightsail', 'Linode', 'LuaDns', 'MythicBeasts',
  'Namecheap', 'NameDotCom', 'NameSilo', 'Netcup', 'Netlify', 'Nifcloud', 'Ns1',
  'OracleCloud', 'Plesk', 'Safedns', 'Scaleway', 'TencentCloud', 'Transip',
  'UltraDns', 'Vercel', 'Volcengine', 'Vultr', 'WebSupport', 'YandexCloud',
] as const

export type DnsProvider = (typeof DNS_PROVIDERS)[number]

export interface DnsServerInput {
  provider: DnsProvider
  secret: string
  description?: string
}

export async function createDnsServer(input: DnsServerInput): Promise<string> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      'x:DnsServer/set',
      {
        accountId,
        create: {
          new1: {
            '@type': input.provider,
            description: input.description ?? `${input.provider} (Stalmail)`,
            secret: input.secret,
          },
        },
      },
      '0',
    ],
  ])
  const result = firstResponse(responses)[1] as {
    created?: { new1?: { id: string } }
    notCreated?: unknown
  }
  const created = result.created?.new1
  if (!created) throw new JmapError('dns server creation rejected', result.notCreated)
  return created.id
}
