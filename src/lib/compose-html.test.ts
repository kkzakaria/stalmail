import { describe, expect, it } from "vitest"
import { sanitizeComposeHtml, htmlToPlainText } from "./compose-html"

describe("sanitizeComposeHtml", () => {
  it("garde les éléments de l'allowlist", () => {
    const html =
      "<p>Bonjour <b>Marie</b> et <em>merci</em></p><ul><li>un</li></ul>"
    expect(sanitizeComposeHtml(html)).toBe(html)
  })

  it("retire les balises hors allowlist (script, style, div)", () => {
    expect(sanitizeComposeHtml("<div>x<script>alert(1)</script></div>")).toBe(
      "x"
    )
    expect(sanitizeComposeHtml("<style>body{}</style><p>ok</p>")).toBe(
      "<p>ok</p>"
    )
  })

  it("retire les attributs hors allowlist (onerror, style, class, id)", () => {
    expect(sanitizeComposeHtml('<img src=x onerror="alert(1)">')).toBe("")
    expect(sanitizeComposeHtml('<p style="x" class="y" id="z">t</p>')).toBe(
      "<p>t</p>"
    )
  })

  it("garde href http(s) et mailto sur a, retire le reste", () => {
    expect(sanitizeComposeHtml('<a href="https://x.fr">l</a>')).toBe(
      '<a href="https://x.fr">l</a>'
    )
    expect(sanitizeComposeHtml('<a href="mailto:a@b.fr">l</a>')).toBe(
      '<a href="mailto:a@b.fr">l</a>'
    )
  })

  it("neutralise les schémas javascript: et data:", () => {
    expect(sanitizeComposeHtml('<a href="javascript:alert(1)">l</a>')).toBe(
      "<a>l</a>"
    )
    expect(sanitizeComposeHtml('<a href="data:text/html,x">l</a>')).toBe(
      "<a>l</a>"
    )
  })

  it("retire la query d'un mailto: (anti-injection d'en-têtes)", () => {
    expect(
      sanitizeComposeHtml(
        '<a href="mailto:a@b.fr?bcc=evil@x.fr&body=spam">l</a>'
      )
    ).toBe('<a href="mailto:a@b.fr">l</a>')
  })

  it("retire la query mailto: même avec un seul paramètre (R-C)", () => {
    expect(
      sanitizeComposeHtml('<a href="mailto:a@b.fr?bcc=x@y.fr">l</a>')
    ).toBe('<a href="mailto:a@b.fr">l</a>')
  })

  it("conserve blockquote (citation reply/forward)", () => {
    const out = sanitizeComposeHtml("<blockquote><p>cité</p></blockquote>")
    expect(out).toContain("<blockquote>")
    expect(out).toContain("cité")
  })
})

describe("htmlToPlainText", () => {
  it("convertit les balises de bloc en sauts de ligne et strippe le reste", () => {
    expect(htmlToPlainText("<p>Bonjour</p><p>Merci</p>")).toBe(
      "Bonjour\n\nMerci"
    )
    expect(htmlToPlainText("ligne1<br>ligne2")).toBe("ligne1\nligne2")
  })

  it("décode les entités HTML", () => {
    expect(htmlToPlainText("<p>a &amp; b &lt; c</p>")).toBe("a & b < c")
  })

  it("ne double-décode pas les entités (&amp;lt; reste &lt;)", () => {
    expect(htmlToPlainText("<p>a &amp;lt; b</p>")).toBe("a &lt; b")
  })
})
