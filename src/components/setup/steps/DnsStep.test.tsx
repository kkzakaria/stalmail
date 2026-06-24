import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import type { DnsGridRecord } from "@/server/setup-actions"
import { DnsStep } from "./DnsStep"

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
  onNext: vi.fn(),
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
})
