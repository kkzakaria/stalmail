import { describe, it, expect, vi, beforeEach } from "vitest"
import type * as JmapModule from "./jmap"

vi.mock("./setup-flag", () => ({
  isSetupComplete: vi.fn(),
  isDnsConfigured: vi.fn(),
  isSslAcknowledged: vi.fn(),
}))
vi.mock("./stalwart-bootstrap", () => ({ isBootstrapMode: vi.fn() }))
vi.mock("./stalwart-domain", () => ({ getPrimaryDomain: vi.fn() }))
vi.mock("./jmap", async (importActual) => ({
  ...(await importActual<typeof JmapModule>()),
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => "d333333"),
}))
vi.mock("./stalwart-dns", () => ({ getDnsManagementStatus: vi.fn() }))

// eslint-disable-next-line import/first
import {
  isSetupComplete,
  isDnsConfigured,
  isSslAcknowledged,
} from "./setup-flag"
// eslint-disable-next-line import/first
import { isBootstrapMode } from "./stalwart-bootstrap"
// eslint-disable-next-line import/first
import { getPrimaryDomain } from "./stalwart-domain"
// eslint-disable-next-line import/first
import { jmapCall } from "./jmap"
// eslint-disable-next-line import/first
import { getDnsManagementStatus } from "./stalwart-dns"
// eslint-disable-next-line import/first
import { deriveSetupStep, isDnsManual } from "./setup-state"

const flag = vi.mocked(isSetupComplete)
const dnsFlag = vi.mocked(isDnsConfigured)
const sslFlag = vi.mocked(isSslAcknowledged)
const boot = vi.mocked(isBootstrapMode)
const dom = vi.mocked(getPrimaryDomain)
const mj = vi.mocked(jmapCall)
const dnsMgmt = vi.mocked(getDnsManagementStatus)

// Helper: a JMAP query+get pair for the given account list.
const accounts = (list: Array<{ name?: string; description?: string }>) =>
  [
    ["x:Account/query", { ids: list.map((_, i) => String(i)) }, "0"],
    ["x:Account/get", { list }, "1"],
  ] as [string, Record<string, unknown>, string][]

// The system admin Stalwart auto-creates during bootstrap.
const SYSTEM_ADMIN = { name: "admin", description: "System administrator" }

// A domain fully configured: DNS Automatic + SSL (certificateManagement) Automatic.
const DOMAIN_FULL = {
  id: "b",
  name: "exemple.fr",
  dnsManagement: { "@type": "Automatic" },
  certificateManagement: { "@type": "Automatic" },
}

beforeEach(() => {
  vi.clearAllMocks()
  flag.mockReturnValue(false)
  dnsFlag.mockReturnValue(false)
  sslFlag.mockReturnValue(false)
  boot.mockResolvedValue(false)
  dom.mockResolvedValue(null)
  mj.mockResolvedValue(accounts([SYSTEM_ADMIN])) // only the system admin by default
  dnsMgmt.mockResolvedValue("published") // publication réussie par défaut
})

