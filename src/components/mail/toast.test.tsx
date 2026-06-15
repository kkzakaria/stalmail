import { describe, expect, it } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { ToastProvider, useToast } from "./toast"

function Trigger() {
  const notify = useToast()
  return <button onClick={() => notify("Bonjour", "success")}>go</button>
}

describe("ToastProvider / useToast", () => {
  it("affiche le message (.toast-msg) + bouton de fermeture après notify", () => {
    const { container } = render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
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
      <ToastProvider>
        <Trigger />
      </ToastProvider>
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
