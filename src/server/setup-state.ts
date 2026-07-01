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
// - the operator has manually confirmed DNS is configured (isDnsConfigured marker), OR
// - Stalwart manages it automatically (dnsManagement['@type'] === 'Automatic') AND the
//   DnsManagement publish task has not FAILED.
// A missing domain is never "managed" — it must still route to the 'dns' step.
//
// Le garde sur la tâche est crucial (#62) : setDnsManagement(Automatic) réussit au
// niveau JMAP même avec un token invalide (le domaine passe en Automatic), seule la
// tâche DnsManagement échoue ensuite. Sans ce garde, l'étape avancerait vers 'ssl' et
// requireStep('dns') refuserait le retry → SETUP-FORBIDDEN. Un échec de publication
// doit donc laisser l'opérateur sur l'étape 'dns' pour ressaisir le token. Les états
// 'published'/'pending' (bon token, en cours) restent "managés" (non bloquant).
async function isDnsManaged(domain: StalwartDomain | null): Promise<boolean> {
  if (!domain) return false
  if (isDnsConfigured()) return true
  if (domain.dnsManagement?.["@type"] !== "Automatic") return false
  const { getDnsManagementStatus } = await import("./stalwart-dns")
  return (await getDnsManagementStatus()) !== "failed"
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
  if (!(await isDnsManaged(domain))) return "dns"
  if (!isSslConfigured(domain) && !isSslAcknowledged()) return "ssl"
  if (!(await hasUserAdminAccount())) return "account"
  return "done"
}
