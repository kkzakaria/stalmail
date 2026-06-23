import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import { SetupWizard } from "./SetupWizard"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

// Default unlock/authStatus: cookie already valid, no token in URL.
const authProps = () => ({
  unlock: vi.fn().mockResolvedValue({ ok: true as const }),
  authStatus: vi.fn().mockResolvedValue({ authed: true }),
})

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
  afterEach(cleanup)

  it("renders the card shell: welcome, lang/theme header, and a linear 6-dot stepper", async () => {
    const { container } = wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...authProps()}
        {...serverProps()}
      />
    )
    // authStatus resolves to authed=true → wizard flow renders
    expect(
      await screen.findByText("Bienvenue sur Stalmail")
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Langue")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Passer au thème sombre" })
    ).toBeInTheDocument()
    expect(container.querySelectorAll(".step-dot")).toHaveLength(6)
    // No group separators in the linear stepper.
    expect(container.querySelector(".stepper-h-group")).toBeNull()
  })

  it("flips the wizard root data-theme when the theme toggle is clicked", async () => {
    const { container } = wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...authProps()}
        {...serverProps()}
      />
    )
    // wait for auth gate to resolve
    await screen.findByText("Bienvenue sur Stalmail")
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
        {...authProps()}
        {...serverProps()}
      />
    )

    // wait for auth gate
    await screen.findByText("Bienvenue sur Stalmail")

    fireEvent.click(screen.getByRole("button", { name: "Commencer" }))
    // DomainStep renders asynchronously after phase change — use findBy
    fireEvent.change(await screen.findByLabelText("Nom d’hôte du serveur"), {
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
        {...authProps()}
        {...serverProps()}
      />
    )
    // wait for auth gate then DnsStep
    expect(await screen.findByText("Fournisseur DNS")).toBeInTheDocument()
    // Manual default → submit, grid, then advance.
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    // grid appears, Continue advances → re-poll → SSL.
    await screen.findByRole("button", { name: "Continuer" })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    await waitFor(() => expect(poll).toHaveBeenCalled())
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
        {...authProps()}
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
        {...authProps()}
        {...serverProps()}
      />
    )
    expect(await screen.findByText("Compte administrateur")).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText("Nom d’utilisateur"), {
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

// --- Auth gate tests ---

describe("SetupWizard — auth gate", () => {
  // Spy on the real history.replaceState so we can verify calls without breaking it
  let replaceStateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Clear any hash leftover from a previous test
    window.location.hash = ""
    replaceStateSpy = vi.spyOn(history, "replaceState")
  })

  afterEach(() => {
    cleanup()
    replaceStateSpy.mockRestore()
    window.location.hash = ""
  })

  it("no token + authStatus=false → shows 'lien requis' screen, no Welcome", async () => {
    const authStatus = vi.fn().mockResolvedValue({ authed: false })
    wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        unlock={vi.fn()}
        authStatus={authStatus}
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...serverProps()}
      />
    )
    expect(await screen.findByText("Lien de setup requis")).toBeInTheDocument()
    expect(screen.queryByText("Bienvenue sur Stalmail")).not.toBeInTheDocument()
  })

  it("no token + authStatus=true → shows Welcome (wizard flow)", async () => {
    wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        {...authProps()}
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...serverProps()}
      />
    )
    expect(
      await screen.findByText("Bienvenue sur Stalmail")
    ).toBeInTheDocument()
    expect(screen.queryByText("Lien de setup requis")).not.toBeInTheDocument()
  })

  it("token in URL hash → unlock called with token + history.replaceState scrubs fragment", async () => {
    // Set the hash before rendering using jsdom's location setter
    window.location.hash = "#token=abc123"

    const unlock = vi.fn().mockResolvedValue({ ok: true as const })
    const authStatus = vi.fn().mockResolvedValue({ authed: true })

    wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        unlock={unlock}
        authStatus={authStatus}
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...serverProps()}
      />
    )

    // Wait for the wizard to become visible (authed after unlock)
    await screen.findByText("Bienvenue sur Stalmail")

    expect(unlock).toHaveBeenCalledWith("abc123")
    // replaceState was called to scrub the token from the URL
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      "",
      expect.not.stringContaining("token")
    )
  })

  it("token in URL but unlock fails → shows SetupErrorBox with SETUP-UNLOCK-FAILED", async () => {
    window.location.hash = "#token=bad-token"

    const unlock = vi.fn().mockRejectedValue(new Error("SETUP-UNLOCK-FAILED"))
    const authStatus = vi.fn().mockResolvedValue({ authed: false })

    wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        unlock={unlock}
        authStatus={authStatus}
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...serverProps()}
      />
    )

    // The error code message from i18n
    expect(
      await screen.findByText("Lien de setup invalide ou expiré.")
    ).toBeInTheDocument()
    expect(screen.queryByText("Bienvenue sur Stalmail")).not.toBeInTheDocument()
  })

  it("action throws SETUP-UNAUTHENTICATED with token in ref → re-unlocks and retries", async () => {
    // Token in URL so the ref captures it at mount
    window.location.hash = "#token=valid-token"

    const unlock = vi.fn().mockResolvedValue({ ok: true as const })
    const authStatus = vi.fn().mockResolvedValue({ authed: true })

    // submitBootstrap fails once with SETUP-UNAUTHENTICATED, then succeeds
    const submitBootstrap = vi
      .fn()
      .mockRejectedValueOnce(new Error("SETUP-UNAUTHENTICATED"))
      .mockResolvedValue(undefined)

    const pollStep = vi
      .fn()
      .mockResolvedValue({ step: "dns", dnsManual: false })

    wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        unlock={unlock}
        authStatus={authStatus}
        submitBootstrap={submitBootstrap}
        pollStep={pollStep}
        {...serverProps()}
      />
    )

    // Wait for wizard (unlock called once on mount for token)
    await screen.findByText("Bienvenue sur Stalmail")
    fireEvent.click(screen.getByRole("button", { name: "Commencer" }))
    fireEvent.change(await screen.findByLabelText("Nom d’hôte du serveur"), {
      target: { value: "mail.exemple.fr" },
    })
    fireEvent.change(screen.getByLabelText("Domaine par défaut"), {
      target: { value: "exemple.fr" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    // After SETUP-UNAUTHENTICATED: re-unlock then retry → submitBootstrap called twice
    await waitFor(() => expect(submitBootstrap).toHaveBeenCalledTimes(2))
    // unlock: once on mount for token + once for re-auth recovery
    expect(unlock).toHaveBeenCalledTimes(2)
    // After recovery succeeds, restart screen → then DNS step
    expect(await screen.findByText("Fournisseur DNS")).toBeInTheDocument()
    // Should NOT show expired screen
    expect(screen.queryByText("Session expirée")).not.toBeInTheDocument()
  })

  it("action throws SETUP-UNAUTHENTICATED without token in ref → shows expired screen", async () => {
    // No token in hash — cookie already valid at mount
    const authStatus = vi.fn().mockResolvedValue({ authed: true })
    const unlock = vi.fn().mockResolvedValue({ ok: true as const })

    // submitBootstrap throws SETUP-UNAUTHENTICATED (cookie expired mid-setup)
    const submitBootstrap = vi
      .fn()
      .mockRejectedValue(new Error("SETUP-UNAUTHENTICATED"))

    wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        unlock={unlock}
        authStatus={authStatus}
        submitBootstrap={submitBootstrap}
        pollStep={vi.fn()}
        {...serverProps()}
      />
    )

    await screen.findByText("Bienvenue sur Stalmail")
    fireEvent.click(screen.getByRole("button", { name: "Commencer" }))
    fireEvent.change(await screen.findByLabelText("Nom d’hôte du serveur"), {
      target: { value: "mail.exemple.fr" },
    })
    fireEvent.change(screen.getByLabelText("Domaine par défaut"), {
      target: { value: "exemple.fr" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    // No token → expired screen
    expect(await screen.findByText("Session expirée")).toBeInTheDocument()
    expect(screen.queryByText("Bienvenue sur Stalmail")).not.toBeInTheDocument()
  })
})
