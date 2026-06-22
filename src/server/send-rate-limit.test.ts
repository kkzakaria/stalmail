import { afterEach, describe, expect, it } from "vitest"
import {
  isSendRateLimited,
  recordSend,
  consumeSendSlot,
  __resetForTest,
} from "./send-rate-limit"

afterEach(() => __resetForTest())

describe("send-rate-limit", () => {
  it("autorise sous le seuil", () => {
    const now = 1_000_000
    for (let i = 0; i < 5; i++) recordSend("me@x.fr", now)
    expect(isSendRateLimited("me@x.fr", now)).toBe(false)
  })

  it("bloque au-delà du seuil (30/heure)", () => {
    const now = 1_000_000
    for (let i = 0; i < 30; i++) recordSend("me@x.fr", now)
    expect(isSendRateLimited("me@x.fr", now)).toBe(true)
  })

  it("compte par compte, insensible à la casse", () => {
    const now = 1_000_000
    for (let i = 0; i < 30; i++) recordSend("ME@x.fr", now)
    expect(isSendRateLimited("me@x.fr", now)).toBe(true)
    expect(isSendRateLimited("autre@x.fr", now)).toBe(false)
  })

  it("oublie les envois hors fenêtre", () => {
    const now = 1_000_000
    for (let i = 0; i < 30; i++) recordSend("me@x.fr", now)
    expect(isSendRateLimited("me@x.fr", now + 61 * 60 * 1000)).toBe(false)
  })

  it("rejette un account vide ou blanc (P2 : pas de pool global)", () => {
    expect(() => isSendRateLimited("", 1_000_000)).toThrow()
    expect(() => isSendRateLimited("   ", 1_000_000)).toThrow()
    expect(() => recordSend("", 1_000_000)).toThrow()
    expect(() => recordSend("   ", 1_000_000)).toThrow()
  })

  it("consumeSendSlot : consomme et autorise sous le seuil", () => {
    const now = 1_000_000
    for (let i = 0; i < 30; i++)
      expect(consumeSendSlot("me@x.fr", now)).toBe(true)
    // 31e tentative : plafond atteint → refusée (créneau non consommé).
    expect(consumeSendSlot("me@x.fr", now)).toBe(false)
  })

  it("consumeSendSlot : atomique à la frontière — un seul des deux passe au plafond -1 (#6/#7)", () => {
    const now = 1_000_000
    for (let i = 0; i < 29; i++) recordSend("me@x.fr", now) // 29/30 utilisés
    // Deux consommations « concurrentes » au seuil : la 1re prend le dernier créneau, la 2nde est refusée.
    expect(consumeSendSlot("me@x.fr", now)).toBe(true) // 30e
    expect(consumeSendSlot("me@x.fr", now)).toBe(false) // 31e bloquée — pas de dépassement
  })

  it("consumeSendSlot : rejette un account vide", () => {
    expect(() => consumeSendSlot("", 1_000_000)).toThrow()
  })

  it("normalise la clé (trim + casse) : les espaces de bord partagent le bucket", () => {
    const now = 1_000_000
    for (let i = 0; i < 30; i++) recordSend(" me@x.fr ", now)
    // Même compte sans espaces / en majuscules → même bucket → plafond atteint.
    expect(isSendRateLimited("me@x.fr", now)).toBe(true)
    expect(consumeSendSlot("ME@X.FR", now)).toBe(false)
  })
})
