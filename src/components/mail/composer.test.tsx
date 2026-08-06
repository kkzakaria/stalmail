import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
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

  // Cible hors zone : le champ Sujet, juste sous les rangées destinataires.
  const horsZone = () => screen.getByLabelText("mail.compose.subject")

  it("la bascule Cc donne le focus au champ révélé", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    )
  })

  // Garde-fou : prouve seulement l'absence de retour à un autoFocus
  // inconditionnel. Ne prouve pas à lui seul que le focus fonctionne quand
  // il le doit — c'est le test voisin qui le prouve.
  it("une rangée Cc pré-remplie (replyAll) ne prend PAS le focus au montage", () => {
    render(
      <Composer
        initial={{ ...initial, mode: "replyAll", cc: "bob@x.fr" }}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    expect(document.activeElement).not.toBe(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    )
  })

  it("sortir de la zone referme la rangée Cc vide", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    fireEvent.focusOut(
      screen.getByRole("textbox", { name: "mail.compose.cc" }),
      { relatedTarget: horsZone() }
    )
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.cc" })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })

  it("sortir de la zone garde la rangée Cc remplie", () => {
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
    fireEvent.focusOut(cc, { relatedTarget: horsZone() })
    expect(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    ).toHaveValue("bob@x.fr")
  })

  it("des espaces seuls comptent comme vide", () => {
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
    fireEvent.focusOut(bcc, { relatedTarget: horsZone() })
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.bcc" })
    ).toBeNull()
  })

  it("circuler dans la zone ne referme rien (Cc vide → bascule Cci)", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    fireEvent.focusOut(
      screen.getByRole("textbox", { name: "mail.compose.cc" }),
      {
        relatedTarget: screen.getByRole("button", { name: "mail.compose.bcc" }),
      }
    )
    expect(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })

  it("détour par Cci puis sortie : la Cc vide oubliée se referme aussi", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    fireEvent.focusOut(
      screen.getByRole("textbox", { name: "mail.compose.cc" }),
      {
        relatedTarget: screen.getByRole("button", { name: "mail.compose.bcc" }),
      }
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
    const bcc = screen.getByRole("textbox", { name: "mail.compose.bcc" })
    fireEvent.change(bcc, { target: { value: "bob@x.fr" } })
    fireEvent.focusOut(bcc, { relatedTarget: horsZone() })
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.cc" })
    ).toBeNull()
    expect(
      screen.getByRole("textbox", { name: "mail.compose.bcc" })
    ).toHaveValue("bob@x.fr")
  })

  it("la rangée Cc pré-remplie vidée se referme en sortant de la zone", () => {
    render(
      <Composer
        initial={{ ...initial, mode: "replyAll", cc: "bob@x.fr" }}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    const cc = screen.getByRole("textbox", { name: "mail.compose.cc" })
    fireEvent.change(cc, { target: { value: "" } })
    fireEvent.focusOut(cc, { relatedTarget: horsZone() })
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.cc" })
    ).toBeNull()
  })

  it("relatedTarget nul (fenêtre qui perd le focus) ne referme rien", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    fireEvent.blur(screen.getByRole("textbox", { name: "mail.compose.cc" }))
    expect(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })

  it("clic en cours : le repli attend la fin du geste (issue #147)", () => {
    vi.useFakeTimers()
    try {
      render(
        <Composer
          initial={initial}
          sending={false}
          onSend={() => {}}
          onClose={() => {}}
        />
      )
      fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
      const cible = horsZone()
      fireEvent.pointerDown(cible)
      fireEvent.focusOut(
        screen.getByRole("textbox", { name: "mail.compose.cc" }),
        { relatedTarget: cible }
      )
      // Rien ne bouge tant que le pointeur est enfoncé : sinon le clic serait
      // avalé par le décalage de la mise en page.
      expect(
        screen.getByRole("textbox", { name: "mail.compose.cc" })
      ).toBeInTheDocument()
      fireEvent.pointerUp(cible)
      act(() => {
        vi.runAllTimers()
      })
      expect(
        screen.queryByRole("textbox", { name: "mail.compose.cc" })
      ).toBeNull()
    } finally {
      vi.useRealTimers()
    }
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
