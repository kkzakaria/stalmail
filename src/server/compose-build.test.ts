import { describe, expect, it } from "vitest"
import {
  parseAddressList,
  isCleanHeaderValue,
  buildReplyContext,
  buildForwardContext,
  pickSendIdentity,
  buildSendMethodCalls,
  parseSendResult,
} from "./compose-build"
import type { AppThreadDetail, AppMessage } from "./mail-types"
import type { JmapMethodResponse } from "./jmap"
import type { SendBody } from "./compose-build"

const msg = (over: Partial<AppMessage> = {}): AppMessage => ({
  id: "m1",
  messageId: null,
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

describe("buildForwardContext", () => {
  const labels = {
    forwarded: "Message transféré",
    from: "De",
    date: "Date",
    subject: "Objet",
    to: "À",
    cc: "Cc",
  }

  it("génère l'en-tête de transfert complet (Fwd:, De, Date, Objet, À, Cc)", () => {
    const ctx = buildForwardContext(msg(), "Sujet", labels, "fr-FR")
    expect(ctx.subject).toBe("Fwd: Sujet")
    expect(ctx.quotedHtml).toContain("Message transféré")
    expect(ctx.quotedHtml).toContain("De : Alice &lt;alice@x.fr&gt;")
    expect(ctx.quotedHtml).toContain("Objet : Sujet")
    expect(ctx.quotedHtml).toContain("À : Moi &lt;me@x.fr&gt;")
    expect(ctx.quotedHtml).toContain("Cc : Bob &lt;bob@x.fr&gt;")
    expect(ctx.quotedHtml).toContain("2026") // date absolue localisée
    expect(ctx.quotedHtml).toContain("<blockquote>")
    expect(ctx.quotedHtml).toContain("corps")
  })

  it("omet la ligne Cc quand l'original n'en a pas", () => {
    const ctx = buildForwardContext(msg({ cc: [] }), "Sujet", labels, "fr-FR")
    expect(ctx.quotedHtml).not.toContain("Cc :")
  })

  it("ne double pas le préfixe Fwd: déjà présent", () => {
    const ctx = buildForwardContext(msg(), "Fwd: Sujet", labels, "fr-FR")
    expect(ctx.subject).toBe("Fwd: Sujet")
  })

  it("échappe le HTML hostile des champs du message (B1)", () => {
    const evil = msg({
      from: [{ name: '<img src=x onerror="alert(1)">', email: "e@x.fr" }],
      subject: "</p><script>x()</script>",
    })
    const ctx = buildForwardContext(evil, "Sujet", labels, "fr-FR")
    // Le nom devient du texte inerte : DOMPurify conserve `&lt;`/`&gt;` échappés (empêche
    // toute balise réelle) mais désérialise `&quot;` en guillemet littéral dans un nœud
    // texte (conforme HTML : les guillemets n'ont pas besoin d'échappement hors attribut).
    // Le mot "onerror" reste donc visible en texte affiché, sans jamais devenir un
    // attribut DOM actif — la garantie de sécurité est l'absence de balise, pas le mot.
    expect(ctx.quotedHtml).not.toContain("<img")
    expect(ctx.quotedHtml).toContain("&lt;img")
    expect(ctx.quotedHtml).not.toContain("<script")
  })

  it("sanitise le corps HTML original (B1)", () => {
    const evil = msg({ htmlBody: '<p>ok</p><img src=x onerror="alert(1)">' })
    const ctx = buildForwardContext(evil, "Sujet", labels, "fr-FR")
    expect(ctx.quotedHtml).not.toContain("onerror")
    expect(ctx.quotedHtml).toContain("ok")
  })

  it("repli textBody échappé quand pas de corps HTML", () => {
    const ctx = buildForwardContext(
      msg({ htmlBody: "", textBody: "ligne1\nligne2 <tag>" }),
      "Sujet",
      labels,
      "fr-FR"
    )
    expect(ctx.quotedHtml).toContain("ligne1<br>ligne2 &lt;tag&gt;")
  })

  it("transmet les pièces jointes de l'original telles quelles", () => {
    const atts = [
      { blobId: "b1", name: "rapport.pdf", type: "application/pdf", size: 5 },
    ]
    const ctx = buildForwardContext(
      msg({ attachments: atts }),
      "Sujet",
      labels,
      "fr-FR"
    )
    expect(ctx.attachments).toEqual(atts)
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

const identityGet = (list: unknown[]): JmapMethodResponse[] => [
  ["Identity/get", { list }, "0"],
]

describe("pickSendIdentity", () => {
  it("retient l'identité dont l'email correspond au compte", () => {
    const r = identityGet([
      { id: "i1", name: "Pro", email: "other@x.fr" },
      { id: "i2", name: "Moi", email: "me@x.fr" },
    ])
    expect(pickSendIdentity(r, "me@x.fr")).toEqual({
      id: "i2",
      name: "Moi",
      email: "me@x.fr",
    })
  })

  it("retombe sur la première identité si aucune ne correspond", () => {
    const r = identityGet([{ id: "i1", name: "A", email: "a@x.fr" }])
    expect(pickSendIdentity(r, "me@x.fr")).toEqual({
      id: "i1",
      name: "A",
      email: "a@x.fr",
    })
  })

  it("renvoie null si aucune identité", () => {
    expect(pickSendIdentity(identityGet([]), "me@x.fr")).toBeNull()
  })
})

const body = (over: Partial<SendBody> = {}): SendBody => ({
  to: [{ name: "Alice", email: "alice@x.fr" }],
  cc: [],
  bcc: [{ name: "", email: "secret@x.fr" }],
  subject: "Bonjour",
  html: "<p>Salut</p>",
  text: "Salut",
  references: [],
  attachments: [],
  ...over,
})

const ctx = {
  draftsId: "mb-drafts",
  sentId: "mb-sent",
  identity: { id: "i1", name: "Moi", email: "me@x.fr" },
}

describe("buildSendMethodCalls", () => {
  const calls = buildSendMethodCalls("acc1", body(), ctx)
  const emailSet = calls.find((c) => c[0] === "Email/set")!
  const submissionSet = calls.find((c) => c[0] === "EmailSubmission/set")!
  const created = emailSet[1].create as Record<string, Record<string, unknown>>
  const draft = Object.values(created)[0]

  it("crée l'Email dans Drafts avec keywords $draft/$seen", () => {
    expect(draft.mailboxIds).toEqual({ "mb-drafts": true })
    expect(draft.keywords).toEqual({ $draft: true, $seen: true })
  })

  it("from = identité serveur (R1)", () => {
    expect(draft.from).toEqual([{ name: "Moi", email: "me@x.fr" }])
  })

  it("bcc absent des propriétés de l'Email stocké (R2)", () => {
    expect(draft.bcc).toBeUndefined()
    expect(JSON.stringify(draft)).not.toContain("secret@x.fr")
  })

  it("EmailSubmission référence l'Email créé et inclut bcc dans rcptTo (R2)", () => {
    const subCreate = Object.values(
      submissionSet[1].create as Record<string, Record<string, unknown>>
    )[0]
    expect(subCreate.identityId).toBe("i1")
    const env = subCreate.envelope as { rcptTo: { email: string }[] }
    expect(env.rcptTo.map((r) => r.email)).toContain("secret@x.fr")
  })

  it("onSuccessUpdateEmail : retire $draft, déplace Drafts→Sent", () => {
    const upd = submissionSet[1].onSuccessUpdateEmail as Record<
      string,
      Record<string, unknown>
    >
    const patch = Object.values(upd)[0]
    expect(patch["keywords/$draft"]).toBeNull()
    expect(patch["mailboxIds/mb-drafts"]).toBeNull()
    expect(patch["mailboxIds/mb-sent"]).toBe(true)
  })

  it("threading : Message-ID via header:*:asMessageIds (B3)", () => {
    const withRef = buildSendMethodCalls(
      "acc1",
      body({ inReplyTo: "<mid@x.fr>", references: ["<mid@x.fr>"] }),
      ctx
    )
    const d = Object.values(
      withRef.find((c) => c[0] === "Email/set")![1].create as Record<
        string,
        Record<string, unknown>
      >
    )[0]
    expect(d["header:In-Reply-To:asMessageIds"]).toEqual(["<mid@x.fr>"])
    expect(d["header:References:asMessageIds"]).toEqual(["<mid@x.fr>"])
  })

  it("ajoute attachments[] (disposition attachment, sans size) quand non vide", () => {
    const withAtt = body({
      attachments: [
        { blobId: "b1", name: "f.pdf", type: "application/pdf", size: 10 },
      ],
    })
    const withAttCalls = buildSendMethodCalls("acc", withAtt, ctx)
    const d = (
      withAttCalls.find((c) => c[0] === "Email/set")![1] as {
        create: Record<string, Record<string, unknown>>
      }
    ).create.draft
    expect(d.attachments).toEqual([
      {
        blobId: "b1",
        type: "application/pdf",
        name: "f.pdf",
        disposition: "attachment",
      },
    ])
  })

  it("pas de clé attachments quand la liste est vide", () => {
    expect(draft.attachments).toBeUndefined()
  })
})

describe("parseSendResult", () => {
  it("succès : renvoie l'id de l'email soumis", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", { created: { draft: { id: "e-9" } } }, "0"],
      ["EmailSubmission/set", { created: { sub: { id: "s-1" } } }, "1"],
    ]
    expect(parseSendResult(r)).toEqual({ ok: true, emailId: "e-9" })
  })

  it("notCreated sur EmailSubmission → code mappé (sans détail JMAP, R6)", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", { created: { draft: { id: "e-9" } } }, "0"],
      [
        "EmailSubmission/set",
        {
          notCreated: {
            sub: { type: "forbiddenFrom", description: "relay info interne" },
          },
        },
        "1",
      ],
    ]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "rejected" })
  })

  it("notCreated overQuota → code quota", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", { created: { draft: { id: "e-9" } } }, "0"],
      [
        "EmailSubmission/set",
        { notCreated: { sub: { type: "overQuota" } } },
        "1",
      ],
    ]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "quota" })
  })

  it("échec Email/set → code failed", () => {
    const r: JmapMethodResponse[] = [
      [
        "Email/set",
        { notCreated: { draft: { type: "invalidProperties" } } },
        "0",
      ],
    ]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "failed" })
  })

  it("erreur JMAP niveau méthode (['error',…]) → failed, jamais faux succès (R-E)", () => {
    const r: JmapMethodResponse[] = [["error", { type: "unknownMethod" }, "1"]]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "failed" })
  })

  it("notCreated forbiddenToSend → rejected", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", { created: { draft: { id: "e-9" } } }, "0"],
      [
        "EmailSubmission/set",
        { notCreated: { sub: { type: "forbiddenToSend" } } },
        "1",
      ],
    ]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "rejected" })
  })

  it("EmailSubmission created vide → failed (pas de faux succès)", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", { created: { draft: { id: "e-9" } } }, "0"],
      ["EmailSubmission/set", { created: {} }, "1"],
    ]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "failed" })
  })

  it("Email/set sans created (réponse vide) → failed, sans throw", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", {}, "0"],
      ["EmailSubmission/set", { created: { sub: { id: "s-1" } } }, "1"],
    ]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "failed" })
  })
})
