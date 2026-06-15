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
  })
  it("conserve https et mailto", () => {
    expect(sanitizeLinks('<a href="mailto:a@b.c">m</a>')).toContain(
      "mailto:a@b.c"
    )
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
