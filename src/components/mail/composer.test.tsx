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
  attachments: [],
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

  it("referme la rangée Cc vide au blur (bouton bascule de retour)", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    const cc = screen.getByRole("textbox", { name: "mail.compose.cc" })
    fireEvent.blur(cc)
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.cc" })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })

  it("garde la rangée Cc ouverte au blur quand elle a une valeur", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    const cc = screen.getByRole("textbox", { name: "mail.compose.cc" })
    fireEvent.change(cc, { target: { value: "bob@x.fr" } })
    fireEvent.blur(cc)
    expect(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    ).toHaveValue("bob@x.fr")
  })

  it("referme la rangée Cci au blur avec des espaces seuls", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
    const bcc = screen.getByRole("textbox", { name: "mail.compose.bcc" })
    fireEvent.change(bcc, { target: { value: "   " } })
    fireEvent.blur(bcc)
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.bcc" })
    ).toBeNull()
  })

  it("referme la rangée Cc pré-remplie (replyAll) une fois vidée puis quittée", () => {
    render(
      <Composer
        initial={{ ...initial, mode: "replyAll", cc: "bob@x.fr" }}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    const cc = screen.getByRole("textbox", { name: "mail.compose.cc" }) // ouverte d'emblée
    fireEvent.change(cc, { target: { value: "" } })
    fireEvent.blur(cc)
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
