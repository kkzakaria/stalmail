import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { RteEditor } from "./rte-editor"

// Mock useTranslation : retourne des libellés français pour les clés mail.compose.*
// Les vraies traductions sont ajoutées en Task 14 — ici on ne dépend pas des ressources.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "mail.compose.bold": "Gras",
        "mail.compose.italic": "Italique",
        "mail.compose.link": "Lien",
        "mail.compose.linkPrompt": "URL du lien",
        "mail.compose.bulletList": "Liste à puces",
        "mail.compose.numberList": "Liste numérotée",
      }
      return labels[key] ?? key
    },
  }),
}))

describe("RteEditor", () => {
  it("rend la zone éditable ; la toolbar est masquée par défaut, visible si showToolbar", () => {
    const { rerender } = render(
      <RteEditor value="" onChange={() => {}} ariaLabel="Corps du message" />
    )
    expect(screen.getByLabelText("Corps du message")).toBeInTheDocument()
    // Masquée par défaut (togglée par « Aa » dans le parent).
    expect(
      screen.queryByRole("button", { name: /gras/i })
    ).not.toBeInTheDocument()
    rerender(
      <RteEditor
        value=""
        onChange={() => {}}
        ariaLabel="Corps du message"
        showToolbar
      />
    )
    expect(screen.getByRole("button", { name: /gras/i })).toBeInTheDocument()
  })

  it("émet le HTML brut à la frappe (P1 : pas de sanitize à chaque onInput)", () => {
    const onChange = vi.fn()
    render(<RteEditor value="" onChange={onChange} ariaLabel="Corps" />)
    const editable = screen.getByLabelText("Corps")
    editable.innerHTML = "<p>bonjour</p>"
    fireEvent.input(editable)
    expect(onChange).toHaveBeenLastCalledWith("<p>bonjour</p>")
  })

  it("injecte une value (citation) sanitisée — barrière B1 à l'injection", () => {
    render(
      <RteEditor
        value='<p>cite</p><script>alert(1)</script><img src=x onerror="alert(1)">'
        onChange={() => {}}
        ariaLabel="Corps"
      />
    )
    const editable = screen.getByLabelText("Corps")
    expect(editable.innerHTML).toContain("cite")
    expect(editable.innerHTML).not.toContain("script")
    expect(editable.innerHTML).not.toContain("onerror")
    expect(editable.innerHTML).not.toContain("<img")
  })

  it("addLink ignore une URL au schéma javascript: (anti-XSS)", () => {
    // jsdom ne définit pas document.execCommand — on le définit pour pouvoir l'espionner
    Object.defineProperty(document, "execCommand", {
      value: () => true,
      writable: true,
      configurable: true,
    })
    const exec = vi.spyOn(document, "execCommand").mockReturnValue(true)
    const prompt = vi
      .spyOn(window, "prompt")
      .mockReturnValue("javascript:alert(1)")
    render(
      <RteEditor value="" onChange={() => {}} ariaLabel="Corps" showToolbar />
    )
    fireEvent.click(screen.getByRole("button", { name: /lien/i }))
    expect(exec).not.toHaveBeenCalledWith("createLink", expect.anything())
    prompt.mockReturnValue("https://exemple.fr")
    fireEvent.click(screen.getByRole("button", { name: /lien/i }))
    expect(exec).toHaveBeenCalledWith(
      "createLink",
      false,
      "https://exemple.fr/"
    )
    exec.mockRestore()
    prompt.mockRestore()
  })
})

// Note : le `onPaste` sanitise via document.execCommand('insertHTML'), no-op sous jsdom —
// la défense B1 au collage est donc couverte par revue de code + la barrière serveur
// autoritaire (Task 1 + Task 9), pas par ce test composant.