describe("deriveSetupStep — nouvel ordre collect → dns → ssl → account → done", () => {
  it('returns "done" when the setup-complete flag is set', async () => {
    flag.mockReturnValue(true)
    expect(await deriveSetupStep()).toBe("done")
  })

  it('returns "collect" in bootstrap mode', async () => {
    boot.mockResolvedValue(true)
    expect(await deriveSetupStep()).toBe("collect")
  })

  // --- Étape DNS (vérifiée avant account) ---

  it('returns "dns" when dnsManagement is Manual and the dns marker is absent', async () => {
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Manual" },
    })
    expect(await deriveSetupStep()).toBe("dns")
  })

  it('returns "dns" when domain is null (no domain configured yet)', async () => {
    dom.mockResolvedValue(null)
    expect(await deriveSetupStep()).toBe("dns")
  })

  it('returns "dns" when domain is null even if the dnsConfigured marker is set (invalid state)', async () => {
    dnsFlag.mockReturnValue(true)
    dom.mockResolvedValue(null)
    // A missing domain must not be treated as managed just because the marker is set.
    expect(await deriveSetupStep()).toBe("dns")
  })

  it("ordre : DNS est vérifié avant account (compte présent mais DNS non configuré → dns)", async () => {
    // Un compte user existe déjà, mais DNS pas configuré → doit retourner 'dns' pas 'account'
    mj.mockResolvedValue(accounts([SYSTEM_ADMIN, { name: "koffi" }]))
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Manual" },
    })
    expect(await deriveSetupStep()).toBe("dns")
  })

  it('Automatic mais publication échouée (token invalide) → reste "dns" pour ressaisie (#62)', async () => {
    // dnsManagement=Automatic est posé même avec un mauvais token (la tâche
    // DnsManagement échoue à la publication) ; l'étape doit rester 'dns' sinon
    // requireStep('dns') refuse le retry → SETUP-FORBIDDEN.
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Automatic" },
    })
    dnsMgmt.mockResolvedValue("failed")
    expect(await deriveSetupStep()).toBe("dns")
  })

  it("Automatic + publication pending (bon token, en cours) → dépasse dns (→ ssl)", async () => {
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Automatic" },
    })
    dnsMgmt.mockResolvedValue("pending")
    expect(await deriveSetupStep()).toBe("ssl")
  })

  // --- Marqueur manuel ---

  it("Manuel : le marqueur isDnsConfigured fait dépasser l'étape dns (→ ssl)", async () => {
    // dnsManagement Manual mais le flag .stalmail-dns-configured est posé
    dnsFlag.mockReturnValue(true)
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Manual" },
    })
    // certificateManagement absent → attendu 'ssl'
    expect(await deriveSetupStep()).toBe("ssl")
  })

  // --- Marqueur SSL Manuel (régression #1) ---

  it("Manuel : dnsConfigured=true, certificateManagement absent, sslAcknowledged=false → 'ssl'", async () => {
    dnsFlag.mockReturnValue(true)
    sslFlag.mockReturnValue(false)
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Manual" },
    })
    expect(await deriveSetupStep()).toBe("ssl")
  })

  it("Manuel : dnsConfigured=true, certificateManagement absent, sslAcknowledged=true → 'account'", async () => {
    dnsFlag.mockReturnValue(true)
    sslFlag.mockReturnValue(true)
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Manual" },
    })
    expect(await deriveSetupStep()).toBe("account")
  })

  // --- Étape SSL ---

  it('returns "ssl" when dnsManagement is Automatic but certificateManagement is absent', async () => {
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Automatic" },
    })
    expect(await deriveSetupStep()).toBe("ssl")
  })

  it('returns "ssl" when dnsManagement is Automatic but certificateManagement is not Automatic', async () => {
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Automatic" },
      certificateManagement: { "@type": "Manual" },
    })
    expect(await deriveSetupStep()).toBe("ssl")
  })

  // --- Étape Account ---

  it('returns "account" when DNS+SSL are configured but only the system admin exists', async () => {
    dom.mockResolvedValue(DOMAIN_FULL)
    mj.mockResolvedValue(accounts([SYSTEM_ADMIN]))
    expect(await deriveSetupStep()).toBe("account")
  })

  it('treats "admin" account without system description as a real user account', async () => {
    // dnsManagement Manual mais comptes vérifiés ensuite — ici DNS Automatic + SSL Automatic
    dom.mockResolvedValue(DOMAIN_FULL)
    mj.mockResolvedValue(
      accounts([
        { name: "admin", description: "Custom admin" },
        { name: "koffi" },
      ])
    )
    expect(await deriveSetupStep()).toBe("done")
  })

  // --- Étape Done ---

  it('returns "done" when DNS Automatic, SSL Automatic, and a real user account exists', async () => {
    dom.mockResolvedValue(DOMAIN_FULL)
    mj.mockResolvedValue(accounts([SYSTEM_ADMIN, { name: "koffi" }]))
    expect(await deriveSetupStep()).toBe("done")
  })

  it("propagates errors from the account query instead of forcing the account step", async () => {
    dom.mockResolvedValue(DOMAIN_FULL)
    mj.mockResolvedValue([
      ["x:Account/query", { ids: ["0"] }, "0"],
      ["error", { type: "serverFail" }, "1"],
    ])
    await expect(deriveSetupStep()).rejects.toThrow()
  })
})

