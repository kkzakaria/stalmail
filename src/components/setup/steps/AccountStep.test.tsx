import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import type { CreateAccountResult } from "@/server/setup-actions"
import { AccountStep } from "./AccountStep"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

const NAME_LABEL = "Nom d’utilisateur"
const PASS_LABEL = "Mot de passe"

const fill = (name: string, password: string) => {
  fireEvent.change(screen.getByLabelText(NAME_LABEL), {
    target: { value: name },
  })
  fireEvent.change(screen.getByLabelText(PASS_LABEL), {
    target: { value: password },
  })
}

describe("AccountStep", () => {
  it('rejects the reserved "admin" username', async () => {
    const createAccount = vi.fn()
    wrap(
      <AccountStep
        domain="exemple.fr"
        createAccount={createAccount}
        onNext={vi.fn()}
      />
    )
    fill("admin", "correct horse battery 9")
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))
    await waitFor(() =>
      expect(screen.getByText(/réservé au compte système/)).toBeInTheDocument()
    )
    expect(createAccount).not.toHaveBeenCalled()
  })

  it("collects name+password, creates the account, then advances on Continue", async () => {
    const createAccount = vi.fn(
      (_i: { name: string; password: string }): Promise<CreateAccountResult> =>
        Promise.resolve({ status: "ok" })
    )
    const onNext = vi.fn()
    wrap(
      <AccountStep
        domain="exemple.fr"
        createAccount={createAccount}
        onNext={onNext}
      />
    )
    fill("koffi", "correct horse battery 9")
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    expect(
      await screen.findByText("Compte koffi@exemple.fr créé.")
    ).toBeInTheDocument()
    expect(createAccount).toHaveBeenCalledWith({
      name: "koffi",
      password: "correct horse battery 9",
    })
    fireEvent.click(screen.getByRole("button", { name: /Continuer/ }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it("weak path: retry with a stronger password reaches done", async () => {
    const createAccount = vi
      .fn(
        (_i: {
          name: string
          password: string
        }): Promise<CreateAccountResult> => Promise.resolve({ status: "ok" })
      )
      .mockResolvedValueOnce({ status: "weak" })
      .mockResolvedValueOnce({ status: "ok" })
    wrap(
      <AccountStep
        domain="exemple.fr"
        createAccount={createAccount}
        onNext={vi.fn()}
      />
    )
    fill("koffi", "weakpass1")
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    expect(await screen.findByText("Mot de passe refusé")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), {
      target: { value: "BrandNewPass99" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Créer le compte/ }))

    expect(
      await screen.findByText("Compte koffi@exemple.fr créé.")
    ).toBeInTheDocument()
    expect(createAccount).toHaveBeenNthCalledWith(2, {
      name: "koffi",
      password: "BrandNewPass99",
    })
  })

  it("server rejection shows a SetupErrorBox (distinct from the weak loop)", async () => {
    const createAccount = vi.fn(
      (_i: { name: string; password: string }): Promise<CreateAccountResult> =>
        Promise.reject(new Error("SETUP-ACCOUNT-REJECTED"))
    )
    wrap(
      <AccountStep
        domain="exemple.fr"
        createAccount={createAccount}
        onNext={vi.fn()}
      />
    )
    fill("koffi", "correct horse battery 9")
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    expect(
      await screen.findByText("SETUP-ACCOUNT-REJECTED")
    ).toBeInTheDocument()
    expect(
      screen.getByText("La création du compte administrateur a échoué.")
    ).toBeInTheDocument()
  })
})
