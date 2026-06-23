import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import { RestartScreen } from "./RestartScreen"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

describe("RestartScreen", () => {
  it('polls getStep and calls onReady once it leaves "collect"', async () => {
    const steps = ["collect", "collect", "account"]
    const poll = vi.fn(async () => ({ step: steps.shift() ?? "account" }))
    const onReady = vi.fn()
    wrap(<RestartScreen poll={poll} intervalMs={5} onReady={onReady} />)
    expect(screen.getByText("Configuration en cours")).toBeInTheDocument()
    await waitFor(() => expect(onReady).toHaveBeenCalledWith("account"))
    // The poll log renders at least one line.
    expect(document.querySelectorAll(".poll-line").length).toBeGreaterThan(0)
  })

  it("renders a SetupErrorBox (timeout code) with a Retry button once the soft timeout elapses", async () => {
    const poll = vi.fn(async () => ({ step: "collect" }))
    const onReady = vi.fn()
    wrap(
      <RestartScreen
        poll={poll}
        intervalMs={5}
        timeoutMs={0}
        onReady={onReady}
      />
    )
    await waitFor(() =>
      expect(screen.getByText("SETUP-RESTART-TIMEOUT")).toBeInTheDocument()
    )
    expect(
      screen.getByText("Le serveur met trop de temps à répondre.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Réessayer" })
    ).toBeInTheDocument()
    expect(onReady).not.toHaveBeenCalled()
  })
})
