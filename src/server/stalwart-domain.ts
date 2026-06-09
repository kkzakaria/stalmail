import { jmapCall, resolveAccountId, firstResponse, JmapError } from './jmap'

export interface StalwartDomain {
  id: string
  name: string
  dnsZoneFile?: string
  dnsManagement?: { '@type': string; [k: string]: unknown }
  [k: string]: unknown
}

// Default record set Stalwart publishes (DnsRecordType enum, minus tlsa).
export const DEFAULT_PUBLISH_RECORDS = [
  'dkim', 'spf', 'mx', 'dmarc', 'srv', 'mtaSts',
  'tlsRpt', 'caa', 'autoConfig', 'autoConfigLegacy', 'autoDiscover',
]

export async function getPrimaryDomain(): Promise<StalwartDomain | null> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Domain/query', { accountId }, '0'],
    [
      'x:Domain/get',
      { accountId, '#ids': { resultOf: '0', name: 'x:Domain/query', path: '/ids' } },
      '1',
    ],
  ])
  const get = responses.find((r) => r[0] === 'x:Domain/get')
  const list = (get?.[1] as { list?: StalwartDomain[] } | undefined)?.list ?? []
  return list[0] ?? null
}

export async function setDnsManagementAutomatic(
  domainId: string,
  dnsServerId: string,
  origin: string,
): Promise<void> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      'x:Domain/set',
      {
        accountId,
        update: {
          [domainId]: {
            dnsManagement: {
              '@type': 'Automatic',
              dnsServerId,
              origin,
              publishRecords: DEFAULT_PUBLISH_RECORDS,
            },
          },
        },
      },
      '0',
    ],
  ])
  const result = firstResponse(responses)[1] as { updated?: Record<string, unknown>; notUpdated?: unknown }
  if (!result.updated || !(domainId in result.updated)) {
    throw new JmapError('domain dnsManagement update rejected', result.notUpdated)
  }
}
