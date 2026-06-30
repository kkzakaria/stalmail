import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { submitBootstrap, isBootstrapMode } from "./stalwart-bootstrap"
import { requestStalwartRestart } from "./stalwart-restart"
import {
  getStepHandler,
  submitBootstrapHandler,
  createAdminAccountHandler,
  createDnsServerHandler,
  setDnsManagementHandler,
  setDnsManagementManualHandler,
  dnsGridStatusHandler,
  configureAcmeHandler,
  acmeStatusHandler,
  dnsManagementStatusHandler,
  finishSetupHandler,
  setupStatusHandler,
  markSslConfiguredHandler,
  unlockSetupHandler,
  setupAuthStatusHandler,
  setupContextHandler,
  resolveServerHostname,
} from "./setup-actions"
import type * as StalwartAccountModule from "./stalwart-account"
import type * as StalwartDomainModule from "./stalwart-domain"
import type * as StalwartDnsModule from "./stalwart-dns"
import type * as DnsZoneModule from "./dns-zone"
import type * as DnsResolveModule from "./dns-resolve"
import type * as StalwartAcmeModule from "./stalwart-acme"
import type * as SetupFlagModule from "./setup-flag"
import type * as StalwartHardeningModule from "./stalwart-hardening"
import type * as SetupErrorsModule from "./setup-errors"

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: () => ({ handler: (fn: unknown) => fn }),
    handler: (fn: unknown) => fn,
  }),
}))
vi.mock("./setup-state", () => ({
  deriveSetupStep: vi.fn(async () => "collect"),
  isDnsManual: vi.fn(async () => false),
}))
vi.mock("./stalwart-bootstrap", () => ({
  isBootstrapMode: vi.fn(async () => false),
  submitBootstrap: vi.fn(async () => ({
    username: "admin@exemple.fr",
    secret: "g",
  })),
}))
vi.mock("./stalwart-restart", () => ({ requestStalwartRestart: vi.fn() }))
vi.mock("./stalwart-domain", async (importActual) => ({
  ...(await importActual<typeof StalwartDomainModule>()),
  getPrimaryDomain: vi.fn(async () => ({ id: "dom-1", name: "exemple.fr" })),
  setDnsManagementAutomatic: vi.fn(async () => undefined),
  setDnsManagementManual: vi.fn(async () => undefined),
}))
vi.mock("./stalwart-account", async (importActual) => ({
  ...(await importActual<typeof StalwartAccountModule>()),
  createAdminAccount: vi.fn(async () => "acc-1"),
}))
vi.mock("./stalwart-dns", async (importActual) => ({
  ...(await importActual<typeof StalwartDnsModule>()),
  createDnsServer: vi.fn(async () => "srv-1"),
  getDnsManagementStatus: vi.fn(async () => "failed"),
}))
vi.mock("./dns-zone", async (importActual) => ({
  ...(await importActual<typeof DnsZoneModule>()),
  parseZoneFile: vi.fn(() => []),
}))
vi.mock("./dns-resolve", async (importActual) => ({
  ...(await importActual<typeof DnsResolveModule>()),
  resolveRecordStatus: vi.fn(async () => "verified"),
}))
vi.mock("./stalwart-acme", async (importActual) => ({
  ...(await importActual<typeof StalwartAcmeModule>()),
  configureAcme: vi.fn(async () => "prov-1"),
  getAcmeStatus: vi.fn(async () => "pending"),
}))
vi.mock("./setup-flag", async (importActual) => ({
  ...(await importActual<typeof SetupFlagModule>()),
  markSetupComplete: vi.fn(),
  isSetupComplete: vi.fn(() => false),
  markDnsConfigured: vi.fn(),
  markSslAcknowledged: vi.fn(),
  isSslAcknowledged: vi.fn(() => false),
}))
vi.mock("./stalwart-hardening", async (importActual) => ({
  ...(await importActual<typeof StalwartHardeningModule>()),
  enableXForwarded: vi.fn(async () => undefined),
}))
vi.mock("./setup-errors", async (importActual) => ({
  ...(await importActual<typeof SetupErrorsModule>()),
}))

