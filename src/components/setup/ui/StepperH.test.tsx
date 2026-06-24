import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { StepperH } from "./StepperH"

const steps = [
  { n: 1, label: "Bienvenue" },
  { n: 2, label: "Domaine" },
  { n: 3, label: "DNS" },
  { n: 4, label: "SSL" },
  { n: 5, label: "Compte" },
  { n: 6, label: "Terminé" },
]

describe("StepperH", () => {
  it("rend N étapes en séquence linéaire", () => {
    const { container } = render(<StepperH steps={steps} current={3} />)
    expect(container.querySelectorAll(".step-dot")).toHaveLength(6)
    // No group separator anymore.
    expect(container.querySelector(".stepper-h-group")).toBeNull()
    expect(container.querySelector(".stepper-h-glabel")).toBeNull()
  })

  it("marque les étapes done / current / todo", () => {
    const { container } = render(<StepperH steps={steps} current={3} />)
    // Steps 1 & 2 done, 3 current, the rest todo.
    expect(container.querySelectorAll(".step-dot-done")).toHaveLength(2)
    expect(container.querySelectorAll(".step-dot-current")).toHaveLength(1)
    expect(container.querySelectorAll(".step-dot-todo")).toHaveLength(3)
  })

  it("numérote les étapes todo", () => {
    const { container } = render(<StepperH steps={steps} current={1} />)
    const dots = Array.from(container.querySelectorAll(".step-dot-todo"))
    expect(dots.map((d) => d.textContent)).toEqual(["2", "3", "4", "5", "6"])
  })
})
