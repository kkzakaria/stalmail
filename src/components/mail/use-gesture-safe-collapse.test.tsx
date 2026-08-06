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

// Harnais démontable : expose le `collapse` différé pour vérifier qu'il n'est
// pas appelé si le composant démonte avant la fin du geste.
function HarnaisAvecEspion({ collapse }: { collapse: () => void }) {
  const collapseAfterGesture = useGestureSafeCollapse()
  return (
    <div>
      <button type="button" onClick={() => collapseAfterGesture(collapse)}>
        replier
      </button>
      <button type="button">cible</button>
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
      // Le repli doit rester en attente jusqu'après la délivrance du clic :
      // un repli synchrone ici serait le défaut que le report doit empêcher.
      expect(screen.getByTestId("etat")).toHaveTextContent("ouverte")
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

  it("composant démonté pendant le geste : le repli différé ne s'exécute pas (fuite d'écouteur)", () => {
    vi.useFakeTimers()
    try {
      const collapse = vi.fn()
      const { unmount } = render(<HarnaisAvecEspion collapse={collapse} />)
      const cible = screen.getByRole("button", { name: "cible" })
      fireEvent.pointerDown(cible)
      fireEvent.click(screen.getByRole("button", { name: "replier" }))
      // Démonté AVANT le pointerup attendu : le report doit être annulé, pas
      // laissé en attente sur `document`.
      unmount()
      // Dispatché sur `document`, pas sur `cible` : `cible` est détachée du
      // document après unmount() et ne remonte plus jusqu'à l'écouteur
      // global — seul un dispatch sur `document` lui-même est discriminant.
      fireEvent.pointerUp(document)
      act(() => {
        vi.runAllTimers()
      })
      expect(collapse).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
