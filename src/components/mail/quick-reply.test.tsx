import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
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
})
