import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "../../i18n/i18n"
import { Reader } from "./reader"
import type { AppThreadDetail } from "../../server/mail-types"

const detail = (): AppThreadDetail => ({
  threadId: "t1",
  subject: "Sujet test",
  emailIds: ["e1"],
  starred: false,
  unread: false,
  messages: [
    {
      id: "e1",
      from: [{ name: "Bob", email: "bob@x.io" }],
      to: [],
      cc: [],
      subject: "Sujet test",
      receivedAt: "2026-06-10T10:00:00Z",
      unread: false,
      hasAttachment: false,
      textBody: "hello",
      htmlBody: null,
      attachments: [],
    },
  ],
})

const noop = {
  star: vi.fn(),
  markRead: vi.fn(),
  move: vi.fn(),
  onBack: vi.fn(),
}

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)
}

describe("Reader", () => {
  it("état vide quand pas de détail", () => {
    wrap(
      <Reader
        folder="inbox"
        detail={undefined}
        isLoading={false}
        isError={false}
        {...noop}
      />
    )
    expect(
      screen.getByText("Aucune conversation sélectionnée")
    ).toBeInTheDocument()
  })

  it("affiche sujet + message quand chargé", () => {
    wrap(
      <Reader
        folder="inbox"
        detail={detail()}
        isLoading={false}
        isError={false}
        {...noop}
      />
    )
    expect(screen.getByText("Sujet test")).toBeInTheDocument()
    expect(screen.getByText("hello")).toBeInTheDocument()
  })

  it('clic Archiver appelle move("archive")', () => {
    const move = vi.fn()
    wrap(
      <Reader
        folder="inbox"
        detail={detail()}
        isLoading={false}
        isError={false}
        {...noop}
        move={move}
      />
    )
    screen.getByTitle("Archiver").click()
    expect(move).toHaveBeenCalledWith("archive")
  })

  it("bouton Répondre est désactivé (4c)", () => {
    wrap(
      <Reader
        folder="inbox"
        detail={detail()}
        isLoading={false}
        isError={false}
        {...noop}
      />
    )
    expect(screen.getByRole("button", { name: /Répondre/i })).toBeDisabled()
  })

  it("état erreur propose Réessayer", () => {
    wrap(
      <Reader
        folder="inbox"
        detail={undefined}
        isLoading={false}
        isError
        {...noop}
      />
    )
    expect(
      screen.getByText("Impossible d’ouvrir le message.")
    ).toBeInTheDocument()
  })

  it("affiche un skeleton en chargement (pas de boutons d’action)", () => {
    const { container } = wrap(
      <Reader
        folder="inbox"
        detail={undefined}
        isLoading
        isError={false}
        {...noop}
      />
    )
    expect(container.querySelector(".msg-skeleton")).not.toBeNull()
    expect(screen.queryByTitle("Archiver")).not.toBeInTheDocument()
  })

  it("clic Favori appelle star(true) quand non favori", () => {
    const star = vi.fn()
    wrap(
      <Reader
        folder="inbox"
        detail={detail()}
        isLoading={false}
        isError={false}
        {...noop}
        star={star}
      />
    )
    screen.getByTitle("Favori").click()
    expect(star).toHaveBeenCalledWith(true)
  })

  it("dans spam, propose ‘retirer des indésirables’ et appelle move(‘inbox’)", () => {
    const move = vi.fn()
    wrap(
      <Reader
        folder="spam"
        detail={detail()}
        isLoading={false}
        isError={false}
        {...noop}
        move={move}
      />
    )
    screen.getByTitle("Retirer des indésirables").click()
    expect(move).toHaveBeenCalledWith("inbox")
  })

  it("clic Retour appelle onBack", () => {
    const onBack = vi.fn()
    wrap(
      <Reader
        folder="inbox"
        detail={detail()}
        isLoading={false}
        isError={false}
        {...noop}
        onBack={onBack}
      />
    )
    screen.getByTitle("Retour").click()
    expect(onBack).toHaveBeenCalled()
  })
})
