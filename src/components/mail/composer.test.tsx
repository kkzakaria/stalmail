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

  it("Cc et Cci sont des bascules indépendantes (n'ouvrent pas les deux à la fois)", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    // Au départ : deux bascules, aucun champ Cc/Cci.
    expect(
      screen.getByRole("button", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "mail.compose.bcc" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.cc" })
    ).toBeNull()
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.bcc" })
    ).toBeNull()

    // Clic « Cc » → seul le champ Cc apparaît (Cci reste fermé).
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    expect(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.bcc" })
    ).toBeNull()

    // Clic « Cci » → le champ Cci apparaît à son tour.
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
    expect(
      screen.getByRole("textbox", { name: "mail.compose.bcc" })
    ).toBeInTheDocument()
  })

  it("draft pré-rempli : seul le champ concerné est ouvert au départ (pas les deux)", () => {
    // Cc pré-rempli, Cci vide → seul le champ Cc est affiché.
    const { unmount } = render(
      <Composer
        initial={{ ...initial, cc: "x@y.fr" }}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    expect(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.bcc" })
    ).toBeNull()
    unmount()

    // Inverse : Cci pré-rempli, Cc vide → seul le champ Cci est affiché.
    render(
      <Composer
        initial={{ ...initial, bcc: "z@y.fr" }}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    expect(
      screen.getByRole("textbox", { name: "mail.compose.bcc" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.cc" })
    ).toBeNull()
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