// Mock setup-auth: requireSetupAuth is a no-op by default (authed), issueSetupCookie tracked
vi.mock("./setup-auth", () => ({
  requireSetupAuth: vi.fn(async () => undefined),
  isSetupAuthed: vi.fn(() => true),
  unlockSetup: vi.fn(() => undefined),
  issueSetupCookie: vi.fn(() => undefined),
  clearSetupCookie: vi.fn(() => undefined),
}))

// Mock session-cookie: assertSameOriginStrict is a no-op by default
vi.mock("./session-cookie", () => ({
  assertSameOriginStrict: vi.fn(() => undefined),
  clientIp: vi.fn(() => "127.0.0.1"),
}))

// eslint-disable-next-line import/first
import {
  getPrimaryDomain,
  setDnsManagementAutomatic,
  setDnsManagementManual,
} from "./stalwart-domain"
// eslint-disable-next-line import/first
import { createAdminAccount, WeakPasswordError } from "./stalwart-account"
// eslint-disable-next-line import/first
import { createDnsServer, getDnsManagementStatus } from "./stalwart-dns"
// eslint-disable-next-line import/first
import { parseZoneFile } from "./dns-zone"
// eslint-disable-next-line import/first
import { resolveRecordStatus } from "./dns-resolve"
// eslint-disable-next-line import/first
import { configureAcme, getAcmeStatus } from "./stalwart-acme"
// eslint-disable-next-line import/first
import {
  markSetupComplete,
  isSetupComplete,
  markDnsConfigured,
  markSslAcknowledged,
} from "./setup-flag"
// eslint-disable-next-line import/first
import { enableXForwarded } from "./stalwart-hardening"
// eslint-disable-next-line import/first
import { SetupError } from "./setup-errors"
// eslint-disable-next-line import/first
import { deriveSetupStep, isDnsManual } from "./setup-state"
// eslint-disable-next-line import/first
import {
  requireSetupAuth,
  isSetupAuthed,
  unlockSetup,
  issueSetupCookie,
  clearSetupCookie,
} from "./setup-auth"
// eslint-disable-next-line import/first
import { assertSameOriginStrict } from "./session-cookie"

beforeEach(() => vi.clearAllMocks())

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make requireSetupAuth throw SETUP-UNAUTHENTICATED (simulates unauthed request). */
function simulateUnauthed(): void {
  vi.mocked(requireSetupAuth).mockImplementationOnce(async () => {
    throw new SetupError("SETUP-UNAUTHENTICATED")
  })
}

// ---------------------------------------------------------------------------
// Read-only handlers — no auth guard
// ---------------------------------------------------------------------------

describe("getStepHandler", () => {
  it("returns the derived step with dnsManual false by default", async () => {
    expect(await getStepHandler()).toEqual({
      step: "collect",
      dnsManual: false,
    })
  })

  it("returns dnsManual true when isDnsManual resolves true", async () => {
    vi.mocked(isDnsManual).mockResolvedValueOnce(true)
    expect(await getStepHandler()).toEqual({ step: "collect", dnsManual: true })
  })
})

describe("resolveServerHostname (pur)", () => {
  it("STALMAIL_PUBLIC_URL valide → son hostname (source autoritaire)", () => {
    expect(resolveServerHostname("https://mail.exemple.fr", "exemple.fr")).toBe(
      "mail.exemple.fr"
    )
  })
  it("env absente → repli sur le nom de domaine", () => {
    expect(resolveServerHostname(undefined, "exemple.fr")).toBe("exemple.fr")
  })
  it("env malformée → repli sur le nom de domaine", () => {
    expect(resolveServerHostname("pas une url", "exemple.fr")).toBe(
      "exemple.fr"
    )
  })
  it("env vide → repli sur le nom de domaine", () => {
    expect(resolveServerHostname("", "exemple.fr")).toBe("exemple.fr")
  })
})

