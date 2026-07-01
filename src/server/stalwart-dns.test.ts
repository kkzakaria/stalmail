import { describe, it, expect, vi, beforeEach } from "vitest"
import type * as JmapModule from "./jmap"

vi.mock("./jmap", async (importActual) => ({
  ...(await importActual<typeof JmapModule>()),
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => "d333333"),
}))

// eslint-disable-next-line import/first
import { jmapCall } from "./jmap"
// eslint-disable-next-line import/first
import {
  createDnsServer,
  findDnsServerId,
  DNS_PROVIDERS,
  classifyDnsManagement,
  getDnsManagementStatus,
} from "./stalwart-dns"

const mj = vi.mocked(jmapCall)
beforeEach(() => vi.clearAllMocks())

describe("DNS_PROVIDERS", () => {
  it("lists real Stalwart providers including Cloudflare and Manual", () => {
    expect(DNS_PROVIDERS).toContain("Cloudflare")
    expect(DNS_PROVIDERS).toContain("Ovh")
    expect(DNS_PROVIDERS).toContain("Manual")
    expect(DNS_PROVIDERS.length).toBeGreaterThan(60)
  })
})

// Mock response for findDnsServerId when no existing server is found.
const NO_EXISTING_DNS_SERVER: [
  [string, Record<string, unknown>, string],
  [string, Record<string, unknown>, string],
] = [
  ["x:DnsServer/query", { ids: [] }, "0"],
  ["x:DnsServer/get", { list: [] }, "1"],
]

describe("findDnsServerId", () => {
  it("retourne null quand aucun DnsServer ne correspond au provider", async () => {
    mj.mockResolvedValueOnce([
      ["x:DnsServer/query", { ids: ["srvA"] }, "0"],
      [
        "x:DnsServer/get",
        { list: [{ id: "srvA", "@type": "DigitalOcean" }] },
        "1",
      ],
    ])
    const id = await findDnsServerId("Cloudflare")
    expect(id).toBeNull()
  })

  it("retourne l'id si un DnsServer du même provider existe", async () => {
    mj.mockResolvedValueOnce([
      ["x:DnsServer/query", { ids: ["srvX"] }, "0"],
      [
        "x:DnsServer/get",
        { list: [{ id: "srvX", "@type": "Cloudflare" }] },
        "1",
      ],
    ])
    const id = await findDnsServerId("Cloudflare")
    expect(id).toBe("srvX")
  })
})

