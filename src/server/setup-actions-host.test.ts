// src/server/setup-actions-host.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

import { hostAddressStatusHandler } from "./setup-actions"

vi.mock("./stalwart-domain", () => ({
  getPrimaryDomain: vi.fn(async () => ({ id: "d1", name: "exemple.fr" })),
}))
vi.mock("./dns-resolve", () => ({
  resolveRecordStatus: vi.fn(async () => "verified"),
}))

beforeEach(() => vi.clearAllMocks())

describe("hostAddressStatusHandler", () => {
  it("construit les A attendus et renvoie leur statut", async () => {
    const res = await hostAddressStatusHandler({
      data: { ipv4: "203.0.113.4" },
    })
    expect(res.records).toContainEqual({
      name: "exemple.fr.",
      type: "A",
      value: "203.0.113.4",
      status: "verified",
    })
  })

  it("ignore une IP syntaxiquement invalide → aucun record", async () => {
    const res = await hostAddressStatusHandler({
      data: { ipv4: "not-an-ip" },
    })
    expect(res.records).toEqual([])
  })
})
