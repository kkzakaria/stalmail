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
  // Sans tâche à purger : query+get (vide) → Domain/set Manual → Domain/set Automatic.
  const mockNoStaleThenToggle = () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: [] }, "0"],
      ["x:Task/get", { list: [] }, "1"],
    ])
    mj.mockResolvedValueOnce([["x:Domain/set", { updated: { b: null } }, "0"]]) // Manual
    mj.mockResolvedValueOnce([["x:Domain/set", { updated: { b: null } }, "0"]]) // Automatic
  }

  it("toggles Manual→Automatic with the dns server id (no stale task)", async () => {
    mockNoStaleThenToggle()
    await setDnsManagementAutomatic({
      domainId: "b",
      dnsServerId: "srv1",
      origin: "exemple.fr",
    })

    // 3 appels : Task query+get, Domain/set Manual, Domain/set Automatic (pas de destroy).
    expect(mj).toHaveBeenCalledTimes(3)
    const manual = mj.mock.calls[1][0][0][1] as {
      update: Record<string, unknown>
    }
    expect(manual.update).toEqual({
      b: { dnsManagement: { "@type": "Manual" } },
    })
    // publishRecords est volontairement absent : Stalwart applique son défaut.
    const auto = mj.mock.calls[2][0][0][1] as {
      update: Record<string, unknown>
    }
    expect(auto.update).toEqual({
      b: {
        dnsManagement: {
          "@type": "Automatic",
          dnsServerId: "srv1",
          origin: "exemple.fr",
        },
      },
    })
  })

  it("purges a lingering Failed DnsManagement task before re-publishing", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1", "t2"] }, "0"],
      [
        "x:Task/get",
        {
          list: [
            { "@type": "AcmeRenewal", id: "t2" },
            {
              "@type": "DnsManagement",
              id: "t1",
              status: { "@type": "Failed" },
            },
          ],
        },
        "1",
      ],
    ])
    mj.mockResolvedValueOnce([["x:Task/set", { destroyed: ["t1"] }, "0"]]) // destroy
    mj.mockResolvedValueOnce([["x:Domain/set", { updated: { b: null } }, "0"]]) // Manual
    mj.mockResolvedValueOnce([["x:Domain/set", { updated: { b: null } }, "0"]]) // Automatic
    await setDnsManagementAutomatic({
      domainId: "b",
      dnsServerId: "srv1",
      origin: "exemple.fr",
    })

    expect(mj).toHaveBeenCalledTimes(4)
    // Seule la tâche DnsManagement est détruite, pas l'AcmeRenewal.
    const destroy = mj.mock.calls[1][0][0][1] as { destroy: string[] }
    expect(destroy.destroy).toEqual(["t1"])
    // Après purge, la transition Manual → Automatic est bien émise (payloads).
    const manual = mj.mock.calls[2][0][0][1] as {
      update: Record<string, unknown>
    }
    expect(manual.update).toEqual({
      b: { dnsManagement: { "@type": "Manual" } },
    })
    const auto = mj.mock.calls[3][0][0][1] as {
      update: Record<string, unknown>
    }
    expect(auto.update).toEqual({
      b: {
        dnsManagement: {
          "@type": "Automatic",
          dnsServerId: "srv1",
          origin: "exemple.fr",
        },
      },
    })
  })

  it("ne purge PAS une tâche DnsManagement active (Pending)", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1"] }, "0"],
      [
        "x:Task/get",
        {
          list: [
            {
              "@type": "DnsManagement",
              id: "t1",
              status: { "@type": "Pending" },
            },
          ],
        },
        "1",
      ],
    ])
    mj.mockResolvedValueOnce([["x:Domain/set", { updated: { b: null } }, "0"]]) // Manual
    mj.mockResolvedValueOnce([["x:Domain/set", { updated: { b: null } }, "0"]]) // Automatic
    await setDnsManagementAutomatic({
      domainId: "b",
      dnsServerId: "srv1",
      origin: "exemple.fr",
    })
    // 3 appels : pas de x:Task/set destroy (la tâche Pending n'est pas purgée).
    expect(mj).toHaveBeenCalledTimes(3)
  })

  it("throws when the transient Manual update is rejected", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: [] }, "0"],
      ["x:Task/get", { list: [] }, "1"],
    ])
    mj.mockResolvedValueOnce([
      ["x:Domain/set", { notUpdated: { b: { type: "forbidden" } } }, "0"],
    ]) // Manual rejeté
    await expect(
      setDnsManagementAutomatic({
        domainId: "b",
        dnsServerId: "srv1",
        origin: "exemple.fr",
      })
    ).rejects.toThrow()
  })

  it("throws when the Automatic update is rejected", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: [] }, "0"],
      ["x:Task/get", { list: [] }, "1"],
    ])
    mj.mockResolvedValueOnce([["x:Domain/set", { updated: { b: null } }, "0"]]) // Manual
    mj.mockResolvedValueOnce([
      ["x:Domain/set", { notUpdated: { b: { type: "forbidden" } } }, "0"],
    ]) // Automatic rejeté
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
