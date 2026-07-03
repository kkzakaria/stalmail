import { describe, it, expect } from "vitest"
import {
  normalizeSender,
  senderDomain,
  resolveImageDecision,
  applyImagePrefs,
} from "./image-prefs"
import type { AppThreadDetail } from "./mail-types"

describe("normalizeSender", () => {
  it("trim + lowercase", () => {
    expect(normalizeSender("  Bob@X.IO ")).toBe("bob@x.io")
  })
})

describe("resolveImageDecision", () => {
  const from = [{ name: "Bob", email: "Bob@x.io" }]

  it("sender de confiance → sender-allowed (précédence)", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: ["bob@x.io"], localDomain: "" },
        { from, imageDecision: "blocked", authVerdict: "pass" }
      )
    ).toBe("sender-allowed")
  })

  it("keyword posé mais expéditeur non listé → message-allowed", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: [], localDomain: "" },
        { from, imageDecision: "message-allowed" }
      )
    ).toBe("message-allowed")
  })

  it("rien → blocked", () => {
    expect(
      resolveImageDecision({ allowedSenders: [], localDomain: "" }, { from })
    ).toBe("blocked")
  })

  it("from vide → jamais sender-allowed, retombe sur le niveau message", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: [""], localDomain: "" },
        { from: [], imageDecision: "blocked" }
      )
    ).toBe("blocked")
  })
})

describe("senderDomain", () => {
  it("extrait le domaine, lowercase/trim", () => {
    expect(senderDomain(" Bob@X.IO ")).toBe("x.io")
  })
  it("sans @ → chaîne vide", () => {
    expect(senderDomain("pas-une-adresse")).toBe("")
    expect(senderDomain("")).toBe("")
  })
  it("@ final → chaîne vide", () => {
    expect(senderDomain("bob@")).toBe("")
  })
})

describe("resolveImageDecision — gating DMARC (#126)", () => {
  const from = [{ name: "Bob", email: "bob@x.io" }]
  const allowed = (localDomain: string) => ({
    allowedSenders: ["bob@x.io"],
    localDomain,
  })

  it("allowlisté + pass → sender-allowed", () => {
    expect(
      resolveImageDecision(allowed(""), { from, authVerdict: "pass" })
    ).toBe("sender-allowed")
  })

  it("allowlisté + fail → PAS d'upgrade (retombe sur le niveau message)", () => {
    expect(
      resolveImageDecision(allowed("getstalmail.com"), {
        from,
        authVerdict: "fail",
      })
    ).toBe("blocked")
    expect(
      resolveImageDecision(allowed("getstalmail.com"), {
        from,
        imageDecision: "message-allowed",
        authVerdict: "fail",
      })
    ).toBe("message-allowed") // le keyword par-message reste souverain
  })

  it("allowlisté + none + même domaine → sender-allowed (exemption locale)", () => {
    expect(
      resolveImageDecision(allowed("x.io"), { from, authVerdict: "none" })
    ).toBe("sender-allowed")
  })

  it("allowlisté + none + domaine externe → PAS d'upgrade", () => {
    expect(
      resolveImageDecision(allowed("getstalmail.com"), {
        from,
        authVerdict: "none",
      })
    ).toBe("blocked")
  })

  it("anti-fail-open : domaines vides ne s'égalisent jamais", () => {
    // localDomain indérivable ("") + From malformé (domaine "") → jamais d'upgrade
    expect(
      resolveImageDecision(
        { allowedSenders: ["bad"], localDomain: "" },
        { from: [{ name: "", email: "bad" }], authVerdict: "none" }
      )
    ).toBe("blocked")
  })

  it("authVerdict absent ⇒ traité comme none (exemption locale seule)", () => {
    expect(resolveImageDecision(allowed("x.io"), { from })).toBe(
      "sender-allowed"
    )
    expect(resolveImageDecision(allowed("autre.tld"), { from })).toBe("blocked")
  })

  it("non-allowlisté → jamais d'upgrade, quel que soit le verdict", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: [], localDomain: "x.io" },
        { from, authVerdict: "pass" }
      )
    ).toBe("blocked")
  })
})

describe("applyImagePrefs", () => {
  it("upgrade chaque message dont l'expéditeur est de confiance", () => {
    const detail: AppThreadDetail = {
      threadId: "t1",
      subject: "s",
      emailIds: ["e1", "e2"],
      starred: false,
      unread: false,
      messages: [
        {
          id: "e1",
          messageId: null,
          from: [{ name: "", email: "bob@x.io" }],
          to: [],
          cc: [],
          subject: "s",
          receivedAt: "2026-06-10T00:00:00Z",
          unread: false,
          hasAttachment: false,
          textBody: null,
          htmlBody: null,
          attachments: [],
          imageDecision: "blocked",
          authVerdict: "pass",
        },
        {
          id: "e2",
          messageId: null,
          from: [{ name: "", email: "eve@y.io" }],
          to: [],
          cc: [],
          subject: "s",
          receivedAt: "2026-06-10T00:00:00Z",
          unread: false,
          hasAttachment: false,
          textBody: null,
          htmlBody: null,
          attachments: [],
          imageDecision: "message-allowed",
        },
      ],
    }
    const out = applyImagePrefs(detail, {
      allowedSenders: ["bob@x.io"],
      localDomain: "",
    })
    expect(out.messages[0].imageDecision).toBe("sender-allowed")
    expect(out.messages[1].imageDecision).toBe("message-allowed")
  })
})
