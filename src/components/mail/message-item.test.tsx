import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "../../i18n/i18n"
import { MessageItem } from "./message-item"
import type { AppMessage } from "../../server/mail-types"

const msg = (over: Partial<AppMessage> = {}): AppMessage => ({
  id: "e1",
  messageId: null,
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

  it("bandeau bloqué : boutons afficher-une-fois + faire-confiance déclenchent les callbacks", () => {
    const onShowOnce = vi.fn()
    const onTrustSender = vi.fn()
    wrap(
      <MessageItem
        message={msg({
          textBody: null,
          htmlBody: '<img src="https://t/x.png">',
          imageDecision: "blocked",
        })}
        defaultOpen
        onShowOnce={onShowOnce}
        onTrustSender={onTrustSender}
      />
    )
    expect(screen.getByText(/images distantes/i)).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: /afficher les images/i })
    )
    expect(onShowOnce).toHaveBeenCalledWith("e1")
    fireEvent.click(
      screen.getByRole("button", { name: /toujours afficher pour/i })
    )
    expect(onTrustSender).toHaveBeenCalledWith("bob@x.io")
  })

  it("message-allowed : note + bouton bloquer déclenche onHideImages", () => {
    const onHideImages = vi.fn()
    wrap(
      <MessageItem
        message={msg({
          textBody: null,
          htmlBody: '<img src="https://t/x.png">',
          imageDecision: "message-allowed",
        })}
        defaultOpen
        onHideImages={onHideImages}
      />
    )
    expect(screen.getByText(/images distantes affichées/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /bloquer/i }))
    expect(onHideImages).toHaveBeenCalledWith("e1")
  })

  it("sender-allowed : note + bouton bloquer déclenche onUntrustSender", () => {
    const onUntrustSender = vi.fn()
    wrap(
      <MessageItem
        message={msg({
          textBody: null,
          htmlBody: '<img src="https://t/x.png">',
          imageDecision: "sender-allowed",
        })}
        defaultOpen
        onUntrustSender={onUntrustSender}
      />
    )
    expect(screen.getByText(/affichées automatiquement/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /bloquer/i }))
    expect(onUntrustSender).toHaveBeenCalledWith("bob@x.io")
  })

  it("expéditeur vide → '—' sans crash", () => {
    const { container } = wrap(
      <MessageItem message={msg({ from: [] })} defaultOpen />
    )
    expect(container.querySelector(".nm")?.textContent).toBe("—")
  })

  it("affiche le bouton Transférer quand le message est ouvert et notifie onForward", () => {
    const onForward = vi.fn()
    const message = msg()
    wrap(<MessageItem message={message} defaultOpen onForward={onForward} />)
    fireEvent.click(
      screen.getByRole("button", { name: /Transférer le message/ })
    )
    expect(onForward).toHaveBeenCalledWith(message)
  })

  it("le nom accessible du bouton Transférer inclut l'expéditeur (unique par message)", () => {
    wrap(<MessageItem message={msg()} defaultOpen onForward={() => {}} />)
    expect(
      screen.getByRole("button", { name: "Transférer le message de Bob" })
    ).toBeInTheDocument()
  })

  it("le clic sur Transférer ne replie pas le message", () => {
    wrap(<MessageItem message={msg()} defaultOpen onForward={() => {}} />)
    fireEvent.click(
      screen.getByRole("button", { name: /Transférer le message/ })
    )
    // le corps reste visible → le toggle du header n'a pas été déclenché
    expect(
      screen.getByLabelText("Transférer le message de Bob")
    ).toBeInTheDocument()
    expect(document.querySelector(".msg.collapsed")).toBeNull()
  })

  it("pas de bouton Transférer quand le message est replié ou sans onForward", () => {
    const { rerender } = wrap(
      <MessageItem message={msg()} onForward={() => {}} />
    )
    expect(
      screen.queryByRole("button", { name: /Transférer le message/ })
    ).not.toBeInTheDocument()
    rerender(
      <I18nextProvider i18n={createI18n("fr")}>
        <MessageItem message={msg()} defaultOpen />
      </I18nextProvider>
    )
    expect(
      screen.queryByRole("button", { name: /Transférer le message/ })
    ).not.toBeInTheDocument()
  })
})
