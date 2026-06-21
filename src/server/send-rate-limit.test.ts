import { afterEach, describe, expect, it } from "vitest"
import {
  isSendRateLimited,
  recordSend,
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
})
