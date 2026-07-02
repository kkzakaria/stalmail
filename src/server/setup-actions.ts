import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import type { BootstrapInput } from "./stalwart-bootstrap"
import type { DnsProvider, DnsManagementStatus } from "./stalwart-dns"
import type { AcmeStatus } from "./stalwart-acme"
import { DNS_AUTO_PROVIDERS } from "@/lib/dns-providers"
import { isIpv4, isIpv6 } from "@/lib/ip"
import { domainSchema } from "@/components/setup/schemas"
import type { SetupStep } from "./setup-state"
import type { HostRole } from "./dns-host-records"
import type { StalwartDomain } from "./stalwart-domain"

// The setup-state / stalwart-bootstrap / stalwart-restart modules reach `node:fs`
// (and the JMAP transport) at module scope. This file is pulled into the client
// bundle by the /setup route, so those modules are imported lazily INSIDE the
// handlers — a static top-level import would bind `node:fs` named exports in client
// code (Vite externalizes them → runtime error on access). The handler bodies are
// stripped from the client build, keeping the dynamic imports server-only.

// Guard: verifies the current wizard step matches `expected`.
// Must be called BEFORE the handler's try/catch so a thrown SetupError propagates unchanged.
async function requireStep(expected: SetupStep): Promise<void> {
  const { deriveSetupStep } = await import("./setup-state")
  const { SetupError } = await import("./setup-errors")
  if ((await deriveSetupStep()) !== expected)
    throw new SetupError("SETUP-FORBIDDEN")
}

// Auth guard for every mutating handler.
// Must be called BEFORE requireStep (and outside any try/catch that maps errors)
// so the thrown SetupError('SETUP-UNAUTHENTICATED') propagates unchanged.
// Order: assertSameOriginStrict → requireSetupAuth.
async function requireSetupAuthGuard(): Promise<void> {
  const { assertSameOriginStrict } = await import("./session-cookie")
  const { requireSetupAuth } = await import("./setup-auth")
  const { SetupError } = await import("./setup-errors")
  // assertSameOriginStrict lève un `Error` brut (rejet CSRF) ; hors du try de mapping il
  // retomberait en SETUP-UNKNOWN opaque (#63). On le traduit en code parlant, en gardant
  // la cause en log serveur pour le diagnostic proxy (le message d'origine ne porte aucun
  // secret — cf. session-cookie.ts).
  try {
    assertSameOriginStrict()
  } catch (e) {
    console.warn(
      "[setup-actions] origin guard rejected:",
      e instanceof Error ? e.message : e
    )
    throw new SetupError("SETUP-ORIGIN-REJECTED")
  }
  await requireSetupAuth()
}

// Politique de retry (pure, deps injectées) pour la résolution du domaine primaire.
// Absorbe la fenêtre transitoire post-restart bootstrap où x:Domain/query peut répondre
// vide (null) ou en erreur (#120). Renvoie null si le domaine reste indisponible après
// tous les essais ; relaie immédiatement une erreur NON transitoire (à ne pas masquer).
export async function resolveDomainWithRetry(
  getDomain: () => Promise<StalwartDomain | null>,
  deps: {
    attempts: number
    delayMs: number
    sleep: (ms: number) => Promise<void>
    isTransient: (e: unknown) => boolean
  }
): Promise<StalwartDomain | null> {
  for (let i = 0; i < deps.attempts; i++) {
    if (i > 0) await deps.sleep(deps.delayMs)
    try {
      const domain = await getDomain()
      if (domain) return domain
    } catch (e) {
      if (!deps.isTransient(e)) throw e
    }
  }
  return null
}

// « Un court retry » pour absorber la fenêtre transitoire post-restart bootstrap (#120) :
// 1 essai + 1 retry espacé, avant de conclure à l'indisponibilité du backend.
const DOMAIN_RESOLVE_ATTEMPTS = 2
const DOMAIN_RESOLVE_RETRY_DELAY_MS = 750

