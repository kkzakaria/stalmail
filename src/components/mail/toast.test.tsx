import { describe, expect, it } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "../../i18n/i18n"
import { ToastProvider, ToastViewport, useToast } from "./toast"

function Trigger() {
  const notify = useToast()
  return <button onClick={() => notify("Bonjour", "success")}>go</button>
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <I18nextProvider i18n={createI18n("fr")}>
      <ToastProvider>
        {children}
        <ToastViewport />
      </ToastProvider>
    </I18nextProvider>
  )
}

describe("ToastProvider / useToast", () => {
  it("affiche le message (.toast-msg) + bouton de fermeture après notify", () => {
    const { container } = render(
      <Wrapper>
        <Trigger />
      </Wrapper>
    )
    act(() => {
      screen.getByText("go").click()
    })
    expect(
      container.querySelector(".toast-wrap .toast .toast-msg")?.textContent
    ).toBe("Bonjour")
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument()
  })

  it("le bouton OK ferme le toast", () => {
    render(
      <Wrapper>
        <Trigger />
      </Wrapper>
    )
    act(() => {
      screen.getByText("go").click()
    })
    act(() => {
      screen.getByRole("button", { name: "OK" }).click()
    })
    expect(screen.queryByText("Bonjour")).not.toBeInTheDocument()
  })

  it("useToast hors provider est un no-op (ne jette pas)", () => {
    function Bare() {
      const notify = useToast()
      return <button onClick={() => notify("x")}>b</button>
    }
    render(<Bare />)
    act(() => {
      screen.getByText("b").click()
    })
    expect(screen.queryByText("x")).not.toBeInTheDocument()
  })
})
