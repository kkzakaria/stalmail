import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import {
  PasswordInput,
  CopyButton,
  Alert,
  TextInput,
  Progress,
} from "./primitives"

describe("PasswordInput", () => {
  it("toggles visibility", () => {
    render(
      <PasswordInput
        id="p"
        value="secret"
        onChange={() => {}}
        showLabel="show"
        hideLabel="hide"
      />
    )
    const input = document.getElementById("p") as HTMLInputElement
    expect(input.type).toBe("password")
    fireEvent.click(screen.getByRole("button", { name: "show" }))
    expect(input.type).toBe("text")
  })
})

describe("Alert", () => {
  it("renders title + role=alert", () => {
    render(
      <Alert variant="warning" title="warn">
        body
      </Alert>
    )
    expect(screen.getByRole("alert")).toHaveTextContent("warn")
    expect(screen.getByRole("alert")).toHaveTextContent("body")
  })
})

describe("CopyButton", () => {
  let originalClipboard: Clipboard

  beforeEach(() => {
    originalClipboard = navigator.clipboard
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
      writable: true,
    })
  })

  it("writes to clipboard on click", () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyButton text="abc" label="Copy" copiedLabel="Copied" />)
    fireEvent.click(screen.getByRole("button"))
    expect(writeText).toHaveBeenCalledWith("abc")
  })
})

/* ---------- Régression className (résistance au formateur) ---------- */
describe("TextInput className — résistance au formateur", () => {
  it("invalid=true mono=true → classes séparées, pas de concaténation directe", () => {
    render(<TextInput id="ti" value="" onChange={() => {}} invalid mono />)
    const el = document.getElementById("ti") as HTMLElement
    const tokens = el.className.split(/\s+/)
    expect(tokens).toContain("input")
    expect(tokens).toContain("input-invalid")
    expect(tokens).toContain("mono")
    // Garantit qu'aucune concaténation directe n'est présente
    expect(el.className).not.toContain("inputinput-invalid")
    expect(el.className).not.toContain("invalidmono")
  })

  it("invalid=false mono=false → uniquement la classe de base", () => {
    render(<TextInput id="ti2" value="" onChange={() => {}} />)
    const el = document.getElementById("ti2") as HTMLElement
    const tokens = el.className.split(/\s+/).filter(Boolean)
    expect(tokens).toEqual(["input"])
  })
})

describe("CopyButton className — résistance au formateur", () => {
  let originalClipboard: Clipboard

  beforeEach(() => {
    originalClipboard = navigator.clipboard
  })

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
      writable: true,
    })
  })

  it("small=true → copy-btn et copy-btn-sm séparés par un espace", () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyButton text="x" label="Copier" copiedLabel="Copié" small />)
    const btn = screen.getByRole("button")
    const tokens = btn.className.split(/\s+/)
    expect(tokens).toContain("copy-btn")
    expect(tokens).toContain("copy-btn-sm")
    expect(btn.className).not.toContain("copy-btncopy-btn-sm")
  })
})

describe("Progress className — résistance au formateur", () => {
  it("indeterminate=true → progress et progress-indeterminate séparés", () => {
    const { container } = render(<Progress indeterminate />)
    const el = container.firstChild as HTMLElement
    const tokens = el.className.split(/\s+/)
    expect(tokens).toContain("progress")
    expect(tokens).toContain("progress-indeterminate")
    expect(el.className).not.toContain("progressprogress-indeterminate")
  })
})