// Résout le domaine primaire HORS du try de mapping des handlers. Toute défaillance
// devient un code SETUP-* parlant plutôt qu'un SETUP-UNKNOWN opaque (#63) :
//  - JmapError (backend injoignable) → transitoire, retenté puis SETUP-BACKEND-UNAVAILABLE
//  - domaine absent juste après le restart bootstrap → retenté (#120) puis, si toujours
//    absent, SETUP-BACKEND-UNAVAILABLE (le serveur mail n'est pas encore stable).
async function resolveDomainOrThrow(): Promise<StalwartDomain> {
  const { getPrimaryDomain } = await import("./stalwart-domain")
  const { JmapError } = await import("./jmap")
  const { SetupError } = await import("./setup-errors")
  const { sleep } = await import("./timers")
  let domain: StalwartDomain | null
  try {
    domain = await resolveDomainWithRetry(getPrimaryDomain, {
      attempts: DOMAIN_RESOLVE_ATTEMPTS,
      delayMs: DOMAIN_RESOLVE_RETRY_DELAY_MS,
      sleep,
      // En contexte setup, un échec JMAP de getPrimaryDomain traduit quasi toujours un
      // backend pas encore stable → on considère TOUTE JmapError comme transitoire.
      isTransient: (e) => e instanceof JmapError,
    })
  } catch (e) {
    // Erreur inattendue non transitoire relayée par resolveDomainWithRetry. Comme cet
    // appel est hors du try de mapping des handlers, un throw brut fuirait son message
    // à la frontière createServerFn. On le confine en SETUP-UNKNOWN (réservé au
    // réellement inattendu, #63) ; un SetupError éventuel garde son code.
    if (e instanceof SetupError) throw e
    throw new SetupError("SETUP-UNKNOWN")
  }
  if (!domain) throw new SetupError("SETUP-BACKEND-UNAVAILABLE")
  return domain
}

export async function getStepHandler(): Promise<{
  step: string
  dnsManual: boolean
}> {
  const { deriveSetupStep, isDnsManual } = await import("./setup-state")
  return {
    step: await deriveSetupStep(),
    dnsManual: await isDnsManual(),
  }
}

export async function setupAuthStatusHandler(): Promise<{ authed: boolean }> {
  const { isSetupAuthed } = await import("./setup-auth")
  return { authed: isSetupAuthed() }
}

export async function unlockSetupHandler({
  data,
}: {
  data: { token: string }
}): Promise<{ ok: true }> {
  const { unlockSetup } = await import("./setup-auth")
  unlockSetup(data.token)
  return { ok: true }
}

export async function submitBootstrapHandler({
  data,
}: {
  data: BootstrapInput
}): Promise<{ ok: true }> {
  await requireSetupAuthGuard()
  await requireStep("collect")
  const { submitBootstrap } = await import("./stalwart-bootstrap")
  const { requestStalwartRestart } = await import("./stalwart-restart")
  await submitBootstrap(data)
  requestStalwartRestart()
  const { issueSetupCookie } = await import("./setup-auth")
  issueSetupCookie()
  return { ok: true }
}

export type CreateAccountResult =
  | { status: "ok" }
  | { status: "weak"; message?: string }

export async function createAdminAccountHandler({
  data,
}: {
  data: { name: string; password: string }
}): Promise<CreateAccountResult> {
  await requireSetupAuthGuard()
  await requireStep("account")
  const { createAdminAccount, WeakPasswordError } =
    await import("./stalwart-account")
  const domain = await resolveDomainOrThrow()
  try {
    await createAdminAccount({
      name: data.name,
      domainId: domain.id,
      password: data.password,
    })
  } catch (e) {
    if (e instanceof WeakPasswordError)
      return { status: "weak", message: e.description }
    const { SetupError, toSetupErrorCode } = await import("./setup-errors")
    throw new SetupError(toSetupErrorCode(e, "SETUP-ACCOUNT-REJECTED"))
  }
  // Le renouvellement du cookie suit l'écriture Stalwart réussie : le placer hors du
  // catch évite de mapper un échec de cookie en "compte rejeté" (ce qui pousserait l'UI
  // à rejouer une création déjà effectuée).
  const { issueSetupCookie } = await import("./setup-auth")
  issueSetupCookie()
  return { status: "ok" }
}

export const createAccountSchema = z.object({
  name: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
})

export const createAdminAccountFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; password: string }) =>
    createAccountSchema.parse(d)
  )
  .handler(createAdminAccountHandler)

export async function createDnsServerHandler({
  data,
}: {
  data: { provider: string; secret: string }
}): Promise<{ dnsServerId: string }> {
  await requireSetupAuthGuard()
  await requireStep("dns")
  const { createDnsServer } = await import("./stalwart-dns")
  let id: string
  try {
    id = await createDnsServer({
      provider: data.provider as DnsProvider,
      secret: data.secret,
    })
  } catch (e) {
    const { SetupError, toSetupErrorCode } = await import("./setup-errors")
    throw new SetupError(toSetupErrorCode(e, "SETUP-DNS-REJECTED"))
  }
  // Cookie renouvelé seulement après une création DNS réussie, hors du catch de mapping
  // (sinon un échec de cookie serait signalé comme "DNS rejeté").
  const { issueSetupCookie } = await import("./setup-auth")
  issueSetupCookie()
  return { dnsServerId: id }
}