describe("setupContextHandler (#19 — ré-hydratation)", () => {
  const ENV_KEY = "STALMAIL_PUBLIC_URL"
  const prevEnv = process.env[ENV_KEY]
  afterEach(() => {
    if (prevEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = prevEnv
  })

  it("mode bootstrap (pré-collect) → valeurs vides, sans requêter le domaine", async () => {
    vi.mocked(isBootstrapMode).mockResolvedValueOnce(true)
    expect(await setupContextHandler()).toEqual({
      serverHostname: "",
      defaultDomain: "",
    })
    expect(getPrimaryDomain).not.toHaveBeenCalled()
  })

  it("hors bootstrap, sans env → hostname = nom de domaine (Stalwart autoritatif)", async () => {
    delete process.env[ENV_KEY]
    vi.mocked(isBootstrapMode).mockResolvedValueOnce(false)
    expect(await setupContextHandler()).toEqual({
      serverHostname: "exemple.fr",
      defaultDomain: "exemple.fr",
    })
  })

  it("hors bootstrap, avec env → hostname = hostname de STALMAIL_PUBLIC_URL", async () => {
    process.env[ENV_KEY] = "https://mail.exemple.fr"
    vi.mocked(isBootstrapMode).mockResolvedValueOnce(false)
    expect(await setupContextHandler()).toEqual({
      serverHostname: "mail.exemple.fr",
      defaultDomain: "exemple.fr",
    })
  })

  it("hors bootstrap, domaine introuvable, sans env → valeurs vides", async () => {
    delete process.env[ENV_KEY]
    vi.mocked(isBootstrapMode).mockResolvedValueOnce(false)
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce(null)
    expect(await setupContextHandler()).toEqual({
      serverHostname: "",
      defaultDomain: "",
    })
  })

  it("hors bootstrap, domaine introuvable MAIS env présente → hostname URL, domaine vide (asymétrie voulue)", async () => {
    process.env[ENV_KEY] = "https://mail.exemple.fr"
    vi.mocked(isBootstrapMode).mockResolvedValueOnce(false)
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce(null)
    expect(await setupContextHandler()).toEqual({
      serverHostname: "mail.exemple.fr",
      defaultDomain: "",
    })
  })
})

describe("setupAuthStatusHandler", () => {
  it("returns {authed:true} when isSetupAuthed returns true", async () => {
    vi.mocked(isSetupAuthed).mockReturnValueOnce(true)
    const result = await setupAuthStatusHandler()
    expect(result).toEqual({ authed: true })
  })

  it("returns {authed:false} when isSetupAuthed returns false", async () => {
    vi.mocked(isSetupAuthed).mockReturnValueOnce(false)
    const result = await setupAuthStatusHandler()
    expect(result).toEqual({ authed: false })
  })
})

// ---------------------------------------------------------------------------
// unlockSetupHandler — special: no requireSetupAuth, calls unlockSetup
// ---------------------------------------------------------------------------

describe("unlockSetupHandler", () => {
  it("calls unlockSetup with the provided token and returns {ok:true}", async () => {
    const result = await unlockSetupHandler({ data: { token: "secret-tok" } })
    expect(unlockSetup).toHaveBeenCalledWith("secret-tok")
    expect(result).toEqual({ ok: true })
  })

  it("propagates errors thrown by unlockSetup", async () => {
    vi.mocked(unlockSetup).mockImplementationOnce(() => {
      throw new SetupError("SETUP-UNLOCK-FAILED")
    })
    const err = await unlockSetupHandler({
      data: { token: "bad" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNLOCK-FAILED")
  })

  it("does NOT call requireSetupAuth", async () => {
    await unlockSetupHandler({ data: { token: "tok" } })
    expect(requireSetupAuth).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// submitBootstrapHandler
// ---------------------------------------------------------------------------

describe("submitBootstrapHandler", () => {
  it("submits bootstrap then requests a Stalwart restart", async () => {
    // mock returns "collect" by default — matches requireStep("collect")
    const out = await submitBootstrapHandler({
      data: { serverHostname: "mail.exemple.fr", defaultDomain: "exemple.fr" },
    })
    expect(submitBootstrap).toHaveBeenCalledWith({
      serverHostname: "mail.exemple.fr",
      defaultDomain: "exemple.fr",
    })
    expect(requestStalwartRestart).toHaveBeenCalled()
    expect(out).toEqual({ ok: true })
  })

  it("calls assertSameOriginStrict and requireSetupAuth before action", async () => {
    const callOrder: string[] = []
    vi.mocked(assertSameOriginStrict).mockImplementationOnce(() => {
      callOrder.push("assertSameOriginStrict")
    })
    vi.mocked(requireSetupAuth).mockImplementationOnce(async () => {
      callOrder.push("requireSetupAuth")
    })
    vi.mocked(submitBootstrap).mockImplementationOnce(async () => {
      callOrder.push("submitBootstrap")
      return { username: "u", secret: "s" }
    })
    await submitBootstrapHandler({
      data: { serverHostname: "mail.exemple.fr", defaultDomain: "exemple.fr" },
    })
    expect(callOrder[0]).toBe("assertSameOriginStrict")
    expect(callOrder[1]).toBe("requireSetupAuth")
    expect(callOrder[2]).toBe("submitBootstrap")
  })

  it("calls issueSetupCookie on success", async () => {
    await submitBootstrapHandler({
      data: { serverHostname: "mail.exemple.fr", defaultDomain: "exemple.fr" },
    })
    expect(issueSetupCookie).toHaveBeenCalledOnce()
  })

  it("throws SETUP-UNAUTHENTICATED when requireSetupAuth throws", async () => {
    simulateUnauthed()
    const err = await submitBootstrapHandler({
      data: { serverHostname: "x", defaultDomain: "y" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNAUTHENTICATED")
    expect(issueSetupCookie).not.toHaveBeenCalled()
  })

  it("does not request a restart if submitBootstrap throws", async () => {
    vi.mocked(submitBootstrap).mockRejectedValueOnce(new Error("network"))
    await expect(
      submitBootstrapHandler({
        data: { serverHostname: "x", defaultDomain: "y" },
      })
    ).rejects.toThrow("network")
    expect(requestStalwartRestart).not.toHaveBeenCalled()
  })

  it("throws SETUP-FORBIDDEN when step is not 'collect'", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("dns")
    const err = await submitBootstrapHandler({
      data: { serverHostname: "x", defaultDomain: "y" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })

  it("throws SETUP-FORBIDDEN when setup is done", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("done")
    const err = await submitBootstrapHandler({
      data: { serverHostname: "x", defaultDomain: "y" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })
})

// ---------------------------------------------------------------------------
// createAdminAccountHandler
// ---------------------------------------------------------------------------

describe("createAdminAccountHandler", () => {
  beforeEach(() => {
    // This handler requires step "account"
    vi.mocked(deriveSetupStep).mockResolvedValue("account")
  })

  it('returns {status:"ok"} on success and calls createAdminAccount with correct args', async () => {
    vi.mocked(createAdminAccount).mockResolvedValueOnce("acc-1")
    const result = await createAdminAccountHandler({
      data: { name: "koffi", password: "correct horse battery staple" },
    })
    expect(result).toEqual({ status: "ok" })
    expect(createAdminAccount).toHaveBeenCalledWith({
      name: "koffi",
      domainId: "dom-1",
      password: "correct horse battery staple",
    })
  })

  it("calls issueSetupCookie on success", async () => {
    await createAdminAccountHandler({
      data: { name: "koffi", password: "correct horse battery staple" },
    })
    expect(issueSetupCookie).toHaveBeenCalledOnce()
  })

  it("throws SETUP-UNAUTHENTICATED when requireSetupAuth throws", async () => {
    simulateUnauthed()
    const err = await createAdminAccountHandler({
      data: { name: "koffi", password: "correct horse battery staple" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNAUTHENTICATED")
    expect(issueSetupCookie).not.toHaveBeenCalled()
  })

  it('returns {status:"weak"} when createAdminAccount throws WeakPasswordError', async () => {
    vi.mocked(createAdminAccount).mockRejectedValueOnce(
      new WeakPasswordError("too weak")
    )
    const result = await createAdminAccountHandler({
      data: { name: "koffi", password: "abc" },
    })
    expect(result).toEqual({ status: "weak", message: "too weak" })
  })

  it("throws SetupError with SETUP-ACCOUNT-REJECTED for non-weak errors", async () => {
    vi.mocked(createAdminAccount).mockRejectedValueOnce(
      new Error("network failure")
    )
    const err = await createAdminAccountHandler({
      data: { name: "koffi", password: "correct horse battery staple" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-ACCOUNT-REJECTED")
  })

  it("throws SETUP-UNKNOWN when no primary domain is found (I2)", async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce(null)
    const err = await createAdminAccountHandler({
      data: { name: "koffi", password: "correct horse battery staple" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNKNOWN")
  })

  it("throws SETUP-FORBIDDEN when step is not 'account'", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("collect")
    const err = await createAdminAccountHandler({
      data: { name: "koffi", password: "secure-pass" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })

  it("throws SETUP-FORBIDDEN when setup is done", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("done")
    const err = await createAdminAccountHandler({
      data: { name: "koffi", password: "secure-pass" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })
})

// ---------------------------------------------------------------------------
// createDnsServerHandler
// ---------------------------------------------------------------------------

describe("createDnsServerHandler", () => {
  beforeEach(() => {
    vi.mocked(deriveSetupStep).mockResolvedValue("dns")
  })

  it("returns {dnsServerId} from createDnsServer", async () => {
    vi.mocked(createDnsServer).mockResolvedValueOnce("srv-1")
    const result = await createDnsServerHandler({
      data: { provider: "Cloudflare", secret: "tok-abc" },
    })
    expect(result).toEqual({ dnsServerId: "srv-1" })
  })

  it("calls issueSetupCookie on success", async () => {
    await createDnsServerHandler({
      data: { provider: "Cloudflare", secret: "tok-abc" },
    })
    expect(issueSetupCookie).toHaveBeenCalledOnce()
  })

  it("throws SETUP-UNAUTHENTICATED when requireSetupAuth throws", async () => {
    simulateUnauthed()
    const err = await createDnsServerHandler({
      data: { provider: "Cloudflare", secret: "tok" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNAUTHENTICATED")
    expect(issueSetupCookie).not.toHaveBeenCalled()
  })

  it("throws SetupError with SETUP-DNS-REJECTED on createDnsServer failure", async () => {
    vi.mocked(createDnsServer).mockRejectedValueOnce(new Error("network"))
    const err = await createDnsServerHandler({
      data: { provider: "Cloudflare", secret: "tok" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-DNS-REJECTED")
  })

  it("throws SETUP-FORBIDDEN when step is not 'dns'", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("collect")
    const err = await createDnsServerHandler({
      data: { provider: "Cloudflare", secret: "tok" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })

  it("throws SETUP-FORBIDDEN when setup is done", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("done")
    const err = await createDnsServerHandler({
      data: { provider: "Cloudflare", secret: "tok" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })
})

// ---------------------------------------------------------------------------
// setDnsManagementHandler
// ---------------------------------------------------------------------------

describe("setDnsManagementHandler", () => {
  beforeEach(() => {
    vi.mocked(deriveSetupStep).mockResolvedValue("dns")
  })

  it("resolves the domain and calls setDnsManagementAutomatic with correct args", async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce({
      id: "dom-1",
      name: "example.com",
    })
    vi.mocked(setDnsManagementAutomatic).mockResolvedValueOnce(undefined)
    const result = await setDnsManagementHandler({
      data: { dnsServerId: "srv-1" },
    })
    expect(result).toEqual({ ok: true })
    expect(setDnsManagementAutomatic).toHaveBeenCalledWith({
      domainId: "dom-1",
      dnsServerId: "srv-1",
      origin: "example.com",
    })
  })

  it("calls issueSetupCookie on success", async () => {
    await setDnsManagementHandler({ data: { dnsServerId: "srv-1" } })
    expect(issueSetupCookie).toHaveBeenCalledOnce()
  })

  it("throws SETUP-UNAUTHENTICATED when requireSetupAuth throws", async () => {
    simulateUnauthed()
    const err = await setDnsManagementHandler({
      data: { dnsServerId: "srv-1" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNAUTHENTICATED")
    expect(issueSetupCookie).not.toHaveBeenCalled()
  })

  it("throws SETUP-UNKNOWN when getPrimaryDomain returns null (I2)", async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce(null)
    const err = await setDnsManagementHandler({
      data: { dnsServerId: "srv-1" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNKNOWN")
  })

  it("throws SetupError with SETUP-DNS-MANAGEMENT-REJECTED on setDnsManagementAutomatic failure", async () => {
    vi.mocked(setDnsManagementAutomatic).mockRejectedValueOnce(
      new Error("network")
    )
    const err = await setDnsManagementHandler({
      data: { dnsServerId: "srv-1" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-DNS-MANAGEMENT-REJECTED")
  })

  it("throws SETUP-FORBIDDEN when step is not 'dns'", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("ssl")
    const err = await setDnsManagementHandler({
      data: { dnsServerId: "srv-1" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })
})

// ---------------------------------------------------------------------------
// dnsGridStatusHandler — read-only, no auth guard
// ---------------------------------------------------------------------------

describe("dnsGridStatusHandler", () => {
  it("maps verified/mismatch/missing to verified/error/pending", async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce({
      id: "dom-1",
      name: "example.com",
      dnsZoneFile: "zone content",
    })
    const fakeRecords = [
      { name: "example.com", type: "A", value: "1.2.3.4" },
      { name: "mail.example.com", type: "MX", value: "mail.example.com" },
      { name: "_dmarc.example.com", type: "TXT", value: "v=DMARC1" },
    ]
    vi.mocked(parseZoneFile).mockReturnValueOnce(fakeRecords)
    vi.mocked(resolveRecordStatus)
      .mockResolvedValueOnce("verified")
      .mockResolvedValueOnce("mismatch")
      .mockResolvedValueOnce("missing")
    const result = await dnsGridStatusHandler()
    expect(result.origin).toBe("example.com")
    expect(result.records).toHaveLength(3)
    expect(result.records[0].status).toBe("verified")
    expect(result.records[1].status).toBe("error")
    expect(result.records[2].status).toBe("pending")
  })

  it("returns {records:[]} when domain has no dnsZoneFile", async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce({
      id: "dom-1",
      name: "example.com",
    })
    const result = await dnsGridStatusHandler()
    expect(result).toEqual({ origin: "example.com", records: [] })
  })
})

// ---------------------------------------------------------------------------
// configureAcmeHandler
// ---------------------------------------------------------------------------

describe("configureAcmeHandler", () => {
  beforeEach(() => {
    vi.mocked(deriveSetupStep).mockResolvedValue("ssl")
  })

  it("resolves the domain and calls configureAcme with correct args, returns {ok:true}", async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce({
      id: "dom-1",
      name: "example.com",
    })
    vi.mocked(configureAcme).mockResolvedValueOnce("prov-1")
    const result = await configureAcmeHandler({
      data: { hostname: "mail.example.com", contactEmail: "admin@example.com" },
    })
    expect(configureAcme).toHaveBeenCalledWith({
      domainId: "dom-1",
      hostname: "mail.example.com",
      contactEmail: "admin@example.com",
    })
    expect(result).toEqual({ ok: true })
  })

  it("calls issueSetupCookie on success", async () => {
    await configureAcmeHandler({
      data: { hostname: "mail.example.com", contactEmail: "admin@example.com" },
    })
    expect(issueSetupCookie).toHaveBeenCalledOnce()
  })

  it("throws SETUP-UNAUTHENTICATED when requireSetupAuth throws", async () => {
    simulateUnauthed()
    const err = await configureAcmeHandler({
      data: {
        hostname: "mail.example.com",
        contactEmail: "admin@example.com",
      },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNAUTHENTICATED")
    expect(issueSetupCookie).not.toHaveBeenCalled()
  })

  it("throws SETUP-UNKNOWN when getPrimaryDomain returns null (I2)", async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce(null)
    const err = await configureAcmeHandler({
      data: {
        hostname: "mail.example.com",
        contactEmail: "admin@example.com",
      },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNKNOWN")
  })

  it("resume (empty client input): sources hostname from STALMAIL_PUBLIC_URL and contactEmail from the domain", async () => {
    const prev = process.env.STALMAIL_PUBLIC_URL
    process.env.STALMAIL_PUBLIC_URL = "https://mail.example.com/"
    try {
      vi.mocked(getPrimaryDomain).mockResolvedValueOnce({
        id: "dom-1",
        name: "example.com",
      })
      vi.mocked(configureAcme).mockResolvedValueOnce("prov-1")
      // Empty client values, as on a pure resume into the SSL step.
      const result = await configureAcmeHandler({
        data: { hostname: "", contactEmail: "" },
      })
      expect(result).toEqual({ ok: true })
      expect(configureAcme).toHaveBeenCalledWith({
        domainId: "dom-1",
        hostname: "mail.example.com",
        contactEmail: "admin@example.com",
      })
    } finally {
      if (prev === undefined) delete process.env.STALMAIL_PUBLIC_URL
      else process.env.STALMAIL_PUBLIC_URL = prev
    }
  })

  it("throws SetupError with SETUP-SSL-REJECTED on configureAcme failure", async () => {
    vi.mocked(configureAcme).mockRejectedValueOnce(new Error("acme error"))
    const err = await configureAcmeHandler({
      data: { hostname: "mail.example.com", contactEmail: "admin@example.com" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-SSL-REJECTED")
  })

  it("throws SETUP-FORBIDDEN when step is not 'ssl'", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("dns")
    const err = await configureAcmeHandler({
      data: { hostname: "mail.example.com", contactEmail: "admin@example.com" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })

  it("throws SETUP-FORBIDDEN when setup is done", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("done")
    const err = await configureAcmeHandler({
      data: { hostname: "mail.example.com", contactEmail: "admin@example.com" },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })
})

// ---------------------------------------------------------------------------
// acmeStatusHandler — read-only, no auth guard
// ---------------------------------------------------------------------------

describe("acmeStatusHandler", () => {
  it("returns {status} from getAcmeStatus", async () => {
    vi.mocked(getAcmeStatus).mockResolvedValueOnce("pending")
    const result = await acmeStatusHandler()
    expect(result).toEqual({ status: "pending" })
  })
})

// ---------------------------------------------------------------------------
// dnsManagementStatusHandler — read-only, no auth guard
// ---------------------------------------------------------------------------

describe("dnsManagementStatusHandler", () => {
  it("returns {status} from getDnsManagementStatus", async () => {
    vi.mocked(getDnsManagementStatus).mockResolvedValueOnce("failed")
    const result = await dnsManagementStatusHandler()
    expect(result).toEqual({ status: "failed" })
  })
})

// ---------------------------------------------------------------------------
// finishSetupHandler
// ---------------------------------------------------------------------------

describe("finishSetupHandler", () => {
  beforeEach(() => {
    vi.mocked(deriveSetupStep).mockResolvedValue("done")
  })

  it("calls enableXForwarded before markSetupComplete and returns {ok:true}", async () => {
    const callOrder: string[] = []
    vi.mocked(enableXForwarded).mockImplementationOnce(async () => {
      callOrder.push("enableXForwarded")
    })
    vi.mocked(markSetupComplete).mockImplementationOnce(() => {
      callOrder.push("markSetupComplete")
    })
    const result = await finishSetupHandler()
    expect(enableXForwarded).toHaveBeenCalled()
    expect(markSetupComplete).toHaveBeenCalled()
    expect(callOrder).toEqual(["enableXForwarded", "markSetupComplete"])
    expect(result).toEqual({ ok: true })
  })

  it("calls clearSetupCookie (not issueSetupCookie) on success", async () => {
    await finishSetupHandler()
    expect(clearSetupCookie).toHaveBeenCalledOnce()
    expect(issueSetupCookie).not.toHaveBeenCalled()
  })

  it("throws SETUP-UNAUTHENTICATED when requireSetupAuth throws", async () => {
    simulateUnauthed()
    const err = await finishSetupHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNAUTHENTICATED")
    expect(issueSetupCookie).not.toHaveBeenCalled()
  })

  it("does not mark setup complete when enableXForwarded rejects", async () => {
    vi.mocked(enableXForwarded).mockRejectedValueOnce(
      new Error("http-set failed")
    )
    await expect(finishSetupHandler()).rejects.toThrow("http-set failed")
    expect(markSetupComplete).not.toHaveBeenCalled()
  })

  it("throws SETUP-FORBIDDEN when step is not 'done'", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("account")
    const err = await finishSetupHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })
})

// ---------------------------------------------------------------------------
// setupStatusHandler — read-only, no auth guard
// ---------------------------------------------------------------------------

describe("setupStatusHandler", () => {
  it("returns {configured:false} when isSetupComplete returns false", async () => {
    vi.mocked(isSetupComplete).mockReturnValueOnce(false)
    const result = await setupStatusHandler()
    expect(result).toEqual({ configured: false })
    expect(isSetupComplete).toHaveBeenCalledOnce()
  })

  it("returns {configured:true} when isSetupComplete returns true", async () => {
    vi.mocked(isSetupComplete).mockReturnValueOnce(true)
    const result = await setupStatusHandler()
    expect(result).toEqual({ configured: true })
    expect(isSetupComplete).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// setDnsManagementManualHandler
// ---------------------------------------------------------------------------

describe("setDnsManagementManualHandler", () => {
  beforeEach(() => {
    vi.mocked(deriveSetupStep).mockResolvedValue("dns")
  })

  it("calls setDnsManagementManual and markDnsConfigured on success", async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce({
      id: "dom-1",
      name: "example.com",
    })
    vi.mocked(setDnsManagementManual).mockResolvedValueOnce(undefined)
    vi.mocked(markDnsConfigured).mockImplementationOnce(() => {})
    const result = await setDnsManagementManualHandler()
    expect(result).toEqual({ ok: true })
    expect(setDnsManagementManual).toHaveBeenCalledWith({ domainId: "dom-1" })
    expect(markDnsConfigured).toHaveBeenCalled()
  })

  it("calls issueSetupCookie on success", async () => {
    await setDnsManagementManualHandler()
    expect(issueSetupCookie).toHaveBeenCalledOnce()
  })

  it("throws SETUP-UNAUTHENTICATED when requireSetupAuth throws", async () => {
    simulateUnauthed()
    const err = await setDnsManagementManualHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNAUTHENTICATED")
    expect(issueSetupCookie).not.toHaveBeenCalled()
  })

  it("throws SETUP-UNKNOWN when getPrimaryDomain returns null (I2)", async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce(null)
    const err = await setDnsManagementManualHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNKNOWN")
    expect(markDnsConfigured).not.toHaveBeenCalled()
  })

  it("throws SetupError with SETUP-DNS-MANAGEMENT-REJECTED on setDnsManagementManual failure", async () => {
    vi.mocked(setDnsManagementManual).mockRejectedValueOnce(
      new Error("network")
    )
    const err = await setDnsManagementManualHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-DNS-MANAGEMENT-REJECTED")
    expect(markDnsConfigured).not.toHaveBeenCalled()
  })

  it("throws SETUP-FORBIDDEN when step is not 'dns'", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("ssl")
    const err = await setDnsManagementManualHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })
})

// ---------------------------------------------------------------------------
// markSslConfiguredHandler
// ---------------------------------------------------------------------------

describe("markSslConfiguredHandler", () => {
  beforeEach(() => {
    vi.mocked(deriveSetupStep).mockResolvedValue("ssl")
    vi.mocked(isDnsManual).mockResolvedValue(true)
  })

  it("calls markSslAcknowledged and returns {ok:true} when ssl step and manual DNS", async () => {
    vi.mocked(markSslAcknowledged).mockImplementationOnce(() => {})
    const result = await markSslConfiguredHandler()
    expect(result).toEqual({ ok: true })
    expect(markSslAcknowledged).toHaveBeenCalledOnce()
  })

  it("calls issueSetupCookie on success", async () => {
    await markSslConfiguredHandler()
    expect(issueSetupCookie).toHaveBeenCalledOnce()
  })

  it("throws SETUP-UNAUTHENTICATED when requireSetupAuth throws", async () => {
    simulateUnauthed()
    const err = await markSslConfiguredHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-UNAUTHENTICATED")
    expect(issueSetupCookie).not.toHaveBeenCalled()
  })

  it("throws SETUP-FORBIDDEN when step is not 'ssl'", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("dns")
    const err = await markSslConfiguredHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
    expect(markSslAcknowledged).not.toHaveBeenCalled()
  })

  it("throws SETUP-FORBIDDEN when DNS is not manual (non-manual mode)", async () => {
    vi.mocked(isDnsManual).mockResolvedValueOnce(false)
    const err = await markSslConfiguredHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
    expect(markSslAcknowledged).not.toHaveBeenCalled()
  })

  it("throws SETUP-FORBIDDEN when setup is done", async () => {
    vi.mocked(deriveSetupStep).mockResolvedValueOnce("done")
    const err = await markSslConfiguredHandler().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SetupError)
    expect((err as SetupError).code).toBe("SETUP-FORBIDDEN")
  })
})
