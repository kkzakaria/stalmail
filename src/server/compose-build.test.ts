import { describe, expect, it } from "vitest"
import {
  parseAddressList,
  isCleanHeaderValue,
  buildReplyContext,
} from "./compose-build"
import type { AppThreadDetail, AppMessage } from "./mail-types"

const msg = (over: Partial<AppMessage> = {}): AppMessage => ({
  id: "m1",
  from: [{ name: "Alice", email: "alice@x.fr" }],
  to: [{ name: "Moi", email: "me@x.fr" }],
  cc: [{ name: "Bob", email: "bob@x.fr" }],
  subject: "Sujet",
  receivedAt: "2026-06-10T00:00:00Z",
  unread: false,
  hasAttachment: false,
  textBody: "corps",
  htmlBody: "<p>corps</p>",
  attachments: [],
  ...over,
})

const detail = (messages: AppMessage[]): AppThreadDetail => ({
  threadId: "t1",
  subject: messages[messages.length - 1].subject,
  messages,
  emailIds: messages.map((m) => m.id),
  starred: false,
  unread: false,
})

describe("buildReplyContext", () => {
  it("reply : destinataire = expéditeur, objet préfixé Re:, citation sanitisée", () => {
    const ctx = buildReplyContext(detail([msg()]), "reply", "me@x.fr")
    expect(ctx.to).toEqual([{ name: "Alice", email: "alice@x.fr" }])
    expect(ctx.cc).toEqual([])
    expect(ctx.subject).toBe("Re: Sujet")
    expect(ctx.quotedHtml).toContain("corps")
  })

  it("ne double pas le préfixe Re: déjà présent", () => {
    const ctx = buildReplyContext(
      detail([msg({ subject: "Re: Sujet" })]),
      "reply",
      "me@x.fr"
    )
    expect(ctx.subject).toBe("Re: Sujet")
  })

  it("replyAll : cc = to+cc d'origine moins soi-même", () => {
    const ctx = buildReplyContext(detail([msg()]), "replyAll", "me@x.fr")
    expect(ctx.to).toEqual([{ name: "Alice", email: "alice@x.fr" }])
    expect(ctx.cc).toEqual([{ name: "Bob", email: "bob@x.fr" }])
  })

  it("forward : to et cc vides, objet préfixé Fwd:", () => {
    const ctx = buildReplyContext(detail([msg()]), "forward", "me@x.fr")
    expect(ctx.to).toEqual([])
    expect(ctx.cc).toEqual([])
    expect(ctx.subject).toBe("Fwd: Sujet")
    expect(ctx.quotedHtml).toContain("corps")
  })

  it("sans lastMessageId : inReplyTo undefined, references vide", () => {
    const ctx = buildReplyContext(detail([msg()]), "reply", "me@x.fr")
    expect(ctx.inReplyTo).toBeUndefined()
    expect(ctx.references).toEqual([])
  })

  it("reply : inReplyTo/references depuis lastMessageId fourni", () => {
    const ctx = buildReplyContext(
      detail([msg()]),
      "reply",
      "me@x.fr",
      "<mid@x.fr>"
    )
    expect(ctx.inReplyTo).toBe("<mid@x.fr>")
    expect(ctx.references).toEqual(["<mid@x.fr>"])
  })

  it("citation : neutralise le HTML hostile du message d'origine (B1)", () => {
    const evil = msg({ htmlBody: '<p>ok</p><img src=x onerror="alert(1)">' })
    const ctx = buildReplyContext(detail([evil]), "reply", "me@x.fr")
    expect(ctx.quotedHtml).not.toContain("onerror")
    expect(ctx.quotedHtml).not.toContain("<img")
    expect(ctx.quotedHtml).toContain("ok")
  })

  it("jette si le fil est vide", () => {
    expect(() =>
      buildReplyContext(
        { ...detail([msg()]), messages: [], emailIds: [] },
        "reply",
        "me@x.fr"
      )
    ).toThrow()
  })

  it("ne double pas le préfixe Fwd: déjà présent", () => {
    const ctx = buildReplyContext(
      detail([msg({ subject: "Fwd: Sujet" })]),
      "forward",
      "me@x.fr"
    )
    expect(ctx.subject).toBe("Fwd: Sujet")
  })
})

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

  it("rejette un email contenant un caractère de contrôle NUL (B3)", () => {
    const out = parseAddressList("a\x00b@x.fr")
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
