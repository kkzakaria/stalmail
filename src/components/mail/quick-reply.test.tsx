import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QuickReply } from "./quick-reply"
import type { AppThreadDetail } from "../../server/mail-types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const detail: AppThreadDetail = {
  threadId: "t1",
  subject: "Sujet",
  messages: [
    {
      id: "m1",
      messageId: null,
      from: [{ name: "Alice", email: "alice@x.fr" }],
      to: [{ name: "Moi", email: "me@x.fr" }],
      cc: [],
      subject: "Sujet",
      receivedAt: "2026-06-10T00:00:00Z",
      unread: false,
      hasAttachment: false,
      textBody: "corps",
      htmlBody: "<p>corps</p>",
      attachments: [],
    },
  ],
  emailIds: ["m1"],
  starred: false,
  unread: false,
}

// Fil avec messageId pour tester le threading RFC
const detailWithMessageId: AppThreadDetail = {
  ...detail,
  messages: [
    {
      ...detail.messages[0],
      messageId: "<m1@host>",
    },
  ],
}

// Fil avec Cc pour tester l'auto-exclusion replyAll
const detailWithCc: AppThreadDetail = {
  ...detail,
  messages: [
    {
      ...detail.messages[0],
      messageId: "<m1@host>",
      to: [{ name: "Alice", email: "alice@x.fr" }],
      cc: [
        { name: "Moi", email: "me@x.fr" },
        { name: "Bob", email: "bob@x.fr" },
      ],
    },
  ],
}

describe("QuickReply", () => {
  it("affiche la barre de réponse et passe en mode édition au clic", () => {
    render(
      <QuickReply
        detail={detail}
        selfEmail="me@x.fr"
        sending={false}
        onSend={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    expect(screen.getByLabelText("mail.compose.body")).toBeInTheDocument()
  })

  it("envoie un brouillon de réponse pré-rempli (mode reply, objet Re:)", () => {
    const onSend = vi.fn()
    render(
      <QuickReply
        detail={detail}
        selfEmail="me@x.fr"
        sending={false}
        onSend={onSend}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "reply",
        to: "Alice <alice@x.fr>",
        subject: "Re: Sujet",
      })
    )
  })

  it("réinitialise la réponse rapide après un envoi réussi (onSend → true)", async () => {
    const onSend = vi.fn(() => true)
    render(
      <QuickReply
        detail={detail}
        selfEmail="me@x.fr"
        sending={false}
        onSend={onSend}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    expect(screen.getByLabelText("mail.compose.body")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    // Succès → l'éditeur disparaît et la barre de réponse revient.
    await waitFor(() =>
      expect(
        screen.queryByLabelText("mail.compose.body")
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("button", { name: "mail.compose.reply" })
    ).toBeInTheDocument()
  })

  it("garde la réponse rapide ouverte si l'envoi échoue (onSend → false)", async () => {
    const onSend = vi.fn(() => false)
    render(
      <QuickReply
        detail={detail}
        selfEmail="me@x.fr"
        sending={false}
        onSend={onSend}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    await waitFor(() => expect(onSend).toHaveBeenCalled())
    // Échec → l'éditeur reste affiché (contenu préservé pour réessayer).
    expect(screen.getByLabelText("mail.compose.body")).toBeInTheDocument()
  })

  it("threading reply : inReplyTo et references reprennent le Message-ID du dernier message", () => {
    const onSend = vi.fn()
    render(
      <QuickReply
        detail={detailWithMessageId}
        selfEmail="me@x.fr"
        sending={false}
        onSend={onSend}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        inReplyTo: "<m1@host>",
        references: ["<m1@host>"],
      })
    )
  })

  it("replyAll : selfEmail est exclu du Cc du brouillon émis", () => {
    const onSend = vi.fn()
    render(
      <QuickReply
        detail={detailWithCc}
        selfEmail="me@x.fr"
        sending={false}
        onSend={onSend}
      />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "mail.compose.replyAll" })
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    const draft = onSend.mock.calls[0][0]
    // me@x.fr ne doit pas apparaître dans le Cc
    expect(draft.cc).not.toMatch(/me@x\.fr/)
    // Bob doit être présent
    expect(draft.cc).toMatch(/bob@x\.fr/)
  })
})
