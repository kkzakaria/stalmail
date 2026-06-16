import { describe, expect, it } from "vitest"
import {
  pickBody,
  blockRemoteImages,
  sanitizeLinks,
  buildFrameDoc,
  hasRemoteImages,
} from "./email-body"

describe("pickBody", () => {
  it("préfère le texte quand présent", () => {
    expect(pickBody({ textBody: "salut", htmlBody: "<b>hi</b>" })).toEqual({
      kind: "text",
      content: "salut",
    })
  })
  it("repli sur html si texte vide/espaces", () => {
    expect(pickBody({ textBody: "   ", htmlBody: "<b>hi</b>" })).toEqual({
      kind: "html",
      content: "<b>hi</b>",
    })
  })
  it("texte vide si les deux sont vides", () => {
    expect(pickBody({ textBody: null, htmlBody: null })).toEqual({
      kind: "text",
      content: "",
    })
  })
})

describe("blockRemoteImages", () => {
  it("neutralise un src http(s) distant", () => {
    expect(
      blockRemoteImages('<img src="https://tracker/x.png">')
    ).not.toContain("https://tracker")
  })
  it("neutralise un src distant SANS guillemets", () => {
    expect(blockRemoteImages("<img src=https://tracker/x.png>")).not.toContain(
      "https://tracker"
    )
  })
  it("neutralise un srcset distant", () => {
    expect(
      blockRemoteImages('<img srcset="https://t/x.png 2x">')
    ).not.toContain("https://t")
  })
  it("neutralise une url() CSS distante", () => {
    expect(
      blockRemoteImages('<div style="background:url(http://t/a.png)">')
    ).not.toContain("http://t")
  })
  it("préserve data: et cid:", () => {
    const html = '<img src="data:image/png;base64,AAA"><img src="cid:logo">'
    const out = blockRemoteImages(html)
    expect(out).toContain("data:image/png")
    expect(out).toContain("cid:logo")
  })
})

describe("sanitizeLinks", () => {
  it('ajoute rel="noopener noreferrer"', () => {
    expect(sanitizeLinks('<a href="https://x.com">x</a>')).toContain(
      'rel="noopener noreferrer"'
    )
  })
  it("neutralise javascript: / data: / vbscript:", () => {
    expect(sanitizeLinks('<a href="javascript:alert(1)">x</a>')).toContain(
      'href="#"'
    )
    expect(sanitizeLinks('<a href="vbscript:x">x</a>')).toContain('href="#"')
    expect(sanitizeLinks('<a href="data:text/plain,hello">x</a>')).toContain(
      'href="#"'
    )
  })
  it("conserve https et mailto", () => {
    expect(sanitizeLinks('<a href="mailto:a@b.c">m</a>')).toContain(
      "mailto:a@b.c"
    )
  })
  it("force target=_blank et écrase un target=_self de l'email", () => {
    const out = sanitizeLinks('<a href="https://x.com" target="_self">x</a>')
    expect(out).toContain('target="_blank"')
    expect(out).not.toContain("_self")
  })
  it("écrase un target non quoté", () => {
    const out = sanitizeLinks("<a href=https://x.com target=_top>x</a>")
    expect(out).toContain('target="_blank"')
    expect(out).not.toContain("_top")
  })
  it("ne touche pas data-rel / data-target (préfixe \\s)", () => {
    const out = sanitizeLinks(
      '<a href="https://x.com" data-target="keep">x</a>'
    )
    expect(out).toContain('data-target="keep"')
  })
})

describe("buildFrameDoc", () => {
  it("inclut la balise CSP default-src none", () => {
    const doc = buildFrameDoc("<p>x</p>", { showImages: false })
    expect(doc).toContain("default-src 'none'")
    expect(doc).toMatch(/<!doctype html>/i)
  })
  it("bloque les images si showImages=false", () => {
    expect(
      buildFrameDoc('<img src="https://t/x.png">', { showImages: false })
    ).not.toContain("https://t")
  })
  it("garde les images distantes si showImages=true", () => {
    expect(
      buildFrameDoc('<img src="https://t/x.png">', { showImages: true })
    ).toContain("https://t")
  })
  it("élargit la CSP img-src aux schémas distants quand showImages=true", () => {
    const off = buildFrameDoc("<p>x</p>", { showImages: false })
    expect(off).toContain("img-src data: cid:;")
    expect(off).not.toContain("https:")
    const on = buildFrameDoc("<p>x</p>", { showImages: true })
    expect(on).toContain("img-src data: cid: https: http:;")
  })
  it("force l'ouverture des liens dans un nouvel onglet (base target=_blank)", () => {
    const doc = buildFrameDoc('<a href="https://x.com">x</a>', {
      showImages: false,
    })
    expect(doc).toContain('<base target="_blank">')
    // notre <base> doit précéder le <body> (sinon un <base> de l'email gagnerait)
    expect(doc.indexOf('<base target="_blank">')).toBeLessThan(
      doc.indexOf("<body>")
    )
  })
  it("strippe un <base href> injecté par l'email (revue sécu F-1)", () => {
    const doc = buildFrameDoc(
      '<base href="https://evil.example/"><a href="x">x</a>',
      {
        showImages: false,
      }
    )
    expect(doc).not.toContain("evil.example")
    // un seul <base> subsiste : le nôtre (target=_blank, sans href)
    expect(doc.match(/<base\b/gi)).toHaveLength(1)
  })
})

describe("hasRemoteImages", () => {
  it("détecte un img distant", () => {
    expect(hasRemoteImages('<img src="https://t/x.png">')).toBe(true)
  })
  it("détecte un src sans guillemets et un srcset distant", () => {
    expect(hasRemoteImages("<img src=https://t/x.png>")).toBe(true)
    expect(hasRemoteImages('<img srcset="https://t/x.png 2x">')).toBe(true)
  })
  it("détecte un background= distant", () => {
    expect(hasRemoteImages('<table background="https://t/bg.png">')).toBe(true)
  })
  it("faux si seulement data:/cid:", () => {
    expect(hasRemoteImages('<img src="data:image/png;base64,AAA">')).toBe(false)
  })
})
