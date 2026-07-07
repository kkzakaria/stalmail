import { describe, expect, it, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useQuickReplyDraft } from "./use-quick-reply-draft"
import type { AppThreadDetail } from "../../server/mail-types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "fr-FR" },
  }),
}))

const detail: AppThreadDetail = {
  threadId: "t1",
  subject: "Sujet",
  messages: [
    {
      id: "m1",
      messageId: "<m1@host>",
      from: [{ name: "Alice", email: "alice@x.fr" }],
      to: [{ name: "Moi", email: "me@x.fr" }],
      cc: [],
      subject: "Sujet",
      receivedAt: "2026-06-10T00:00:00Z",
      unread: false,
      hasAttachment: true,
      textBody: "corps",
      htmlBody: "<p>corps</p>",
      attachments: [
        { blobId: "b1", name: "f.pdf", type: "application/pdf", size: 10 },
      ],
    },
  ],
  emailIds: ["m1"],
  starred: false,
  unread: false,
}

describe("useQuickReplyDraft", () => {
  it("openReply : brouillon reply pré-rempli (Re:, destinataire, threading)", () => {
    const { result } = renderHook(() => useQuickReplyDraft(detail, "me@x.fr"))
    act(() => result.current.openReply("reply"))
    expect(result.current.draft).toMatchObject({
      mode: "reply",
      to: "Alice <alice@x.fr>",
      subject: "Re: Sujet",
      inReplyTo: "<m1@host>",
      attachments: [],
    })
  })

  it("openReply(replyAll) : cc = destinataires + cc du message, moi et l'expéditeur exclus", () => {
    const detailReplyAll: AppThreadDetail = {
      ...detail,
      messages: [
        {
          ...detail.messages[0],
          to: [{ name: "Alice", email: "alice@x.fr" }],
          cc: [
            { name: "Moi", email: "me@x.fr" },
            { name: "Bob", email: "bob@x.fr" },
          ],
        },
      ],
    }
    const { result } = renderHook(() =>
      useQuickReplyDraft(detailReplyAll, "me@x.fr")
    )
    act(() => result.current.openReply("replyAll"))
    expect(result.current.draft).toMatchObject({
      mode: "replyAll",
      to: "Alice <alice@x.fr>",
      cc: "Bob <bob@x.fr>",
    })
  })

  it("openForward : brouillon forward (Fwd:, À vide, en-tête cité, PJ reprises)", () => {
    const { result } = renderHook(() => useQuickReplyDraft(detail, "me@x.fr"))
    act(() => result.current.openForward(detail.messages[0]))
    expect(result.current.draft).toMatchObject({
      mode: "forward",
      to: "",
      subject: "Fwd: Sujet",
      references: [],
      attachments: detail.messages[0].attachments,
    })
    // Libellés = clés i18n (t mocké en identité)
    expect(result.current.draft?.html).toContain("mail.compose.fwdForwarded")
    expect(result.current.draft?.html).toContain("alice@x.fr")
    expect(result.current.draft?.inReplyTo).toBeUndefined()
  })

  it("patch : retire une pièce jointe du brouillon", () => {
    const { result } = renderHook(() => useQuickReplyDraft(detail, "me@x.fr"))
    act(() => result.current.openForward(detail.messages[0]))
    act(() => result.current.patch({ attachments: [] }))
    expect(result.current.draft?.attachments).toEqual([])
  })

  it("close : réinitialise le brouillon ; openReply sans detail = no-op", () => {
    const { result } = renderHook(() => useQuickReplyDraft(detail, "me@x.fr"))
    act(() => result.current.openReply("reply"))
    act(() => result.current.close())
    expect(result.current.draft).toBeNull()
    const empty = renderHook(() => useQuickReplyDraft(undefined, "me@x.fr"))
    act(() => empty.result.current.openReply("reply"))
    expect(empty.result.current.draft).toBeNull()
  })
})