export async function setDnsManagementHandler({
  data,
}: {
  data: { dnsServerId: string }
}): Promise<{ ok: true }> {
  await requireSetupAuthGuard()
  await requireStep("dns")
  const { setDnsManagementAutomatic } = await import("./stalwart-domain")
  const domain = await resolveDomainOrThrow()
  try {
    await setDnsManagementAutomatic({
      domainId: domain.id,
      dnsServerId: data.dnsServerId,
      origin: domain.name,
    })
  } catch (e) {
    const { SetupError, toSetupErrorCode } = await import("./setup-errors")
    throw new SetupError(toSetupErrorCode(e, "SETUP-DNS-MANAGEMENT-REJECTED"))
  }
  const { issueSetupCookie } = await import("./setup-auth")
  issueSetupCookie()
  return { ok: true }
}

export interface DnsGridRecord {
  name: string
  type: string
  value: string
  status: "verified" | "pending" | "error"
}

export async function dnsGridStatusHandler(): Promise<{
  origin: string
  records: DnsGridRecord[]
}> {
  const { getPrimaryDomain } = await import("./stalwart-domain")
  const { parseZoneFile } = await import("./dns-zone")
  const { resolveRecordStatus } = await import("./dns-resolve")
  const domain = await getPrimaryDomain()
  if (!domain?.dnsZoneFile) return { origin: domain?.name ?? "", records: [] }
  const parsed = parseZoneFile(domain.dnsZoneFile)
  const records = await Promise.all(
    parsed.map(async (r) => {
      const raw = await resolveRecordStatus(r) // 'verified' | 'mismatch' | 'missing' | 'unsupported'
      const status: DnsGridRecord["status"] =
        raw === "verified"
          ? "verified"
          : raw === "mismatch"
            ? "error"
            : "pending"
      return { name: r.name, type: r.type, value: r.value, status }
    })
  )
  return { origin: domain.name, records }
}

export const createDnsServerSchema = z.object({
  provider: z.enum(DNS_AUTO_PROVIDERS),
  secret: z.string().min(1).max(4096),
})

export const createDnsServerFn = createServerFn({ method: "POST" })
  .validator((d: { provider: string; secret: string }) =>
    createDnsServerSchema.parse(d)
  )
  .handler(createDnsServerHandler)
export const setDnsManagementFn = createServerFn({ method: "POST" })
  .validator((d: { dnsServerId: string }) =>
    z.object({ dnsServerId: z.string().min(1).max(256) }).parse(d)
  )
  .handler(setDnsManagementHandler)
export const dnsGridStatusFn = createServerFn({ method: "GET" }).handler(
  dnsGridStatusHandler
)

export async function discoverServerIpHandler(): Promise<{
  ipv4: string | null
  ipv6: string | null
}> {
  const { assertSameOriginStrict } = await import("./session-cookie")
  assertSameOriginStrict()
  const { discoverServerIp } = await import("./server-ip")
  try {
    return await discoverServerIp()
  } catch {
    return { ipv4: null, ipv6: null }
  }
}

export interface HostAddressRecord {
  name: string
  type: string
  value: string
  role: HostRole
  status: "verified" | "pending" | "error"
}

export async function hostAddressStatusHandler({
  data,
}: {
  data: { ipv4?: string; ipv6?: string }
}): Promise<{ records: HostAddressRecord[] }> {
  const { assertSameOriginStrict } = await import("./session-cookie")
  assertSameOriginStrict()
  const { getPrimaryDomain } = await import("./stalwart-domain")
  const { parseZoneFile } = await import("./dns-zone")
  const { buildHostRecords } = await import("./dns-host-records")
  const { resolveRecordStatus } = await import("./dns-resolve")
  const domain = await getPrimaryDomain()
  if (!domain) return { records: [] }
  const ipv4 = data.ipv4 && isIpv4(data.ipv4) ? data.ipv4 : null
  const ipv6 = data.ipv6 && isIpv6(data.ipv6) ? data.ipv6 : null
  const hostname = resolveServerHostname(
    process.env.STALMAIL_PUBLIC_URL,
    domain.name
  )
  // Absence de dnsZoneFile (possible uniquement en tout début de setup) → repli apex + webmail.
  const zoneRecords = domain.dnsZoneFile
    ? parseZoneFile(domain.dnsZoneFile)
    : []
  const expected = buildHostRecords({
    zoneRecords,
    hostname,
    domain: domain.name,
    ipv4,
    ipv6,
  })
  const records = await Promise.all(
    expected.map(async (r) => {
      const raw = await resolveRecordStatus(r)
      const status: HostAddressRecord["status"] =
        raw === "verified"
          ? "verified"
          : raw === "mismatch"
            ? "error"
            : "pending"
      return {
        name: r.name,
        type: r.type,
        value: r.value,
        role: r.role,
        status,
      }
    })
  )
  return { records }
}

