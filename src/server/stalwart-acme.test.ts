import { describe, it, expect, vi, beforeEach } from "vitest"
import type * as JmapModule from "./jmap"

// Mock only the transport (jmapCall) and account resolution; keep firstResponse,
// expectResult and JmapError REAL (they are pure helpers / the real error class).
vi.mock("./jmap", async (importActual) => ({
  ...(await importActual<typeof JmapModule>()),
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => "acc1"),
}))

// eslint-disable-next-line import/first
import { jmapCall, JmapError } from "./jmap"
// eslint-disable-next-line import/first
import { configureAcme, getAcmeStatus } from "./stalwart-acme"

const mj = vi.mocked(jmapCall)
beforeEach(() => vi.clearAllMocks())

describe("configureAcme", () => {
  it("creates a DNS-01 provider (contact map) then flips the domain (SAN map)", async () => {
    mj.mockResolvedValueOnce([
      ["x:AcmeProvider/set", { created: { p1: { id: "prov1" } } }, "0"],
    ])
    mj.mockResolvedValueOnce([["x:Domain/set", { updated: { dom1: {} } }, "0"]])

    const result = await configureAcme({
      domainId: "dom1",
      hostname: "mail.dupont.fr",
      contactEmail: "admin@dupont.fr",
    })

    expect(result).toBe("prov1")

    // --- Call 1: x:AcmeProvider/set ---
    const [[methodName1, args1]] = mj.mock.calls[0][0] as [
      [string, Record<string, unknown>, string],
    ]
    expect(methodName1).toBe("x:AcmeProvider/set")
    const create = (args1.create as { p1: Record<string, unknown> }).p1
    expect(create.challengeType).toBe("Dns01")
    // contact is a MAP {"mailto:<email>": true}, NOT an array.
    expect(Array.isArray(create.contact)).toBe(false)
    expect(create.contact).toEqual({ "mailto:admin@dupont.fr": true })

    // --- Call 2: x:Domain/set ---
    const [[methodName2, args2]] = mj.mock.calls[1][0] as [
      [string, Record<string, unknown>, string],
    ]
    expect(methodName2).toBe("x:Domain/set")
    const certMgmt = (
      args2.update as {
        dom1: { certificateManagement: Record<string, unknown> }
      }
    ).dom1.certificateManagement
    expect(certMgmt["@type"]).toBe("Automatic")
    expect(certMgmt.acmeProviderId).toBe("prov1")
    // SAN is a MAP {"<host>": true}, NOT an array.
    expect(Array.isArray(certMgmt.subjectAlternativeNames)).toBe(false)
    expect(certMgmt.subjectAlternativeNames).toEqual({ "mail.dupont.fr": true })
  })

  it("throws when the provider create is rejected (notCreated, no created)", async () => {
    mj.mockResolvedValueOnce([
      [
        "x:AcmeProvider/set",
        { notCreated: { p1: { type: "invalidProperties" } } },
        "0",
      ],
    ])
    await expect(
      configureAcme({
        domainId: "dom1",
        hostname: "mail.dupont.fr",
        contactEmail: "admin@dupont.fr",
      })
    ).rejects.toBeInstanceOf(JmapError)
  })

  it("throws when the domain update is rejected (notUpdated, no updated)", async () => {
    mj.mockResolvedValueOnce([
      ["x:AcmeProvider/set", { created: { p1: { id: "prov1" } } }, "0"],
    ])
    mj.mockResolvedValueOnce([
      [
        "x:Domain/set",
        { notUpdated: { dom1: { type: "invalidProperties" } } },
        "0",
      ],
    ])
    await expect(
      configureAcme({
        domainId: "dom1",
        hostname: "mail.dupont.fr",
        contactEmail: "admin@dupont.fr",
      })
    ).rejects.toBeInstanceOf(JmapError)
  })
})

describe("getAcmeStatus", () => {
  it("returns 'pending' when the AcmeRenewal task is Pending", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1"] }, "0"],
      [
        "x:Task/get",
        { list: [{ "@type": "AcmeRenewal", status: { "@type": "Pending" } }] },
        "1",
      ],
    ])
    await expect(getAcmeStatus()).resolves.toBe("pending")
  })

  it("returns 'failed' when the AcmeRenewal task is Failed", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1"] }, "0"],
      [
        "x:Task/get",
        { list: [{ "@type": "AcmeRenewal", status: { "@type": "Failed" } }] },
        "1",
      ],
    ])
    await expect(getAcmeStatus()).resolves.toBe("failed")
  })

  it("returns 'valid' when there is no AcmeRenewal task", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: [] }, "0"],
      [
        "x:Task/get",
        {
          list: [{ "@type": "SomethingElse", status: { "@type": "Pending" } }],
        },
        "1",
      ],
    ])
    await expect(getAcmeStatus()).resolves.toBe("valid")
  })
})
