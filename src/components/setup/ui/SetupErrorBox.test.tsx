import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import { SetupErrorBox } from "./SetupErrorBox"

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)
}

describe("SetupErrorBox", () => {
  it("affiche le message localisé correspondant à la messageKey", () => {
    wrap(
      <SetupErrorBox
        code="ERR_001"
        messageKey="wizard.error.title"
        onRetry={() => {}}
      />
    )
    expect(screen.getByText("Une erreur est survenue")).toBeTruthy()
  })

  it("affiche le code brut", () => {
    wrap(
      <SetupErrorBox
        code="ERR_DOMAIN_CONFLICT"
        messageKey="wizard.error.title"
        onRetry={() => {}}
      />
    )
    expect(screen.getByText("ERR_DOMAIN_CONFLICT")).toBeTruthy()
  })

  it("appelle onRetry au clic sur le bouton Réessayer", () => {
    const onRetry = vi.fn()
    wrap(
      <SetupErrorBox
        code="ERR_001"
        messageKey="wizard.error.title"
        onRetry={onRetry}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("a le rôle alert", () => {
    wrap(
      <SetupErrorBox
        code="ERR_001"
        messageKey="wizard.error.title"
        onRetry={() => {}}
      />
    )
    expect(screen.getByRole("alert")).toBeTruthy()
  })
})
