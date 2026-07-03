import { describe, it, expect } from "vitest"
import { parseDmarcVerdict } from "./auth-results"

describe("parseDmarcVerdict", () => {
  it("dmarc=pass → pass (format Stalwart typique)", () => {
    expect(
      parseDmarcVerdict([
        "mail.getstalmail.com; dkim=pass header.d=gmail.com; spf=pass smtp.mailfrom=gmail.com; dmarc=pass header.from=gmail.com; iprev=pass",
      ])
    ).toBe("pass")
  })

  it("dmarc=fail → fail", () => {
    expect(parseDmarcVerdict(["srv; dmarc=fail header.from=x.io"])).toBe("fail")
  })

  it("dmarc=none (domaine sans politique DMARC) → fail (fail-closed)", () => {
    expect(parseDmarcVerdict(["srv; dmarc=none header.from=x.io"])).toBe("fail")
  })

  it("temperror/permerror → fail", () => {
    expect(parseDmarcVerdict(["srv; dmarc=temperror"])).toBe("fail")
    expect(parseDmarcVerdict(["srv; dmarc=permerror"])).toBe("fail")
  })

  it("insensible à la casse et aux espaces", () => {
    expect(parseDmarcVerdict(["srv; DMARC = Pass ; spf=fail"])).toBe("pass")
  })

  it("instance présente SANS clause dmarc → fail (audit F1 : ne pas ouvrir l'exemption locale)", () => {
    expect(parseDmarcVerdict(["srv; spf=pass; dkim=pass"])).toBe("fail")
  })

  it("tableau vide / null / undefined → none", () => {
    expect(parseDmarcVerdict([])).toBe("none")
    expect(parseDmarcVerdict(null)).toBe("none")
    expect(parseDmarcVerdict(undefined)).toBe("none")
  })

  it("SEULE la première instance compte (forgée en 2e position ignorée)", () => {
    expect(
      parseDmarcVerdict([
        "mail.getstalmail.com; dmarc=fail header.from=x.io",
        "evil.example; dmarc=pass header.from=x.io", // forgé, en dessous
      ])
    ).toBe("fail")
  })

  it("commentaire CFWS injectant dmarc=pass ignoré (strippé avant match)", () => {
    expect(
      parseDmarcVerdict([
        "srv; spf=pass (dmarc=pass) smtp.mailfrom=x.io; dmarc=fail header.from=x.io",
      ])
    ).toBe("fail")
  })

  it("dmarc= hors frontière de clause ignoré (valeur de propriété)", () => {
    expect(
      parseDmarcVerdict([
        "srv; spf=pass smtp.mailfrom=dmarc=pass@evil.io; dmarc=fail",
      ])
    ).toBe("fail")
  })

  it("commentaires imbriqués strippés", () => {
    expect(parseDmarcVerdict(["srv (a (b) c); dmarc=pass"])).toBe("pass")
  })

  it("quoted-string injectant '; dmarc=pass' neutralisée (revue #126)", () => {
    expect(
      parseDmarcVerdict([
        'srv; spf=pass reason="oops) ; dmarc=pass (ignore"; dmarc=fail header.from=x.io',
      ])
    ).toBe("fail")
  })

  it("structure malformée → fail (jamais none : ne pas ouvrir l'exemption locale)", () => {
    expect(parseDmarcVerdict(["srv (oops; dmarc=pass"])).toBe("fail") // parenthèse jamais refermée
    expect(parseDmarcVerdict(["srv ); dmarc=pass"])).toBe("fail") // fermante orpheline
    expect(parseDmarcVerdict(['srv; reason="oops; dmarc=pass'])).toBe("fail") // quote jamais refermée
  })

  it("quote échappée dans une quoted-string gérée", () => {
    expect(parseDmarcVerdict(['srv; reason="a\\"b"; dmarc=pass'])).toBe("pass")
  })

  it("quote DANS un commentaire = simple texte", () => {
    expect(parseDmarcVerdict(['srv (say "hi); dmarc=pass'])).toBe("pass")
  })
})