describe("isDnsManual", () => {
  it("returns true when marker is set and dnsManagement is not Automatic (Manual)", async () => {
    dnsFlag.mockReturnValue(true)
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Manual" },
    })
    expect(await isDnsManual()).toBe(true)
  })

  it("returns false when marker is set but dnsManagement is Automatic (auto path)", async () => {
    dnsFlag.mockReturnValue(true)
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Automatic" },
    })
    expect(await isDnsManual()).toBe(false)
  })

  it("returns false when marker is not set (DNS step not completed)", async () => {
    dnsFlag.mockReturnValue(false)
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Manual" },
    })
    expect(await isDnsManual()).toBe(false)
  })

  it("returns false when marker is not set and domain is null", async () => {
    dnsFlag.mockReturnValue(false)
    dom.mockResolvedValue(null)
    expect(await isDnsManual()).toBe(false)
  })

  it("returns false when marker IS set but domain is null (invalid state)", async () => {
    dnsFlag.mockReturnValue(true)
    dom.mockResolvedValue(null)
    expect(await isDnsManual()).toBe(false)
  })
})

// Integration tests: drive the REAL deriveSetupStep across step transitions,
// mocking only JMAP/flags/bootstrap (same strategy as the unit tests above).
// These guard the marker→derivation coupling that unit tests of the wizard skip.
describe("deriveSetupStep — séquences d'intégration", () => {
  // --- Chemin Auto ---
  it("Auto : dns(Automatic) → ssl(Automatic) → account présent → done", async () => {
    // Étape 1 : DNS Automatic, pas de certificateManagement → 'ssl'
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Automatic" },
    })
    expect(await deriveSetupStep()).toBe("ssl")

    // Étape 2 : DNS Automatic + certificateManagement Automatic, system admin seulement → 'account'
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Automatic" },
      certificateManagement: { "@type": "Automatic" },
    })
    expect(await deriveSetupStep()).toBe("account")

    // Étape 3 : DNS + SSL + compte user → 'done'
    mj.mockResolvedValue(accounts([SYSTEM_ADMIN, { name: "koffi" }]))
    expect(await deriveSetupStep()).toBe("done")
  })

  // --- Chemin Manuel (garde-fou régression #1) ---
  it("Manuel : dnsConfigured marker → 'ssl' ; sslAcknowledged marker → 'account'", async () => {
    // Avant marqueur DNS : retourne 'dns'
    dom.mockResolvedValue({
      id: "b",
      name: "exemple.fr",
      dnsManagement: { "@type": "Manual" },
    })
    expect(await deriveSetupStep()).toBe("dns")

    // Marqueur DNS posé, pas de certificateManagement, sslAcknowledged=false → 'ssl'
    dnsFlag.mockReturnValue(true)
    sslFlag.mockReturnValue(false)
    expect(await deriveSetupStep()).toBe("ssl")

    // Marqueur SSL posé (sslAcknowledged=true), system admin seulement → 'account'
    sslFlag.mockReturnValue(true)
    expect(await deriveSetupStep()).toBe("account")

    // Compte user créé → 'done'
    mj.mockResolvedValue(accounts([SYSTEM_ADMIN, { name: "koffi" }]))
    expect(await deriveSetupStep()).toBe("done")
  })
})
