import { describe, it, expect } from "vitest"
import {
  normalizeSender,
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
        { allowedSenders: ["bob@x.io"] },
        { from, imageDecision: "blocked" }
      )
    ).toBe("sender-allowed")
  })

  it("keyword posé mais expéditeur non listé → message-allowed", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: [] },
        { from, imageDecision: "message-allowed" }
      )
    ).toBe("message-allowed")
  })

  it("rien → blocked", () => {
    expect(resolveImageDecision({ allowedSenders: [] }, { from })).toBe(
      "blocked"
    )
  })

  it("from vide → jamais sender-allowed, retombe sur le niveau message", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: [""] },
        { from: [], imageDecision: "blocked" }
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
    const out = applyImagePrefs(detail, { allowedSenders: ["bob@x.io"] })
    expect(out.messages[0].imageDecision).toBe("sender-allowed")
    expect(out.messages[1].imageDecision).toBe("message-allowed")
  })
})
