import { isSetupComplete } from './setup-flag'
import { isBootstrapMode } from './stalwart-bootstrap'
import { getPrimaryDomain } from './stalwart-domain'
import { jmapCall, resolveAccountId, expectResult } from './jmap'

export type SetupStep = 'collect' | 'account' | 'dns' | 'ssl' | 'done'

// Stalwart's bootstrap auto-creates a system administrator account (name
// "admin", description "System administrator"). The wizard's account step is
// complete only once a DIFFERENT, user-created account exists.
const SYSTEM_ADMIN_NAME = 'admin'
const SYSTEM_ADMIN_DESCRIPTION = 'System administrator'

interface AccountSummary {
  name?: string
  description?: string
}

function isSystemAdmin(a: AccountSummary): boolean {
  return a.name === SYSTEM_ADMIN_NAME && a.description === SYSTEM_ADMIN_DESCRIPTION
}

async function hasUserAdminAccount(): Promise<boolean> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Account/query', { accountId }, '0'],
    [
      'x:Account/get',
      { accountId, '#ids': { resultOf: '0', name: 'x:Account/query', path: '/ids' } },
      '1',
    ],
  ])
  const list = (expectResult(responses, 1) as { list?: AccountSummary[] }).list ?? []
  return list.some((a) => !isSystemAdmin(a))
}

export async function deriveSetupStep(): Promise<SetupStep> {
  if (isSetupComplete()) return 'done'
  if (await isBootstrapMode()) return 'collect'
  if (!(await hasUserAdminAccount())) return 'account'
  const domain = await getPrimaryDomain()
  if (domain?.dnsManagement?.['@type'] !== 'Automatic') return 'dns'
  return 'ssl'
}
