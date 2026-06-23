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
  getPrimaryDomain,
  setDnsManagementAutomatic,
  setDnsManagementManual,
} from "./stalwart-domain"

const mj = vi.mocked(jmapCall)
beforeEach(() => vi.clearAllMocks())

describe("getPrimaryDomain", () => {
  it("queries then gets the first domain (with dnsZoneFile)", async () => {
    mj.mockResolvedValue([
      ["x:Domain/query", { ids: ["b"] }, "0"],
      [
        "x:Domain/get",
        {
          list: [
            {
              id: "b",
              name: "exemple.fr",
              dnsZoneFile: "spike. IN MX 10 mail.",
            },
          ],
        },
        "1",
      ],
    ])
    const d = await getPrimaryDomain()
    expect(d).toEqual({
      id: "b",
      name: "exemple.fr",
      dnsZoneFile: "spike. IN MX 10 mail.",
    })
    const calls = mj.mock.calls[0][0]
    expect(calls[1][0]).toBe("x:Domain/get")
    const getArgs = calls[1][1]
    expect(getArgs["#ids"]).toEqual({
      resultOf: "0",
      name: "x:Domain/query",
      path: "/ids",
    })
  })

  it("returns null when no domain exists", async () => {
    mj.mockResolvedValue([
      ["x:Domain/query", { ids: [] }, "0"],
      ["x:Domain/get", { list: [] }, "1"],
    ])
    expect(await getPrimaryDomain()).toBeNull()
  })

  it("throws when the domain get returns an error response", async () => {
    mj.mockResolvedValue([
      ["x:Domain/query", { ids: ["b"] }, "0"],
      ["error", { type: "serverFail" }, "1"],
    ])
    await expect(getPrimaryDomain()).rejects.toThrow()
  })
})

describe("setDnsManagementAutomatic", () => {
  it("updates the domain dnsManagement to Automatic with the dns server id", async () => {
    mj.mockResolvedValue([["x:Domain/set", { updated: { b: null } }, "0"]])
    await setDnsManagementAutomatic({
      domainId: "b",
      dnsServerId: "srv1",
      origin: "exemple.fr",
    })
    const [[, args]] = mj.mock.calls[0][0] as [
      [string, Record<string, unknown>, string],
    ]
    expect(args.update).toEqual({
      b: {
        dnsManagement: {
          "@type": "Automatic",
          dnsServerId: "srv1",
          origin: "exemple.fr",
          publishRecords: [
            "dkim",
            "spf",
            "mx",
            "dmarc",
            "srv",
            "mtaSts",
            "tlsRpt",
            "caa",
            "autoConfig",
            "autoConfigLegacy",
            "autoDiscover",
          ],
        },
      },
    })
  })

  it("throws when the update is rejected", async () => {
    mj.mockResolvedValue([
      ["x:Domain/set", { notUpdated: { b: { type: "forbidden" } } }, "0"],
    ])
    await expect(
      setDnsManagementAutomatic({
        domainId: "b",
        dnsServerId: "srv1",
        origin: "exemple.fr",
      })
    ).rejects.toThrow()
  })
})

describe("setDnsManagementManual", () => {
  it("setDnsManagementManual pose dnsManagement Manual", async () => {
    mj.mockResolvedValue([["x:Domain/set", { updated: { dom1: {} } }, "0"]])
    await setDnsManagementManual({ domainId: "dom1" })
    const [[, args]] = mj.mock.calls[0][0] as [
      [string, Record<string, unknown>, string],
    ]
    expect((args.update as any).dom1.dnsManagement).toEqual({
      "@type": "Manual",
    })
  })

  it("throws when the update is rejected (notUpdated)", async () => {
    mj.mockResolvedValue([
      ["x:Domain/set", { notUpdated: { dom1: { type: "forbidden" } } }, "0"],
    ])
    await expect(setDnsManagementManual({ domainId: "dom1" })).rejects.toThrow()
  })
})
