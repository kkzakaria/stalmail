import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Composer } from "./composer"
import type { ComposerDraft } from "./use-composer"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const initial: ComposerDraft = {
  mode: "compose",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  html: "",
  references: [],
}

describe("Composer", () => {
  it("rend les champs et le bouton Envoyer", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    expect(screen.getByLabelText("mail.compose.to")).toBeInTheDocument()
    expect(screen.getByLabelText("mail.compose.subject")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "mail.compose.send" })
    ).toBeInTheDocument()
  })

  it("envoie le brouillon saisi", () => {
    const onSend = vi.fn()
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={onSend}
        onClose={() => {}}
      />
    )
    fireEvent.change(screen.getByLabelText("mail.compose.to"), {
      target: { value: "a@b.fr" },
    })
    fireEvent.change(screen.getByLabelText("mail.compose.subject"), {
      target: { value: "Hello" },
    })
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@b.fr",
        subject: "Hello",
        mode: "compose",
      })
    )
  })

  it("désactive Envoyer pendant l'envoi", () => {
    render(
      <Composer
        initial={initial}
        sending={true}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    expect(
      screen.getByRole("button", { name: "mail.compose.send" })
    ).toBeDisabled()
  })

  it("ferme via le bouton fermer", () => {
    const onClose = vi.fn()
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.close" }))
    expect(onClose).toHaveBeenCalled()
  })
})
