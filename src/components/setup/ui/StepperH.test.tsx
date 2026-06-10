import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { StepperH } from './StepperH'

const steps = [
  { n: 1, label: 'Welcome', group: 'config' as const },
  { n: 2, label: 'Domain', group: 'config' as const },
  { n: 6, label: 'Account', group: 'activation' as const },
]

describe('StepperH', () => {
  it('marks done/current dots', () => {
    const { container } = render(
      <StepperH steps={steps} current={2} groupLabels={{ config: 'Configuration', activation: 'Activation' }} />,
    )
    expect(container.querySelector('.step-dot-done')).toBeTruthy() // step 1
    expect(container.querySelector('.step-dot-current')).toBeTruthy() // step 2
  })
  it('highlights the active group label', () => {
    const { container } = render(
      <StepperH steps={steps} current={2} groupLabels={{ config: 'Configuration', activation: 'Activation' }} />,
    )
    expect(container.querySelector('.stepper-h-glabel.is-current')?.textContent).toBe('Configuration')
  })
})
