import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import type { AcmeStatus } from "@/server/stalwart-acme"
import { SslStep } from "./SslStep"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

describe("SslStep", () => {
  it("auto: configuring → monitor recap, reports pending, Continue advances", async () => {
    const configureAcme = vi.fn(() => Promise.resolve({ ok: true as const }))
    const acmeStatus = vi.fn(
      (): Promise<{ status: AcmeStatus }> =>
        Promise.resolve({ status: "pending" })
    )
    const onStatusChange = vi.fn()
    const onNext = vi.fn()

    wrap(
      <SslStep
        hostname="mail.exemple.fr"
        contactEmail="admin@exemple.fr"
        dnsManual={false}
        configureAcme={configureAcme}
        acmeStatus={acmeStatus}
        onStatusChange={onStatusChange}
        onNext={onNext}
      />
    )

    expect(
      await screen.findByText("Let's Encrypt · DNS-01")
    ).toBeInTheDocument()
    expect(screen.getByText(/Vous pouvez continuer/)).toBeInTheDocument()
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("pending"))
    expect(configureAcme).toHaveBeenCalledWith({
      hostname: "mail.exemple.fr",
      contactEmail: "admin@exemple.fr",
    })

    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }))
    expect(onNext).toHaveBeenCalled()
  })

  it("manual: skips configureAcme, shows informative note, Continue advances", async () => {
    const configureAcme = vi.fn(() => Promise.resolve({ ok: true as const }))
    const onNext = vi.fn()

    wrap(
      <SslStep
        hostname="mail.exemple.fr"
        contactEmail="admin@exemple.fr"
        dnsManual={true}
        configureAcme={configureAcme}
        acmeStatus={vi.fn(
          (): Promise<{ status: AcmeStatus }> =>
            Promise.resolve({ status: "pending" })
        )}
        onStatusChange={vi.fn()}
        onNext={onNext}
      />
    )

    expect(
      await screen.findByText("Certificat à gérer manuellement")
    ).toBeInTheDocument()
    expect(configureAcme).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }))
    expect(onNext).toHaveBeenCalled()
  })

  it("auto: configureAcme rejection shows a SetupErrorBox with the SSL code", async () => {
    const configureAcme = vi.fn(() =>
      Promise.reject(new Error("SETUP-SSL-REJECTED"))
    )

    wrap(
      <SslStep
        hostname="mail.exemple.fr"
        contactEmail="admin@exemple.fr"
        dnsManual={false}
        configureAcme={configureAcme}
        acmeStatus={vi.fn(
          (): Promise<{ status: AcmeStatus }> =>
            Promise.resolve({ status: "pending" })
        )}
        onStatusChange={vi.fn()}
        onNext={vi.fn()}
      />
    )

    expect(await screen.findByText("SETUP-SSL-REJECTED")).toBeInTheDocument()
    expect(
      screen.getByText("L'obtention du certificat SSL a échoué.")
    ).toBeInTheDocument()
    expect(screen.getByText("Réessayer")).toBeInTheDocument()
  })
})
