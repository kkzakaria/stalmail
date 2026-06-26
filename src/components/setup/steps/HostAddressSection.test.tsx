// src/components/setup/steps/HostAddressSection.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import type { DnsGridRecord } from "@/server/setup-actions"
import { HostAddressSection } from "./HostAddressSection"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

const recs: DnsGridRecord[] = [
  {
    name: "mail.exemple.fr.",
    type: "A",
    value: "203.0.113.4",
    status: "pending",
  },
  { name: "exemple.fr.", type: "A", value: "203.0.113.4", status: "verified" },
]

describe("HostAddressSection", () => {
  it("affiche le titre et les enregistrements A en mode ready", () => {
    wrap(
      <HostAddressSection
        records={recs}
        status="ready"
        domain="exemple.fr"
        onManualIp={vi.fn()}
      />
    )
    expect(screen.getByText("Adresse du serveur")).toBeInTheDocument()
    expect(screen.getAllByText("203.0.113.4").length).toBeGreaterThan(0)
  })

  it("affiche un spinner pendant la détection (loading)", () => {
    wrap(
      <HostAddressSection
        records={[]}
        status="loading"
        domain="exemple.fr"
        onManualIp={vi.fn()}
      />
    )
    expect(screen.getByText(/Détection de l'adresse IP/)).toBeInTheDocument()
  })

  it("en échec : saisir une IP valide appelle onManualIp", () => {
    const onManualIp = vi.fn()
    wrap(
      <HostAddressSection
        records={[]}
        status="failed"
        domain="exemple.fr"
        onManualIp={onManualIp}
      />
    )
    fireEvent.change(screen.getByLabelText("Adresse IP du serveur"), {
      target: { value: "203.0.113.4" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Valider" }))
    expect(onManualIp).toHaveBeenCalledWith("203.0.113.4")
  })

  it("en échec : une IP invalide affiche une erreur et n'appelle pas onManualIp", () => {
    const onManualIp = vi.fn()
    wrap(
      <HostAddressSection
        records={[]}
        status="failed"
        domain="exemple.fr"
        onManualIp={onManualIp}
      />
    )
    fireEvent.change(screen.getByLabelText("Adresse IP du serveur"), {
      target: { value: "nope" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Valider" }))
    expect(onManualIp).not.toHaveBeenCalled()
    expect(screen.getByText("Adresse IP invalide.")).toBeInTheDocument()
  })
})
