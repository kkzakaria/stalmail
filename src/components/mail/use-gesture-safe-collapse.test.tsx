import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { useState } from "react"
import { useGestureSafeCollapse } from "./use-gesture-safe-collapse"

function Harness() {
  const [ouverte, setOuverte] = useState(true)
  const collapseAfterGesture = useGestureSafeCollapse()
  return (
    <div>
      <button
        type="button"
        onClick={() => collapseAfterGesture(() => setOuverte(false))}
      >
        replier
      </button>
      <button type="button">cible</button>
      <span data-testid="etat">{ouverte ? "ouverte" : "fermée"}</span>
    </div>
  )
}

describe("useGestureSafeCollapse", () => {
  it("hors geste : replie immédiatement", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "replier" }))
    expect(screen.getByTestId("etat")).toHaveTextContent("fermée")
  })

  it("geste en cours : ne replie pas avant le relâchement", () => {
    vi.useFakeTimers()
    try {
      render(<Harness />)
      const cible = screen.getByRole("button", { name: "cible" })
      fireEvent.pointerDown(cible)
      fireEvent.click(screen.getByRole("button", { name: "replier" }))
      expect(screen.getByTestId("etat")).toHaveTextContent("ouverte")
      fireEvent.pointerUp(cible)
      act(() => {
        vi.runAllTimers()
      })
      expect(screen.getByTestId("etat")).toHaveTextContent("fermée")
    } finally {
      vi.useRealTimers()
    }
  })

  it("geste annulé (pointercancel) : replie quand même", () => {
    vi.useFakeTimers()
    try {
      render(<Harness />)
      const cible = screen.getByRole("button", { name: "cible" })
      fireEvent.pointerDown(cible)
      fireEvent.click(screen.getByRole("button", { name: "replier" }))
      fireEvent.pointerCancel(cible)
      act(() => {
        vi.runAllTimers()
      })
      expect(screen.getByTestId("etat")).toHaveTextContent("fermée")
    } finally {
      vi.useRealTimers()
    }
  })
})
