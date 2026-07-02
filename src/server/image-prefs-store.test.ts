import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as store from "./image-prefs-store"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stalmail-imgprefs-"))
  process.env.STALMAIL_DATA_DIR = dir
  store.__resetCacheForTest()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.STALMAIL_DATA_DIR
})

describe("image-prefs-store", () => {
  it("compte inconnu → allowlist vide", () => {
    expect(store.getPrefs("a").allowedSenders).toEqual([])
  })

  it("ajoute un expéditeur (dédupliqué)", () => {
    store.addSender("a", "bob@x.io")
    store.addSender("a", "bob@x.io")
    expect(store.getPrefs("a").allowedSenders).toEqual(["bob@x.io"])
  })

  it("persiste après reset du cache (relit du disque)", () => {
    store.addSender("a", "bob@x.io")
    store.__resetCacheForTest()
    expect(store.getPrefs("a").allowedSenders).toEqual(["bob@x.io"])
  })

  it("écrit le fichier en 0600", () => {
    store.addSender("a", "bob@x.io")
    const mode = statSync(join(dir, "image-prefs.json")).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("retire un expéditeur", () => {
    store.addSender("a", "bob@x.io")
    store.removeSender("a", "bob@x.io")
    expect(store.getPrefs("a").allowedSenders).toEqual([])
  })

  it("plafonne l'allowlist (évince le plus ancien au-delà du cap)", () => {
    for (let i = 0; i <= store.MAX_TRUSTED_SENDERS; i++)
      store.addSender("a", `s${i}@x.io`)
    const senders = store.getPrefs("a").allowedSenders
    expect(senders).toHaveLength(store.MAX_TRUSTED_SENDERS)
    expect(senders[0]).toBe("s1@x.io") // s0 évincé (FIFO)
    expect(senders.at(-1)).toBe(`s${store.MAX_TRUSTED_SENDERS}@x.io`)
  })

  it("purge un compte sans toucher les autres", () => {
    store.addSender("a", "bob@x.io")
    store.addSender("b", "eve@y.io")
    store.deleteAllForAccount("a")
    expect(store.getPrefs("a").allowedSenders).toEqual([])
    expect(store.getPrefs("b").allowedSenders).toEqual(["eve@y.io"])
  })

  it("tolère un fichier corrompu et démarre vide", () => {
    writeFileSync(join(dir, "image-prefs.json"), "{NOT JSON", { mode: 0o600 })
    store.__resetCacheForTest()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(store.getPrefs("a").allowedSenders).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  it("ignore un record malformé (JSON valide, forme inattendue) sans lever", () => {
    writeFileSync(
      join(dir, "image-prefs.json"),
      JSON.stringify([
        { accountId: "a", allowedSenders: "oops" },
        { accountId: "b", allowedSenders: ["ok@x.io"] },
      ]),
      { mode: 0o600 }
    )
    store.__resetCacheForTest()
    expect(store.getPrefs("a").allowedSenders).toEqual([])
    expect(store.getPrefs("b").allowedSenders).toEqual(["ok@x.io"])
  })

  it("ignore un record dont allowedSenders contient des non-strings", () => {
    writeFileSync(
      join(dir, "image-prefs.json"),
      JSON.stringify([
        { accountId: "a", allowedSenders: [42, "ok@x.io"] },
        { accountId: "b", allowedSenders: ["ok@x.io"] },
      ]),
      { mode: 0o600 }
    )
    store.__resetCacheForTest()
    expect(store.getPrefs("a").allowedSenders).toEqual([])
    expect(store.getPrefs("b").allowedSenders).toEqual(["ok@x.io"])
  })
})
