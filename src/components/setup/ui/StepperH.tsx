import { IconCheck } from './icons'

interface Step { n: number; label: string; group: 'config' | 'activation' }
interface Props { steps: Step[]; current: number; groupLabels: { config: string; activation: string } }

const GROUPS: Array<{ id: 'config' | 'activation'; sep: boolean }> = [
  { id: 'config',     sep: false },
  { id: 'activation', sep: true  },
]

export function StepperH({ steps, current, groupLabels }: Props) {
  return (
    <div className="stepper-h">
      {GROUPS.map(({ id, sep }) => {
        const isCurrent = steps.some((s) => s.group === id && s.n === current)
        return (
          <div key={id} className={'stepper-h-group' + (sep ? ' stepper-h-group-sep' : '')}>
            <span className={'stepper-h-glabel' + (isCurrent ? ' is-current' : '')}>
              {groupLabels[id]}
            </span>
            <div className="stepper-h-dots">
              {steps
                .filter((s) => s.group === id)
                .map((s) => {
                  const state = s.n < current ? 'done' : s.n === current ? 'current' : 'todo'
                  return (
                    <div
                      key={s.n}
                      className={'step-dot step-dot-' + state}
                      title={s.label}
                    >
                      {state === 'done' ? <IconCheck size={11} strokeWidth={2.5} /> : s.n}
                    </div>
                  )
                })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
