import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import type { DnsGridRecord, HostAddressRecord } from "@/server/setup-actions"
import { DnsStep, nextVerifyPhase } from "./DnsStep"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

const autoRecords: DnsGridRecord[] = [
  { name: "mail.exemple.fr.", type: "A", value: "1.2.3.4", status: "pending" },
  {
    name: "exemple.fr.",
    type: "MX",
    value: "10 mail.exemple.fr.",
    status: "verified",
  },
]

const baseProps = () => ({
  hostname: "mail.exemple.fr",
  domain: "exemple.fr",
  createDnsServer: vi.fn(() => Promise.resolve({ dnsServerId: "srv-1" })),
  setDnsManagement: vi.fn(() => Promise.resolve({ ok: true as const })),
  setDnsManagementManual: vi.fn(() => Promise.resolve({ ok: true as const })),
  gridStatus: vi.fn(() =>
    Promise.resolve({ origin: "exemple.fr", records: autoRecords })
  ),
  dnsManagementStatus: vi.fn(() =>
    Promise.resolve({ status: "published" as const })
  ),
  discoverServerIp: vi.fn(() =>
    Promise.resolve({ ipv4: "203.0.113.4", ipv6: null })
  ),
  hostAddressStatus: vi.fn(() =>
    Promise.resolve({
      records: [
        {
          name: "mail.exemple.fr.",
          type: "A",
          value: "203.0.113.4",
          role: "mail",
          status: "pending",
        },
      ] as HostAddressRecord[],
    })
  ),
  onNext: vi.fn(),
})

describe("nextVerifyPhase", () => {
  const D = 120000
  it("failed → error, quel que soit le temps écoulé", () => {
    expect(nextVerifyPhase("failed", 0, D)).toBe("error")
    expect(nextVerifyPhase("failed", D + 1, D)).toBe("error")
  })
  it("published → grid", () => {
    expect(nextVerifyPhase("published", 0, D)).toBe("grid")
  })
  it("pending avant la deadline → wait", () => {
    expect(nextVerifyPhase("pending", D - 1, D)).toBe("wait")
  })
  it("pending à/au-delà de la deadline → grid (non bloquant)", () => {
    expect(nextVerifyPhase("pending", D, D)).toBe("grid")
    expect(nextVerifyPhase("pending", D + 5000, D)).toBe("grid")
  })
})