describe("createDnsServer", () => {
  it("réutilise un DnsServer existant (idempotence) en mettant à jour le secret", async () => {
    // find → existing server
    mj.mockResolvedValueOnce([
      ["x:DnsServer/query", { ids: ["srvX"] }, "0"],
      [
        "x:DnsServer/get",
        { list: [{ id: "srvX", "@type": "Cloudflare" }] },
        "1",
      ],
    ])
    // update → applies the corrected secret to the found id (no create)
    mj.mockResolvedValueOnce([
      ["x:DnsServer/set", { updated: { srvX: null } }, "0"],
    ])
    const id = await createDnsServer({
      provider: "Cloudflare",
      secret: "corrected-tok",
    })
    expect(id).toBe("srvX")
    // second call is an UPDATE of the existing id, not a create
    const [[method, args]] = mj.mock.calls[1][0] as [
      [string, Record<string, unknown>, string],
    ]
    expect(method).toBe("x:DnsServer/set")
    expect(args.create).toBeUndefined()
    expect(args.update).toEqual({
      srvX: { secret: { "@type": "Value", secret: "corrected-tok" } },
    })
  })

  it("throws when the idempotent secret update is rejected", async () => {
    mj.mockResolvedValueOnce([
      ["x:DnsServer/query", { ids: ["srvX"] }, "0"],
      [
        "x:DnsServer/get",
        { list: [{ id: "srvX", "@type": "Cloudflare" }] },
        "1",
      ],
    ])
    mj.mockResolvedValueOnce([
      ["x:DnsServer/set", { notUpdated: { srvX: { type: "forbidden" } } }, "0"],
    ])
    await expect(
      createDnsServer({ provider: "Cloudflare", secret: "x" })
    ).rejects.toThrow()
  })

  it('creates a provider variant, wrapping the secret as a SecretKey "Value"', async () => {
    // First call: findDnsServerId returns no match
    mj.mockResolvedValueOnce([...NO_EXISTING_DNS_SERVER])
    // Second call: DnsServer/set creates successfully
    mj.mockResolvedValueOnce([
      ["x:DnsServer/set", { created: { new1: { id: "srv1" } } }, "0"],
    ])
    const id = await createDnsServer({
      provider: "Cloudflare",
      secret: "tok",
      description: "cf",
    })
    expect(id).toBe("srv1")
    // The create call is the second jmapCall (index 1)
    const [[, args]] = mj.mock.calls[1][0] as [
      [string, Record<string, unknown>, string],
    ]
    // secret must be the typed SecretKey object, NOT a bare string (Stalwart v0.16
    // rejects a string with `invalidPatch: Missing or invalid '@type'`).
    expect(args.create).toEqual({
      new1: {
        "@type": "Cloudflare",
        description: "cf",
        secret: { "@type": "Value", secret: "tok" },
      },
    })
  })

  it("throws when creation is rejected", async () => {
    mj.mockResolvedValueOnce([...NO_EXISTING_DNS_SERVER])
    mj.mockResolvedValueOnce([
      [
        "x:DnsServer/set",
        { notCreated: { new1: { type: "invalidProperties" } } },
        "0",
      ],
    ])
    await expect(
      createDnsServer({ provider: "Cloudflare", secret: "x" })
    ).rejects.toThrow()
  })
})

describe("classifyDnsManagement", () => {
  it("returns 'published' when there is no task (completed and cleared)", () => {
    expect(classifyDnsManagement(undefined)).toBe("published")
  })
  it("returns 'failed' when the task status is Failed", () => {
    expect(classifyDnsManagement({ status: { "@type": "Failed" } })).toBe(
      "failed"
    )
  })
  it("returns 'pending' when the task status is Pending", () => {
    expect(classifyDnsManagement({ status: { "@type": "Pending" } })).toBe(
      "pending"
    )
  })
  it("returns 'pending' when the task status is Retry", () => {
    expect(classifyDnsManagement({ status: { "@type": "Retry" } })).toBe(
      "pending"
    )
  })
  it("returns 'pending' when the status envelope is missing", () => {
    expect(classifyDnsManagement({})).toBe("pending")
  })
})

describe("getDnsManagementStatus", () => {
  it("returns 'failed' for a DnsManagement task in Failed", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1"] }, "0"],
      [
        "x:Task/get",
        { list: [{ "@type": "DnsManagement", status: { "@type": "Failed" } }] },
        "1",
      ],
    ])
    await expect(getDnsManagementStatus()).resolves.toBe("failed")
  })
  it("returns 'pending' for a DnsManagement task in Pending", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1"] }, "0"],
      [
        "x:Task/get",
        {
          list: [{ "@type": "DnsManagement", status: { "@type": "Pending" } }],
        },
        "1",
      ],
    ])
    await expect(getDnsManagementStatus()).resolves.toBe("pending")
  })
  it("returns 'published' when no DnsManagement task is present", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1"] }, "0"],
      [
        "x:Task/get",
        { list: [{ "@type": "AcmeRenewal", status: { "@type": "Pending" } }] },
        "1",
      ],
    ])
    await expect(getDnsManagementStatus()).resolves.toBe("published")
  })
  it("ignores non-DnsManagement tasks and classifies the DnsManagement one", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1", "t2"] }, "0"],
      [
        "x:Task/get",
        {
          list: [
            { "@type": "AcmeRenewal", status: { "@type": "Failed" } },
            { "@type": "DnsManagement", status: { "@type": "Pending" } },
          ],
        },
        "1",
      ],
    ])
    await expect(getDnsManagementStatus()).resolves.toBe("pending")
  })
})
