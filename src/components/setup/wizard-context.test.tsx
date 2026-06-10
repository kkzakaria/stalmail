import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WizardProvider, useWizard } from './wizard-context'

function Probe() {
  const { data, setData } = useWizard()
  return (
    <div>
      <span data-testid="host">{data.serverHostname ?? '-'}</span>
      <button onClick={() => setData({ serverHostname: 'mail.exemple.fr' })}>set</button>
    </div>
  )
}

describe('useWizard', () => {
  it('accumulates collected values', () => {
    render(
      <WizardProvider>
        <Probe />
      </WizardProvider>,
    )
    expect(screen.getByTestId('host').textContent).toBe('-')
    fireEvent.click(screen.getByText('set'))
    expect(screen.getByTestId('host').textContent).toBe('mail.exemple.fr')
  })
})
