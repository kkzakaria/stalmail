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
        acknowledgeManualSsl={vi.fn(() =>
          Promise.resolve({ ok: true as const })
        )}
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

  it("manual: skips configureAcme, shows informative note, Continue calls acknowledgeManualSsl then advances", async () => {
    const configureAcme = vi.fn(() => Promise.resolve({ ok: true as const }))
    const acknowledgeManualSsl = vi.fn(() =>
      Promise.resolve({ ok: true as const })
    )
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
        acknowledgeManualSsl={acknowledgeManualSsl}
        onNext={onNext}
      />
    )

    expect(
      await screen.findByText("Certificat à gérer manuellement")
    ).toBeInTheDocument()
    expect(configureAcme).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }))
    await waitFor(() => expect(acknowledgeManualSsl).toHaveBeenCalledOnce())
    expect(onNext).toHaveBeenCalled()
  })

  it("manual: acknowledgeManualSsl failure shows SetupErrorBox, does not advance", async () => {
    const acknowledgeManualSsl = vi.fn(() =>
      Promise.reject(new Error("SETUP-SSL-REJECTED"))
    )
    const onNext = vi.fn()

    wrap(
      <SslStep
        hostname="mail.exemple.fr"
        contactEmail="admin@exemple.fr"
        dnsManual={true}
        configureAcme={vi.fn(() => Promise.resolve({ ok: true as const }))}
        acmeStatus={vi.fn(
          (): Promise<{ status: AcmeStatus }> =>
            Promise.resolve({ status: "pending" })
        )}
        onStatusChange={vi.fn()}
        acknowledgeManualSsl={acknowledgeManualSsl}
        onNext={onNext}
      />
    )

    await screen.findByText("Certificat à gérer manuellement")
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }))
    expect(await screen.findByText("SETUP-SSL-REJECTED")).toBeInTheDocument()
    expect(onNext).not.toHaveBeenCalled()
  })

  it("manual: retry re-invokes acknowledgeManualSsl (not the auto path) and stays on the step", async () => {
    const configureAcme = vi.fn(() => Promise.resolve({ ok: true as const }))
    const acknowledgeManualSsl = vi.fn(() =>
      Promise.reject(new Error("SETUP-SSL-REJECTED"))
    )
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
        acknowledgeManualSsl={acknowledgeManualSsl}
        onNext={onNext}
      />
    )

    await screen.findByText("Certificat à gérer manuellement")
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }))
    await screen.findByText("SETUP-SSL-REJECTED")
    expect(acknowledgeManualSsl).toHaveBeenCalledTimes(1)

    // Retry must re-run the manual ack — NOT configureAcme (auto path).
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    await waitFor(() => expect(acknowledgeManualSsl).toHaveBeenCalledTimes(2))
    expect(configureAcme).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it("manual: Continue button is disabled while acknowledgeManualSsl is in flight (no double-invoke)", async () => {
    let resolve!: () => void
    const acknowledgeManualSsl = vi.fn(
      () =>
        new Promise<{ ok: true }>((res) => {
          resolve = () => res({ ok: true as const })
        })
    )
    const onNext = vi.fn()

    wrap(
      <SslStep
        hostname="mail.exemple.fr"
        contactEmail="admin@exemple.fr"
        dnsManual={true}
        configureAcme={vi.fn(() => Promise.resolve({ ok: true as const }))}
        acmeStatus={vi.fn(
          (): Promise<{ status: AcmeStatus }> =>
            Promise.resolve({ status: "pending" })
        )}
        onStatusChange={vi.fn()}
        acknowledgeManualSsl={acknowledgeManualSsl}
        onNext={onNext}
      />
    )

    await screen.findByText("Certificat à gérer manuellement")
    const continueBtn = screen.getByRole("button", { name: /Continuer/ })
    fireEvent.click(continueBtn)

    // Button must be disabled while the promise is in flight.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Continuer/ })).toBeDisabled()
    )
    expect(acknowledgeManualSsl).toHaveBeenCalledTimes(1)

    // Resolve the promise — button should re-enable and onNext fires.
    resolve()
    await waitFor(() => expect(onNext).toHaveBeenCalled())
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
        acknowledgeManualSsl={vi.fn(() =>
          Promise.resolve({ ok: true as const })
        )}
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
