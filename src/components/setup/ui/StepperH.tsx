import { IconCheck } from "./icons"

interface Step {
  n: number
  label: string
}
interface Props {
  steps: Step[]
  current: number
}

export function StepperH({ steps, current }: Props) {
  return (
    <div className="stepper-h">
      <div className="stepper-h-dots">
        {steps.map((s) => {
          const state =
            s.n < current ? "done" : s.n === current ? "current" : "todo"
          return (
            <div
              key={s.n}
              className={"step-dot step-dot-" + state}
              title={s.label}
            >
              {state === "done" ? (
                <IconCheck size={11} strokeWidth={2.5} />
              ) : (
                s.n
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