export const hostAddressInputSchema = z.object({
  ipv4: z.string().max(45).optional(),
  ipv6: z.string().max(45).optional(),
})

export const discoverServerIpFn = createServerFn({ method: "GET" }).handler(
  discoverServerIpHandler
)
export const hostAddressStatusFn = createServerFn({ method: "POST" })
  .validator((d: { ipv4?: string; ipv6?: string }) =>
    hostAddressInputSchema.parse(d)
  )
  .handler(hostAddressStatusHandler)

export async function setDnsManagementManualHandler(): Promise<{ ok: true }> {
  await requireSetupAuthGuard()
  await requireStep("dns")
  const { setDnsManagementManual } = await import("./stalwart-domain")
  const { markDnsConfigured } = await import("./setup-flag")
  const domain = await resolveDomainOrThrow()
  try {
    await setDnsManagementManual({ domainId: domain.id })
  } catch (e) {
    const { SetupError, toSetupErrorCode } = await import("./setup-errors")
    throw new SetupError(toSetupErrorCode(e, "SETUP-DNS-MANAGEMENT-REJECTED"))
  }
  markDnsConfigured()
  const { issueSetupCookie } = await import("./setup-auth")
  issueSetupCookie()
  return { ok: true }
}
export const setDnsManagementManualFn = createServerFn({
  method: "POST",
}).handler(setDnsManagementManualHandler)

export const getStep = createServerFn({ method: "GET" }).handler(getStepHandler)
export const setupContextFn = createServerFn({ method: "GET" }).handler(
  setupContextHandler
)

export const submitBootstrapFn = createServerFn({ method: "POST" })
  .validator((d: BootstrapInput) => domainSchema.parse(d))
  .handler(submitBootstrapHandler)

// Pur : hostname public du serveur. Source autoritaire = STALMAIL_PUBLIC_URL (comme
// auth-actions) ; à défaut, le nom de domaine. Sert à ré-hydrater l'affichage du wizard
// sur reload (#19) et à résoudre le SAN ACME. Aucun secret (hostname/domaine publics).
export function resolveServerHostname(
  publicUrl: string | undefined,
  domainName: string
): string {
  if (publicUrl) {
    try {
      return new URL(publicUrl).hostname
    } catch {
      // env malformé → repli sur le domaine
    }
  }
  return domainName
}

// Derive the SSL SAN hostname from the fixed public base URL (server-authoritative,
// like auth-actions), falling back to a client-collected value then the domain name.
// On a pure resume the client state is empty, so the server value is the source of truth.
function resolveAcmeHostname(
  clientHostname: string,
  domainName: string
): string {
  return resolveServerHostname(
    process.env.STALMAIL_PUBLIC_URL,
    clientHostname || domainName
  )
}

// Ré-dérive les valeurs d'affichage du wizard (hostname serveur + domaine) côté serveur,
// pour ré-hydrater le contexte client perdu au reload / à l'entrée directe en phase
// monitoring (#19). Aucun secret exposé. En phase 'collect' (pré-bootstrap), x:Domain/query
// est interdit → on renvoie des valeurs vides (le client les collectera via DomainStep).
export async function setupContextHandler(): Promise<{
  serverHostname: string
  defaultDomain: string
}> {
  // On ne teste que le mode bootstrap (où x:Domain/query est interdit) : isBootstrapMode()
  // suffit. deriveSetupStep() ferait en plus un getPrimaryDomain() redondant ici.
  const { isBootstrapMode } = await import("./stalwart-bootstrap")
  if (await isBootstrapMode()) return { serverHostname: "", defaultDomain: "" }
  const { getPrimaryDomain } = await import("./stalwart-domain")
  const domain = await getPrimaryDomain()
  const defaultDomain = domain?.name ?? ""
  return {
    serverHostname: resolveServerHostname(
      process.env.STALMAIL_PUBLIC_URL,
      defaultDomain
    ),
    defaultDomain,
  }
}

