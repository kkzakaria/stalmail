import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import { DomainStep } from "./DomainStep"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

const HOSTNAME_LABEL = "Nom d’hôte du serveur"
const DOMAIN_LABEL = "Domaine par défaut"
const NEXT_LABEL = "Continuer"
const EXT_TITLE = "Nom d'hôte hors du domaine par défaut"

const fill = () => {
  fireEvent.change(screen.getByLabelText(HOSTNAME_LABEL), {
    target: { value: "mail.exemple.fr" },
  })
  fireEvent.change(screen.getByLabelText(DOMAIN_LABEL), {
    target: { value: "exemple.fr" },
  })
}

describe("DomainStep", () => {
  it("shows the invalid hostname error on submit and does not call submitBootstrap", async () => {
    const submitBootstrap = vi.fn()
    wrap(<DomainStep submitBootstrap={submitBootstrap} onRestart={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(HOSTNAME_LABEL), {
      target: { value: "nope" },
    })
    fireEvent.change(screen.getByLabelText(DOMAIN_LABEL), {
      target: { value: "exemple.fr" },
    })
    fireEvent.click(screen.getByRole("button", { name: NEXT_LABEL }))
    await waitFor(() =>
      expect(
        screen.getByText("Format de nom d'hôte invalide.")
      ).toBeInTheDocument()
    )
    expect(submitBootstrap).not.toHaveBeenCalled()
  })

  it("renders the external-zone warning when the host is outside the domain", () => {
    wrap(<DomainStep submitBootstrap={vi.fn()} onRestart={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(HOSTNAME_LABEL), {
      target: { value: "mail.autre.fr" },
    })
    fireEvent.change(screen.getByLabelText(DOMAIN_LABEL), {
      target: { value: "dupont.fr" },
    })
    expect(screen.getByText(EXT_TITLE)).toBeInTheDocument()
  })

  it("executes submitBootstrap then onRestart on a valid submit", async () => {
    const submitBootstrap = vi.fn().mockResolvedValue(undefined)
    const onRestart = vi.fn()
    wrap(<DomainStep submitBootstrap={submitBootstrap} onRestart={onRestart} />)
    fill()
    fireEvent.click(screen.getByRole("button", { name: NEXT_LABEL }))
    await waitFor(() =>
      expect(submitBootstrap).toHaveBeenCalledWith({
        serverHostname: "mail.exemple.fr",
        defaultDomain: "exemple.fr",
      })
    )
    await waitFor(() => expect(onRestart).toHaveBeenCalledTimes(1))
  })

  it("shows a SetupErrorBox (code) and stays on the step when submitBootstrap rejects", async () => {
    const submitBootstrap = vi
      .fn()
      .mockRejectedValue(new Error("SETUP-DNS-REJECTED"))
    const onRestart = vi.fn()
    wrap(<DomainStep submitBootstrap={submitBootstrap} onRestart={onRestart} />)
    fill()
    fireEvent.click(screen.getByRole("button", { name: NEXT_LABEL }))
    expect(await screen.findByText("SETUP-DNS-REJECTED")).toBeInTheDocument()
    expect(
      screen.getByText("Le fournisseur DNS a refusé ces informations.")
    ).toBeInTheDocument()
    expect(onRestart).not.toHaveBeenCalled()
    // Retry returns to the form.
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(screen.getByLabelText(HOSTNAME_LABEL)).toBeInTheDocument()
  })
})
