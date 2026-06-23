import {
  isSetupComplete,
  isDnsConfigured,
  isSslAcknowledged,
} from "./setup-flag"
import { isBootstrapMode } from "./stalwart-bootstrap"
import { getPrimaryDomain } from "./stalwart-domain"
import type { StalwartDomain } from "./stalwart-domain"
import { jmapCall, resolveAccountId, expectResult } from "./jmap"

export type SetupStep = "collect" | "account" | "dns" | "ssl" | "done"

// Stalwart's bootstrap auto-creates a system administrator account (name
// "admin", description "System administrator"). The wizard's account step is
// complete only once a DIFFERENT, user-created account exists.
const SYSTEM_ADMIN_NAME = "admin"
const SYSTEM_ADMIN_DESCRIPTION = "System administrator"

interface AccountSummary {
  name?: string
  description?: string
}

function isSystemAdmin(a: AccountSummary): boolean {
  return (
    a.name === SYSTEM_ADMIN_NAME && a.description === SYSTEM_ADMIN_DESCRIPTION
  )
}

async function hasUserAdminAccount(): Promise<boolean> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ["x:Account/query", { accountId }, "0"],
    [
      "x:Account/get",
      {
        accountId,
        "#ids": { resultOf: "0", name: "x:Account/query", path: "/ids" },
      },
      "1",
    ],
  ])
  const list =
    (expectResult(responses, 1) as { list?: AccountSummary[] }).list ?? []
  return list.some((a) => !isSystemAdmin(a))
}

// DNS is considered managed only when a primary domain exists AND either:
// - Stalwart manages it automatically (dnsManagement['@type'] === 'Automatic'), OR
// - the operator has manually confirmed DNS is configured (isDnsConfigured marker).
// A missing domain is never "managed" — it must still route to the 'dns' step.
function isDnsManaged(domain: StalwartDomain | null): boolean {
  if (!domain) return false
  return domain.dnsManagement?.["@type"] === "Automatic" || isDnsConfigured()
}

// SSL is configured when Stalwart manages certificates automatically.
function isSslConfigured(domain: StalwartDomain | null): boolean {
  return domain?.certificateManagement?.["@type"] === "Automatic"
}

// DNS was configured via the Manual path when the marker is set AND dnsManagement
// is not Automatic (i.e. the operator confirmed DNS manually instead of delegating
// to Stalwart).
export async function isDnsManual(): Promise<boolean> {
  if (!isDnsConfigured()) return false
  const domain = await getPrimaryDomain()
  // No domain → not configured at all; never report manual on an invalid state.
  if (!domain) return false
  return domain.dnsManagement?.["@type"] !== "Automatic"
}

export async function deriveSetupStep(): Promise<SetupStep> {
  if (isSetupComplete()) return "done"
  if (await isBootstrapMode()) return "collect"
  const domain = await getPrimaryDomain()
  if (!isDnsManaged(domain)) return "dns"
  if (!isSslConfigured(domain) && !isSslAcknowledged()) return "ssl"
  if (!(await hasUserAdminAccount())) return "account"
  return "done"
}