export async function configureAcmeHandler({
  data,
}: {
  data: { hostname: string; contactEmail: string }
}): Promise<{ ok: true }> {
  await requireSetupAuthGuard()
  await requireStep("ssl")
  const { isDnsManual } = await import("./setup-state")
  if (await isDnsManual()) {
    const { SetupError } = await import("./setup-errors")
    throw new SetupError("SETUP-FORBIDDEN")
  }
  const { configureAcme } = await import("./stalwart-acme")
  const domain = await resolveDomainOrThrow()
  // hostname + contactEmail are resolved server-side (not authoritative from the
  // client) so an automatic-SSL resume — where the client carries empty inputs —
  // still produces a valid ACME payload instead of failing validation immediately.
  const hostname = resolveAcmeHostname(data.hostname, domain.name)
  const contactEmail = data.contactEmail || `admin@${domain.name}`
  try {
    await configureAcme({
      domainId: domain.id,
      hostname,
      contactEmail,
    })
  } catch (e) {
    const { SetupError, toSetupErrorCode } = await import("./setup-errors")
    throw new SetupError(toSetupErrorCode(e, "SETUP-SSL-REJECTED"))
  }
  const { issueSetupCookie } = await import("./setup-auth")
  issueSetupCookie()
  return { ok: true }
}

export async function acmeStatusHandler(): Promise<{ status: AcmeStatus }> {
  const { getAcmeStatus } = await import("./stalwart-acme")
  return { status: await getAcmeStatus() }
}

export async function dnsManagementStatusHandler(): Promise<{
  status: DnsManagementStatus
}> {
  const { getDnsManagementStatus } = await import("./stalwart-dns")
  return { status: await getDnsManagementStatus() }
}

export async function finishSetupHandler(): Promise<{ ok: true }> {
  await requireSetupAuthGuard()
  await requireStep("done")
  const { enableXForwarded } = await import("./stalwart-hardening")
  const { markSetupComplete } = await import("./setup-flag")
  await enableXForwarded() // go-live condition — recovery admin still active here
  markSetupComplete()
  const { clearSetupCookie } = await import("./setup-auth")
  clearSetupCookie()
  return { ok: true }
}

// Inputs may be empty on a pure resume (client state not yet collected); the
// handler resolves hostname/contactEmail server-side. Bound the lengths only.
export const configureAcmeSchema = z.object({
  hostname: z.string().max(253),
  contactEmail: z.union([z.literal(""), z.string().email().max(254)]),
})

export const configureAcmeFn = createServerFn({ method: "POST" })
  .validator((d: { hostname: string; contactEmail: string }) =>
    configureAcmeSchema.parse(d)
  )
  .handler(configureAcmeHandler)
export const acmeStatusFn = createServerFn({ method: "GET" }).handler(
  acmeStatusHandler
)
export const dnsManagementStatusFn = createServerFn({ method: "GET" }).handler(
  dnsManagementStatusHandler
)
export const finishSetupFn = createServerFn({ method: "POST" }).handler(
  finishSetupHandler
)

export async function setupStatusHandler(): Promise<{ configured: boolean }> {
  const { isSetupComplete } = await import("./setup-flag")
  return { configured: isSetupComplete() }
}

export const setupStatusFn = createServerFn({ method: "GET" }).handler(
  setupStatusHandler
)

export async function markSslConfiguredHandler(): Promise<{ ok: true }> {
  await requireSetupAuthGuard()
  await requireStep("ssl")
  const { isDnsManual } = await import("./setup-state")
  if (!(await isDnsManual())) {
    const { SetupError } = await import("./setup-errors")
    throw new SetupError("SETUP-FORBIDDEN")
  }
  const { markSslAcknowledged } = await import("./setup-flag")
  markSslAcknowledged()
  const { issueSetupCookie } = await import("./setup-auth")
  issueSetupCookie()
  return { ok: true }
}

export const markSslConfiguredFn = createServerFn({ method: "POST" }).handler(
  markSslConfiguredHandler
)

export const unlockSetupFn = createServerFn({ method: "POST" })
  .validator((d: { token: string }) =>
    z.object({ token: z.string().min(1).max(512) }).parse(d)
  )
  .handler(unlockSetupHandler)

export const setupAuthStatusFn = createServerFn({ method: "GET" }).handler(
  setupAuthStatusHandler
)
