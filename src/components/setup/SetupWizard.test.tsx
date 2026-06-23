import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import { SetupWizard } from "./SetupWizard"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

const serverProps = () => ({
  createAccount: vi.fn().mockResolvedValue({ status: "ok" as const }),
  createDnsServer: vi.fn().mockResolvedValue({ dnsServerId: "s1" }),
  setDnsManagement: vi.fn().mockResolvedValue({ ok: true as const }),
  setDnsManagementManual: vi.fn().mockResolvedValue({ ok: true as const }),
  gridStatus: vi.fn().mockResolvedValue({ origin: "x", records: [] }),
  configureAcme: vi.fn().mockResolvedValue({ ok: true as const }),
  acmeStatus: vi.fn().mockResolvedValue({ status: "pending" as const }),
  acknowledgeManualSsl: vi.fn().mockResolvedValue({ ok: true as const }),
  finishSetup: vi.fn().mockResolvedValue({ ok: true as const }),
})

describe("SetupWizard", () => {
  it("renders the card shell: welcome, lang/theme header, and a linear 6-dot stepper", () => {
    const { container } = wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...serverProps()}
      />
    )
    expect(screen.getByText("Bienvenue sur Stalmail")).toBeInTheDocument()
    expect(screen.getByLabelText("Langue")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Passer au thème sombre" })
    ).toBeInTheDocument()
    expect(container.querySelectorAll(".step-dot")).toHaveLength(6)
    // No group separators in the linear stepper.
    expect(container.querySelector(".stepper-h-group")).toBeNull()
  })

  it("flips the wizard root data-theme when the theme toggle is clicked", () => {
    const { container } = wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...serverProps()}
      />
    )
    const root = container.querySelector(".stalmail-wizard") as HTMLElement
    expect(root.getAttribute("data-theme")).toBe("light")
    fireEvent.click(
      screen.getByRole("button", { name: "Passer au thème sombre" })
    )
    expect(root.getAttribute("data-theme")).toBe("dark")
  })

  it("collect: welcome → domain → submitBootstrap → restart screen → poll lands on DNS", async () => {
    const submitBootstrap = vi.fn().mockResolvedValue(undefined)
    const poll = vi.fn().mockResolvedValue({ step: "dns", dnsManual: false })
    wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        submitBootstrap={submitBootstrap}
        pollStep={poll}
        {...serverProps()}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Commencer" }))
    fireEvent.change(screen.getByLabelText("Nom d’hôte du serveur"), {
      target: { value: "mail.exemple.fr" },
    })
    fireEvent.change(screen.getByLabelText("Domaine par défaut"), {
      target: { value: "exemple.fr" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    await waitFor(() =>
      expect(submitBootstrap).toHaveBeenCalledWith({
        serverHostname: "mail.exemple.fr",
        defaultDomain: "exemple.fr",
      })
    )
    // Restart screen polls getStep, which resolves to dns → DnsStep form renders.
    expect(await screen.findByText("Fournisseur DNS")).toBeInTheDocument()
    expect(poll).toHaveBeenCalled()
  })

  it("resume on dns: renders the DnsStep form directly, advances to SSL via re-poll", async () => {
    const poll = vi.fn().mockResolvedValue({ step: "ssl", dnsManual: false })
    wrap(
      <SetupWizard
        initialStep="dns"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={poll}
        {...serverProps()}
      />
    )
    // DnsStep form is shown immediately (no lost state).
    expect(screen.getByText("Fournisseur DNS")).toBeInTheDocument()
    // Manual default → submit, grid, then advance.
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    // grid appears, Continue advances → re-poll → SSL.
    await screen.findByRole("button", { name: "Continuer" })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    await waitFor(() => expect(poll).toHaveBeenCalled())
    expect(await screen.findByText("Certificat SSL")).toBeInTheDocument()
  })

  it("re-poll failure: surfaces a retryable error and recovers on retry", async () => {
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ step: "ssl", dnsManual: false })
    wrap(
      <SetupWizard
        initialStep="dns"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={poll}
        {...serverProps()}
      />
    )
    // Manual default → submit, grid, then advance triggers the failing re-poll.
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    await screen.findByRole("button", { name: "Continuer" })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    // Error box appears (no crash, no unhandled rejection), wizard stays put.
    expect(await screen.findByText("SETUP-UNKNOWN")).toBeInTheDocument()

    // Retry → second poll resolves → advances to SSL.
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(await screen.findByText("Certificat SSL")).toBeInTheDocument()
  })

  it("resume on ssl with dnsManual: shows the manual note, calls acknowledgeManualSsl then advances to account", async () => {
    const poll = vi
      .fn()
      .mockResolvedValue({ step: "account", dnsManual: false })
    const acknowledgeManualSsl = vi
      .fn()
      .mockResolvedValue({ ok: true as const })
    wrap(
      <SetupWizard
        initialStep="ssl"
        initialDnsManual={true}
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={poll}
        {...serverProps()}
        acknowledgeManualSsl={acknowledgeManualSsl}
      />
    )
    expect(
      await screen.findByText("Certificat à gérer manuellement")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }))
    await waitFor(() => expect(acknowledgeManualSsl).toHaveBeenCalledOnce())
    await waitFor(() => expect(poll).toHaveBeenCalled())
    expect(await screen.findByText("Compte administrateur")).toBeInTheDocument()
  })

  it("resume on account: creates the account then advances to done", async () => {
    const poll = vi.fn().mockResolvedValue({ step: "done", dnsManual: false })
    wrap(
      <SetupWizard
        initialStep="account"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={poll}
        {...serverProps()}
      />
    )
    expect(await screen.findByText("Compte administrateur")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Nom d’utilisateur"), {
      target: { value: "koffi" },
    })
    fireEvent.change(screen.getByLabelText("Mot de passe"), {
      target: { value: "correct horse battery 9" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    // On a pure resume the domain isn't known client-side (empty), so the email
    // is just the username — assert the success line via a partial match.
    await screen.findByText(/Compte koffi@/)
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }))
    await waitFor(() => expect(poll).toHaveBeenCalled())
    expect(
      await screen.findByText("Votre serveur est prêt")
    ).toBeInTheDocument()
  })
})