describe("DnsStep", () => {
  it("renders the provider form first (Manual default hides the secret field)", () => {
    wrap(<DnsStep {...baseProps()} />)
    expect(screen.getByText("Fournisseur DNS")).toBeInTheDocument()
    // Manual selected by default → manual note, no secret field.
    expect(
      screen.getByText(/le wizard affichera les enregistrements/)
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Clé API")).not.toBeInTheDocument()
  })

  it("auto path: select provider + token, submit → createDnsServer + setDnsManagement → grid", async () => {
    const props = baseProps()
    wrap(<DnsStep {...props} />)

    // Pick a provider from the combobox.
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    fireEvent.click(screen.getByText("Cloudflare"))
    // Token field now visible.
    fireEvent.change(await screen.findByLabelText("Clé API"), {
      target: { value: "tok" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    expect(await screen.findByText("A")).toBeInTheDocument()
    expect(await screen.findByText("MX")).toBeInTheDocument()
    expect(props.createDnsServer).toHaveBeenCalledWith({
      provider: "Cloudflare",
      secret: "tok",
    })
    expect(props.setDnsManagement).toHaveBeenCalledWith({
      dnsServerId: "srv-1",
    })
    expect(props.setDnsManagementManual).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    expect(props.onNext).toHaveBeenCalledWith(false)
  })

  it("manual path: submit → setDnsManagementManual → sectioned grid, onNext(true)", async () => {
    const props = {
      ...baseProps(),
      gridStatus: vi.fn(() =>
        Promise.resolve({
          origin: "exemple.fr",
          records: [
            {
              name: "mail.exemple.fr.",
              type: "A",
              value: "1.2.3.4",
              status: "pending",
            },
          ] as DnsGridRecord[],
        })
      ),
    }
    wrap(<DnsStep {...props} />)
    // Manual default → submit straight away.
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    expect(await screen.findByText("Adresse du serveur")).toBeInTheDocument()
    expect(screen.getByText("Télécharger (.txt)")).toBeInTheDocument()
    expect(props.setDnsManagementManual).toHaveBeenCalledTimes(1)
    expect(props.createDnsServer).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    expect(props.onNext).toHaveBeenCalledWith(true)
  })

  it("auto failure: retry returns to the provider form so the token can be re-entered", async () => {
    const props = {
      ...baseProps(),
      createDnsServer: vi.fn(() =>
        Promise.reject(new Error("SETUP-DNS-REJECTED"))
      ),
    }
    wrap(<DnsStep {...props} />)

    // Pick a provider and enter a (bad) token, then submit.
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    fireEvent.click(screen.getByText("Cloudflare"))
    fireEvent.change(await screen.findByLabelText("Clé API"), {
      target: { value: "bad-token" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    // Error box appears.
    expect(await screen.findByText("SETUP-DNS-REJECTED")).toBeInTheDocument()

    // Retry → back to the form (re-enter token), NOT a blind replay.
    fireEvent.click(screen.getByText("Réessayer"))
    expect(await screen.findByText("Fournisseur DNS")).toBeInTheDocument()
    const token: HTMLInputElement = await screen.findByLabelText("Clé API")
    // The known-bad token is cleared so the user must re-enter it.
    expect(token.value).toBe("")
    // createDnsServer was called once (the failed attempt), not replayed on retry.
    expect(props.createDnsServer).toHaveBeenCalledTimes(1)
  })

  it("execution failure shows a SetupErrorBox and does not advance", async () => {
    const props = {
      ...baseProps(),
      setDnsManagementManual: vi.fn(() =>
        Promise.reject(new Error("SETUP-DNS-MANAGEMENT-REJECTED"))
      ),
    }
    wrap(<DnsStep {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    expect(
      await screen.findByText("SETUP-DNS-MANAGEMENT-REJECTED")
    ).toBeInTheDocument()
    expect(props.onNext).not.toHaveBeenCalled()
  })

  it("affiche la section Adresse du serveur en mode auto via l'écho IP", async () => {
    const props = baseProps()
    wrap(<DnsStep {...props} />)
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    fireEvent.click(screen.getByText("Cloudflare"))
    fireEvent.change(await screen.findByLabelText("Clé API"), {
      target: { value: "tok" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    expect(await screen.findByText("Adresse du serveur")).toBeInTheDocument()
    expect(props.discoverServerIp).toHaveBeenCalled()
    await waitFor(() => {
      expect(props.hostAddressStatus).toHaveBeenCalledWith({
        ipv4: "203.0.113.4",
        ipv6: undefined,
      })
    })
  })

  it("auto path: DnsManagement Failed → error box + retry vide le token", async () => {
    const props = {
      ...baseProps(),
      dnsManagementStatus: vi.fn(() =>
        Promise.resolve({ status: "failed" as const })
      ),
    }
    wrap(<DnsStep {...props} />)

    fireEvent.click(screen.getByRole("button", { expanded: false }))
    fireEvent.click(screen.getByText("Cloudflare"))
    fireEvent.change(await screen.findByLabelText("Clé API"), {
      target: { value: "bad-token" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    // L'erreur de publication apparaît.
    expect(
      await screen.findByText("SETUP-DNS-PUBLISH-FAILED")
    ).toBeInTheDocument()

    // Retry → retour au formulaire, token vidé pour ressaisie.
    fireEvent.click(screen.getByText("Réessayer"))
    expect(await screen.findByText("Fournisseur DNS")).toBeInTheDocument()
    const token: HTMLInputElement = await screen.findByLabelText("Clé API")
    expect(token.value).toBe("")
  })

  it("auto path: pending affiche la phase de vérification, pas encore la grille", async () => {
    const props = {
      ...baseProps(),
      dnsManagementStatus: vi.fn(() =>
        Promise.resolve({ status: "pending" as const })
      ),
    }
    wrap(<DnsStep {...props} />)

    fireEvent.click(screen.getByRole("button", { expanded: false }))
    fireEvent.click(screen.getByText("Cloudflare"))
    fireEvent.change(await screen.findByLabelText("Clé API"), {
      target: { value: "tok" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    // Spinner de vérification visible ; la grille n'est pas encore atteinte.
    expect(
      await screen.findByText(/Publication des enregistrements en cours/)
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Enregistrements gérés automatiquement")
    ).not.toBeInTheDocument()
    expect(props.dnsManagementStatus).toHaveBeenCalled()
  })

  it("écho IP échoué → hostAddressStatus interrogé sans IP, CNAME webmail affiché", async () => {
    const props = baseProps()
    props.discoverServerIp = vi.fn(() =>
      Promise.resolve({ ipv4: null, ipv6: null })
    ) as unknown as typeof props.discoverServerIp
    props.hostAddressStatus = vi.fn(() =>
      Promise.resolve({
        records: [
          {
            name: "webmail.exemple.fr.",
            type: "CNAME",
            value: "mail.exemple.fr.",
            role: "webmail",
            status: "pending",
          },
        ] as HostAddressRecord[],
      })
    )
    wrap(<DnsStep {...props} />)
    // Entrer en grille via le chemin Manuel (Manual sélectionné par défaut).
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    // Écho échoué → le poll interroge tout de même le handler, sans IP.
    await waitFor(() =>
      expect(props.hostAddressStatus).toHaveBeenCalledWith({})
    )
    // L'avertissement d'échec ET le CNAME webmail coexistent.
    expect(
      await screen.findByText(/Impossible de détecter/)
    ).toBeInTheDocument()
    expect(await screen.findByText("webmail.exemple.fr.")).toBeInTheDocument()
  })
})
