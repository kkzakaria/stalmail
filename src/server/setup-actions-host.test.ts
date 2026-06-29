import { describe, it, expect, vi, beforeEach } from "vitest"

import { hostAddressStatusHandler } from "./setup-actions"

vi.mock("./session-cookie", () => ({ assertSameOriginStrict: vi.fn() }))
vi.mock("./stalwart-domain", () => ({
  getPrimaryDomain: vi.fn(async () => ({
    id: "d1",
    name: "exemple.fr",
    dnsZoneFile: "exemple.fr. IN MX 10 mail.exemple.fr.\n",
  })),
}))
vi.mock("./dns-resolve", () => ({
  resolveRecordStatus: vi.fn(async () => "missing"),
}))

beforeEach(() => vi.clearAllMocks())

describe("hostAddressStatusHandler", () => {
  it("dérive le serveur mail (cible MX) depuis la zone, avec rôle", async () => {
    const res = await hostAddressStatusHandler({
      data: { ipv4: "203.0.113.4" },
    })
    expect(res.records).toContainEqual({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
      role: "mail",
      status: "pending",
    })
    // l'apex est aussi proposé (rôle apex)
    expect(res.records.some((r) => r.role === "apex")).toBe(true)
  })

  it("ignore une IP invalide → aucun record", async () => {
    const res = await hostAddressStatusHandler({ data: { ipv4: "not-an-ip" } })
    expect(res.records).toEqual([])
  })
})
