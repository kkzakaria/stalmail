import { describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "../../i18n/i18n"
import { MessageItem } from "./message-item"
import type { AppMessage } from "../../server/mail-types"

const msg = (over: Partial<AppMessage> = {}): AppMessage => ({
  id: "e1",
  from: [{ name: "Bob", email: "bob@x.io" }],
  to: [{ name: "Moi", email: "me@x.io" }],
  cc: [],
  subject: "s",
  receivedAt: "2026-06-10T10:00:00Z",
  unread: false,
  hasAttachment: false,
  textBody: "corps en clair",
  htmlBody: null,
  attachments: [],
  ...over,
})

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)
}

describe("MessageItem", () => {
  it("affiche le corps texte quand ouvert", () => {
    wrap(<MessageItem message={msg()} defaultOpen />)
    expect(screen.getByText("corps en clair")).toBeInTheDocument()
  })

  it("rend une iframe pour un corps html-seul", () => {
    const { container } = wrap(
      <MessageItem
        message={msg({ textBody: null, htmlBody: "<p>hi</p>" })}
        defaultOpen
      />
    )
    expect(container.querySelector("iframe.msg-html-frame")).not.toBeNull()
  })

  it("liste les pièces jointes avec bouton télécharger désactivé", () => {
    wrap(
      <MessageItem
        message={msg({
          attachments: [
            {
              blobId: "b",
              name: "cv.pdf",
              type: "application/pdf",
              size: 10,
            },
          ],
        })}
        defaultOpen
      />
    )
    expect(screen.getByText("cv.pdf")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cv\.pdf/i })).toBeDisabled()
  })

  it("replie le corps au clic sur l'en-tête", () => {
    const { container } = wrap(<MessageItem message={msg()} defaultOpen />)
    expect(screen.getByText("corps en clair")).toBeInTheDocument()
    fireEvent.click(container.querySelector(".msg-head")!)
    expect(screen.queryByText("corps en clair")).not.toBeInTheDocument()
  })

  it("corps absent quand defaultOpen=false", () => {
    wrap(<MessageItem message={msg()} />)
    expect(screen.queryByText("corps en clair")).not.toBeInTheDocument()
  })

  it("bandeau images : visible puis masqué après 'afficher les images'", () => {
    wrap(
      <MessageItem
        message={msg({
          textBody: null,
          htmlBody: '<img src="https://t/x.png">',
        })}
        defaultOpen
      />
    )
    const banner = screen.getByText(/images distantes/i)
    expect(banner).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: /afficher les images/i })
    )
    expect(screen.queryByText(/images distantes/i)).not.toBeInTheDocument()
  })

  it("expéditeur vide → '—' sans crash", () => {
    const { container } = wrap(
      <MessageItem message={msg({ from: [] })} defaultOpen />
    )
    expect(container.querySelector(".nm")?.textContent).toBe("—")
  })
})
