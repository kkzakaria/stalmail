import { jmapCall, resolveAccountId, firstResponse, expectResult, JmapError } from './jmap'

const LETSENCRYPT_DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory'

export interface ConfigureAcmeInput {
  domainId: string
  hostname: string
  contactEmail: string
  /** Override the ACME directory (e.g. Let's Encrypt staging in tests). */
  directory?: string
}

/** Creates an AcmeProvider (LE / TLS-ALPN-01) and flips the domain to Automatic cert management. */
export async function configureAcme(input: ConfigureAcmeInput): Promise<string> {
  const accountId = await resolveAccountId()
  // 1) Create the ACME provider — VERIFIED v0.16 shapes (recon §9):
  //    challengeType: enum string; contact: map {"mailto:<email>": true}; renewBefore omitted.
  const createResp = await jmapCall([
    [
      'x:AcmeProvider/set',
      {
        accountId,
        create: {
          p1: {
            directory: input.directory ?? LETSENCRYPT_DIRECTORY,
            challengeType: 'TlsAlpn01',
            contact: { [`mailto:${input.contactEmail}`]: true },
          },
        },
      },
      '0',
    ],
  ])
  const created = (firstResponse(createResp)[1] as {
    created?: { p1?: { id: string } }
    notCreated?: { p1?: unknown }
  })
  const providerId = created.created?.p1?.id
  if (!providerId) throw new JmapError('ACME provider creation rejected', created.notCreated)

  // 2) Flip the domain to Automatic — SAN is a map {"<host>": true}, optional.
  const updResp = await jmapCall([
    [
      'x:Domain/set',
      {
        accountId,
        update: {
          [input.domainId]: {
            certificateManagement: {
              '@type': 'Automatic',
              acmeProviderId: providerId,
              subjectAlternativeNames: { [input.hostname]: true },
            },
          },
        },
      },
      '0',
    ],
  ])
  const upd = firstResponse(updResp)[1] as { updated?: Record<string, unknown>; notUpdated?: unknown }
  if (!upd.updated || !(input.domainId in upd.updated)) {
    throw new JmapError('domain certificateManagement update rejected', upd.notUpdated)
  }
  return providerId
}

export type AcmeStatus = 'pending' | 'failed' | 'valid'

/** Polls the AcmeRenewal task. NON-BLOCKING: Pending/Retry → pending, Failed → failed,
 *  no AcmeRenewal task found → valid (the renewal task is cleared once a cert is active).
 *  NOTE: the "valid" path could not be confirmed live (no public IP in dev); this heuristic
 *  is best-effort and should be revisited if a real cert is obtained. */
export async function getAcmeStatus(): Promise<AcmeStatus> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Task/query', { accountId }, '0'],
    ['x:Task/get', { accountId, '#ids': { resultOf: '0', name: 'x:Task/query', path: '/ids' } }, '1'],
  ])
  const list = (expectResult(responses, 1) as {
    list?: { '@type'?: string; status?: { '@type'?: string } }[]
  }).list ?? []
  const task = list.find((t) => t['@type'] === 'AcmeRenewal')
  if (!task) return 'valid'
  const s = task.status?.['@type']
  if (s === 'Failed') return 'failed'
  return 'pending' // Pending | Retry (and any other in-flight state)
}
