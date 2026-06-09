import { isSetupComplete } from './setup-flag'
import { isBootstrapMode } from './stalwart-bootstrap'
import { getPrimaryDomain } from './stalwart-domain'
import { jmapCall, resolveAccountId } from './jmap'

export type SetupStep = 'collect' | 'account' | 'dns' | 'ssl' | 'done'

async function hasAdminUser(): Promise<boolean> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([['x:Account/query', { accountId }, '0']])
  const ids = (responses[0]?.[1] as { ids?: string[] } | undefined)?.ids ?? []
  return ids.length > 0
}

export async function deriveSetupStep(): Promise<SetupStep> {
  if (isSetupComplete()) return 'done'
  if (await isBootstrapMode()) return 'collect'
  if (!(await hasAdminUser())) return 'account'
  const domain = await getPrimaryDomain()
  if (domain?.dnsManagement?.['@type'] !== 'Automatic') return 'dns'
  return 'ssl'
}
