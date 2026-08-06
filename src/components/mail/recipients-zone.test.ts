import { describe, expect, it } from "vitest"
import { leavesZone } from "./recipients-zone"

describe("leavesZone", () => {
  const zone = document.createElement("div")
  const interne = document.createElement("input")
  zone.appendChild(interne)
  const externe = document.createElement("input")

  it("relatedTarget nul (fenêtre qui perd le focus) : on ne sort pas", () => {
    expect(leavesZone(zone, null)).toBe(false)
  })

  it("cible interne à la zone : on ne sort pas", () => {
    expect(leavesZone(zone, interne)).toBe(false)
  })

  it("la zone elle-même compte comme interne", () => {
    expect(leavesZone(zone, zone)).toBe(false)
  })

  it("cible hors zone : on sort", () => {
    expect(leavesZone(zone, externe)).toBe(true)
  })
})
