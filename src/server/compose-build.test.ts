import { describe, expect, it } from "vitest"
import { parseAddressList, isCleanHeaderValue } from "./compose-build"

describe("parseAddressList", () => {
  it("parse une adresse simple", () => {
    expect(parseAddressList("a@b.fr")).toEqual({
      valid: [{ name: "", email: "a@b.fr" }],
      invalid: [],
    })
  })

  it('parse "Nom <email>" séparés par des virgules', () => {
    expect(parseAddressList("Marie L <marie@x.fr>, paul@y.fr")).toEqual({
      valid: [
        { name: "Marie L", email: "marie@x.fr" },
        { name: "", email: "paul@y.fr" },
      ],
      invalid: [],
    })
  })

  it("sépare les adresses valides des invalides", () => {
    expect(parseAddressList("ok@x.fr, pas-une-adresse")).toEqual({
      valid: [{ name: "", email: "ok@x.fr" }],
      invalid: ["pas-une-adresse"],
    })
  })

  it("ignore les segments vides et espaces", () => {
    expect(parseAddressList("  a@b.fr , , ")).toEqual({
      valid: [{ name: "", email: "a@b.fr" }],
      invalid: [],
    })
  })

  it("rejette un display-name contenant un CR/LF comme invalide (B3)", () => {
    const out = parseAddressList("Evil\r\nBcc: x <a@b.fr>")
    expect(out.valid).toEqual([])
    expect(out.invalid).toHaveLength(1)
  })

  it("rejette une adresse malformée à doubles chevrons (R-B)", () => {
    const out = parseAddressList("X <a@b.fr> <c@d.fr>")
    expect(out.valid).toEqual([])
    expect(out.invalid).toEqual(["X <a@b.fr> <c@d.fr>"])
  })
})

describe("isCleanHeaderValue", () => {
  it("accepte une chaîne sans caractère de contrôle", () => {
    expect(isCleanHeaderValue("Objet normal")).toBe(true)
  })
  it("rejette CR, LF, NUL", () => {
    expect(isCleanHeaderValue("a\r\nb")).toBe(false)
    expect(isCleanHeaderValue("a\x00b")).toBe(false)
  })
})
