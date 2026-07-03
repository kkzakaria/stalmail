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

  it("pas de clause dmarc → none", () => {
    expect(parseDmarcVerdict(["srv; spf=pass; dkim=pass"])).toBe("none")
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
})
