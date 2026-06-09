import {
  jmapCall,
  resolveAccountId,
  isBootstrapForbidden,
  JmapError,
  firstResponse,
} from './jmap'

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
  const responses = await jmapCall([['x:Domain/query', { accountId }, '0']])
  const [name, result] = firstResponse(responses)
  if (name === 'error' && isBootstrapForbidden(result)) return true
  return false
}

export async function getBootstrap(): Promise<Record<string, unknown>> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Bootstrap/get', { accountId, ids: null }, '0'],
  ])
  const result = firstResponse(responses)[1] as { list?: Record<string, unknown>[] }
  const obj = result.list?.[0]
  if (!obj) throw new JmapError('bootstrap singleton not found')
  return obj
}

export async function submitBootstrap(
  input: BootstrapInput,
): Promise<GeneratedAdmin> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      'x:Bootstrap/set',
      {
        accountId,
        update: {
          singleton: {
            serverHostname: input.serverHostname,
            defaultDomain: input.defaultDomain,
            requestTlsCertificate: false,
            generateDkimKeys: true,
            directory: { '@type': 'Internal' },
            dnsServer: { '@type': 'Manual' },
          },
        },
      },
      '0',
    ],
  ])
  const result = firstResponse(responses)[1] as {
    updated?: { singleton?: GeneratedAdmin }
    notUpdated?: unknown
  }
  const admin = result.updated?.singleton
  if (!admin) {
    throw new JmapError('bootstrap submission rejected', result.notUpdated)
  }
  return admin
}
