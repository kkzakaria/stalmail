import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Icon, Avatar, initialsOf, hashColor } from "./mail-icons"

describe("initialsOf", () => {
  it("prend les 2 premières initiales", () => {
    expect(initialsOf("Alice Martin")).toBe("AM")
    expect(initialsOf("Bob")).toBe("B")
    expect(initialsOf("")).toBe("?")
  })
})

describe("hashColor", () => {
  it("est stable par entrée", () => {
    expect(hashColor("a@x.fr")).toBe(hashColor("a@x.fr"))
  })
  it("renvoie une couleur CSS", () => {
    expect(hashColor("a@x.fr")).toMatch(/^(hsl|#)/)
  })
})

describe("Icon", () => {
  it("rend un svg pour un nom connu", () => {
    const { container } = render(<Icon name="inbox" />)
    expect(container.querySelector("svg")).toBeInTheDocument()
  })
})

describe("Avatar", () => {
  it("affiche les initiales", () => {
    render(<Avatar name="Alice Martin" email="a@x.fr" />)
    expect(screen.getByText("AM")).toBeInTheDocument()
  })
})

describe("Icon — nouvelles icônes 4b", () => {
  const names = [
    "archive",
    "trash2",
    "mail-open",
    "more-v",
    "chev-left",
    "spam",
    "download",
    "x",
    "reply",
  ]
  it.each(names)('rend un <svg> non vide pour "%s"', (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg!.innerHTML.length).toBeGreaterThan(0)
  })
})
