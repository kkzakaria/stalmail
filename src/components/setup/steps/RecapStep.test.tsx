import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { RecapStep } from './RecapStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

const data = { serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr', provider: 'Manual', name: 'koffi' }
const dataNoName = { serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr', provider: 'Manual' }

describe('RecapStep', () => {
  it('calls onSubmit (which submits the bootstrap) and surfaces success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    wrap(<RecapStep data={data} onSubmit={onSubmit} onBack={vi.fn()} />)
    expect(screen.getByText('mail.exemple.fr')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Configurer' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  it('shows an error and a retry button when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    wrap(<RecapStep data={data} onSubmit={onSubmit} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configurer' }))
    await waitFor(() => expect(screen.getByText('Réessayer')).toBeInTheDocument())
  })

  it('does not render an "@domain" string when name is missing', () => {
    wrap(<RecapStep data={dataNoName} onSubmit={vi.fn().mockResolvedValue(undefined)} onBack={vi.fn()} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/@exemple/)
  })
})
