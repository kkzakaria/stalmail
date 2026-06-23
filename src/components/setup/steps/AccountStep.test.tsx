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

  it("pressing Enter in name/password triggers exactly one submission (keyDown + form submit)", async () => {
    // In a real browser, pressing Enter in an input inside a <form> fires both:
    //   1. the onKeyDown handler → onEnter() → form.handleSubmit()
    //   2. a native form submit event → form.handleSubmit() again
    // With e.preventDefault() in TextInput.onKeyDown, the native submit is suppressed,
    // so only one createAccount call results.
    const createAccount = vi.fn(
      (_i: { name: string; password: string }): Promise<CreateAccountResult> =>
        Promise.resolve({ status: "ok" })
    )
    const { container } = wrap(
      <AccountStep
        domain="exemple.fr"
        createAccount={createAccount}
        onNext={vi.fn()}
      />
    )
    fill("koffi", "correct horse battery 9")
    const nameInput = screen.getByLabelText(NAME_LABEL)
    const formEl = container.querySelector("form")!
    // keyDown fires onEnter → form.handleSubmit(). With preventDefault, the form
    // submit event should be suppressed. Firing submit manually verifies the guard.
    const submitSpy = vi.fn((e: Event) => e.preventDefault())
    formEl.addEventListener("submit", submitSpy)
    fireEvent.keyDown(nameInput, { key: "Enter" })
    await waitFor(() => expect(createAccount).toHaveBeenCalledTimes(1))
    // The native form submit must NOT have fired (preventDefault in TextInput stops it).
    expect(submitSpy).not.toHaveBeenCalled()
    formEl.removeEventListener("submit", submitSpy)
  })

  it("TextInput.onKeyDown calls preventDefault so the native form submit does not re-fire", async () => {
    // This is the critical guard against double-submit: when Enter is pressed in an
    // input with onEnter, e.preventDefault() suppresses the browser's native form
    // submit event (which would call form.handleSubmit() a second time).
    const createAccount = vi.fn(
      (_i: { name: string; password: string }): Promise<CreateAccountResult> =>
        Promise.resolve({ status: "ok" })
    )
    const { container } = wrap(
      <AccountStep
        domain="exemple.fr"
        createAccount={createAccount}
        onNext={vi.fn()}
      />
    )
    fill("koffi", "correct horse battery 9")
    const nameInput = screen.getByLabelText(NAME_LABEL)
    const formEl = container.querySelector("form")!
    // Spy on the form's submit listener to detect if the native submit propagates.
    const submitSpy = vi.fn((e: Event) => e.preventDefault())
    formEl.addEventListener("submit", submitSpy)
    // Simulate Enter keydown — without preventDefault this would also fire a submit event.
    fireEvent.keyDown(nameInput, { key: "Enter" })
    await waitFor(() => expect(createAccount).toHaveBeenCalledTimes(1))
    // Native form submit must NOT have fired because TextInput called e.preventDefault().
    expect(submitSpy).not.toHaveBeenCalled()
    formEl.removeEventListener("submit", submitSpy)
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
