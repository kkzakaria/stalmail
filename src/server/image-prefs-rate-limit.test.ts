import { describe, it, expect, beforeEach } from "vitest"
import {
  consumeMutationSlot,
  MAX_PREFS_MUTATIONS,
  __resetForTest,
} from "./image-prefs-rate-limit"

beforeEach(() => __resetForTest())

describe("image-prefs-rate-limit", () => {
  it("consomme jusqu'au cap puis refuse", () => {
    for (let i = 0; i < MAX_PREFS_MUTATIONS; i++) {
      expect(consumeMutationSlot("acc", 1000 + i)).toBe(true)
    }
    expect(consumeMutationSlot("acc", 2000)).toBe(false)
  })

  it("fenêtre glissante : un créneau expiré se libère", () => {
    const t0 = 1000
    for (let i = 0; i < MAX_PREFS_MUTATIONS; i++) {
      consumeMutationSlot("acc", t0 + i)
    }
    expect(consumeMutationSlot("acc", t0 + 100)).toBe(false)
    // t0 (le plus ancien) sort de la fenêtre de 60 min
    expect(consumeMutationSlot("acc", t0 + 60 * 60 * 1000 + 1)).toBe(true)
  })

  it("comptes indépendants", () => {
    for (let i = 0; i < MAX_PREFS_MUTATIONS; i++) consumeMutationSlot("a", 1000)
    expect(consumeMutationSlot("a", 1000)).toBe(false)
    expect(consumeMutationSlot("b", 1000)).toBe(true)
  })

  it("refus NE consomme PAS de créneau supplémentaire", () => {
    // 60 créneaux aux timestamps 1000..1059, puis un refus à 2000.
    for (let i = 0; i < MAX_PREFS_MUTATIONS; i++)
      consumeMutationSlot("acc", 1000 + i)
    expect(consumeMutationSlot("acc", 2000)).toBe(false) // refusé
    // À 1000+WINDOW+1, seul le créneau t=1000 a expiré → 59 restants → accepté.
    // Si le refus à 2000 avait consommé un créneau, il en resterait 60 → refusé.
    expect(consumeMutationSlot("acc", 1000 + 60 * 60 * 1000 + 1)).toBe(true)
  })

  it("compte vide → lève (anti pool global partagé)", () => {
    expect(() => consumeMutationSlot("  ", 1000)).toThrow()
  })
})
