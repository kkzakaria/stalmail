import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import type { BootstrapInput } from "./stalwart-bootstrap"
import type { DnsProvider } from "./stalwart-dns"
import type { AcmeStatus } from "./stalwart-acme"
import { DNS_PROVIDERS } from "./stalwart-dns"
import { domainSchema } from "@/components/setup/schemas"

// The setup-state / stalwart-bootstrap / stalwart-restart modules reach `node:fs`
// (and the JMAP transport) at module scope. This file is pulled into the client
// bundle by the /setup route, so those modules are imported lazily INSIDE the
// handlers — a static top-level import would bind `node:fs` named exports in client
// code (Vite externalizes them → runtime error on access). The handler bodies are
// stripped from the client build, keeping the dynamic imports server-only.

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

export async function submitBootstrapHandler({
  data,
}: {
  data: BootstrapInput
}): Promise<{ ok: true }> {
  const { submitBootstrap } = await import("./stalwart-bootstrap")
  const { requestStalwartRestart } = await import("./stalwart-restart")
  await submitBootstrap(data)
  requestStalwartRestart()
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
  const { getPrimaryDomain } = await import("./stalwart-domain")
  const { createAdminAccount, WeakPasswordError } =
    await import("./stalwart-account")
  const domain = await getPrimaryDomain()
  if (!domain) throw new Error("No primary domain found")
  try {
    await createAdminAccount({
      name: data.name,
      domainId: domain.id,
      password: data.password,
    })
    return { status: "ok" }
  } catch (e) {
    if (e instanceof WeakPasswordError)
      return { status: "weak", message: e.description }
    const { SetupError, toSetupErrorCode } = await import("./setup-errors")
    throw new SetupError(toSetupErrorCode(e, "SETUP-ACCOUNT-REJECTED"))
  }
}

const createAccountSchema = z.object({
  name: z.string().min(1),
  password: z.string().min(1),
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
  const { createDnsServer } = await import("./stalwart-dns")
  try {
    const id = await createDnsServer({
      provider: data.provider as DnsProvider,
      secret: data.secret,
    })
    return { dnsServerId: id }
  } catch (e) {
    const { SetupError, toSetupErrorCode } = await import("./setup-errors")
    throw new SetupError(toSetupErrorCode(e, "SETUP-DNS-REJECTED"))
  }
}

export async function setDnsManagementHandler({
  data,
}: {
  data: { dnsServerId: string }
}): Promise<{ ok: true }> {
  const { getPrimaryDomain, setDnsManagementAutomatic } =
    await import("./stalwart-domain")
  const domain = await getPrimaryDomain()
  if (!domain) throw new Error("No primary domain found")
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

export const createDnsServerFn = createServerFn({ method: "POST" })
  .validator((d: { provider: string; secret: string }) =>
    z.object({ provider: z.enum(DNS_PROVIDERS), secret: z.string() }).parse(d)
  )
  .handler(createDnsServerHandler)
export const setDnsManagementFn = createServerFn({ method: "POST" })
  .validator((d: { dnsServerId: string }) =>
    z.object({ dnsServerId: z.string().min(1) }).parse(d)
  )
  .handler(setDnsManagementHandler)
export const dnsGridStatusFn = createServerFn({ method: "GET" }).handler(
  dnsGridStatusHandler
)

export async function setDnsManagementManualHandler(): Promise<{ ok: true }> {
  const { getPrimaryDomain, setDnsManagementManual } =
    await import("./stalwart-domain")
  const { markDnsConfigured } = await import("./setup-flag")
  const domain = await getPrimaryDomain()
  if (!domain) throw new Error("No primary domain found")
  try {
    await setDnsManagementManual({ domainId: domain.id })
  } catch (e) {
    const { SetupError, toSetupErrorCode } = await import("./setup-errors")
    throw new SetupError(toSetupErrorCode(e, "SETUP-DNS-MANAGEMENT-REJECTED"))
  }
  markDnsConfigured()
  return { ok: true }
}
export const setDnsManagementManualFn = createServerFn({
  method: "POST",
}).handler(setDnsManagementManualHandler)

export const getStep = createServerFn({ method: "GET" }).handler(getStepHandler)

export const submitBootstrapFn = createServerFn({ method: "POST" })
  .validator((d: BootstrapInput) => domainSchema.parse(d))
  .handler(submitBootstrapHandler)

export async function configureAcmeHandler({
  data,
}: {
  data: { hostname: string; contactEmail: string }
}): Promise<{ ok: true }> {
  const { getPrimaryDomain } = await import("./stalwart-domain")
  const { configureAcme } = await import("./stalwart-acme")
  const domain = await getPrimaryDomain()
  if (!domain) throw new Error("No primary domain found")
  try {
    await configureAcme({
      domainId: domain.id,
      hostname: data.hostname,
      contactEmail: data.contactEmail,
    })
  } catch (e) {
    const { SetupError, toSetupErrorCode } = await import("./setup-errors")
    throw new SetupError(toSetupErrorCode(e, "SETUP-SSL-REJECTED"))
  }
  return { ok: true }
}

export async function acmeStatusHandler(): Promise<{ status: AcmeStatus }> {
  const { getAcmeStatus } = await import("./stalwart-acme")
  return { status: await getAcmeStatus() }
}

export async function finishSetupHandler(): Promise<{ ok: true }> {
  const { enableXForwarded } = await import("./stalwart-hardening")
  const { markSetupComplete } = await import("./setup-flag")
  await enableXForwarded() // go-live condition — recovery admin still active here
  markSetupComplete()
  return { ok: true }
}

export const configureAcmeFn = createServerFn({ method: "POST" })
  .validator((d: { hostname: string; contactEmail: string }) =>
    z
      .object({ hostname: z.string().min(1), contactEmail: z.string().min(1) })
      .parse(d)
  )
  .handler(configureAcmeHandler)
export const acmeStatusFn = createServerFn({ method: "GET" }).handler(
  acmeStatusHandler
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
  const { markSslAcknowledged } = await import("./setup-flag")
  markSslAcknowledged()
  return { ok: true }
}

export const markSslConfiguredFn = createServerFn({ method: "POST" }).handler(
  markSslConfiguredHandler
)
