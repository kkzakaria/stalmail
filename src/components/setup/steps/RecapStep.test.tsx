import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { RecapStep } from './RecapStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

const data = {
  serverHostname: 'mail.exemple.fr',
  defaultDomain: 'exemple.fr',
  provider: 'Manual',
  name: 'koffi',
}

const SUBMIT = 'Configurer le serveur'

describe('RecapStep', () => {
  it('renders the collected data values', () => {
    wrap(
      <RecapStep data={data} onSubmit={vi.fn()} onBack={vi.fn()} goTo={vi.fn()} />,
    )
    expect(screen.getByText('mail.exemple.fr')).toBeInTheDocument()
    expect(screen.getByText('exemple.fr')).toBeInTheDocument()
    expect(screen.getByText('koffi@exemple.fr')).toBeInTheDocument()
  })

  it('calls goTo with the row target when its Edit button is clicked', () => {
    const goTo = vi.fn()
    wrap(<RecapStep data={data} onSubmit={vi.fn()} onBack={vi.fn()} goTo={goTo} />)
    // Rows: hostname, domain, dns, account → DNS row is the 3rd Edit button.
    const editButtons = screen.getAllByRole('button', { name: 'Modifier' })
    fireEvent.click(editButtons[2])
    expect(goTo).toHaveBeenCalledWith('dns')
  })

  it('calls onSubmit when the submit button is clicked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    wrap(
      <RecapStep data={data} onSubmit={onSubmit} onBack={vi.fn()} goTo={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  it('shows the error alert + a Retry button that re-invokes onSubmit when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    wrap(
      <RecapStep data={data} onSubmit={onSubmit} onBack={vi.fn()} goTo={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText('boom')).toBeInTheDocument()
    const retry = await screen.findByRole('button', { name: 'Réessayer' })
    fireEvent.click(retry)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })
})
