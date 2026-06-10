import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { AdminAccountStep } from './AdminAccountStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

// The fr translation uses U+2019 curly apostrophe: 'Nom d’utilisateur'
const LABEL_NAME = 'Nom d’utilisateur'
const LABEL_PASSWORD = 'Mot de passe'

describe('AdminAccountStep', () => {
  it('updates the derived email help text when typing a name', () => {
    wrap(
      <AdminAccountStep
        defaults={{}}
        domain="exemple.fr"
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    // Default derives admin@domain.
    expect(screen.getByText('Adresse : admin@exemple.fr')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(LABEL_NAME), {
      target: { value: 'koffi' },
    })
    expect(screen.getByText('Adresse : koffi@exemple.fr')).toBeInTheDocument()
  })

  it('shows invalidPassword and does not call onNext for a short password', async () => {
    const onNext = vi.fn()
    wrap(
      <AdminAccountStep
        defaults={{}}
        domain="exemple.fr"
        onNext={onNext}
        onBack={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(LABEL_NAME), {
      target: { value: 'koffi' },
    })
    fireEvent.change(screen.getByLabelText(LABEL_PASSWORD), {
      target: { value: 'short' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    await waitFor(() =>
      expect(screen.getByText('8 caractères minimum.')).toBeInTheDocument(),
    )
    expect(onNext).not.toHaveBeenCalled()
  })

  it('shows the strength label when typing a password', () => {
    wrap(
      <AdminAccountStep
        defaults={{}}
        domain="exemple.fr"
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(LABEL_PASSWORD), {
      target: { value: 'correct horse battery 9' },
    })
    expect(screen.getByText('Fort')).toBeInTheDocument()
  })

  it('calls onNext with valid name + password', async () => {
    const onNext = vi.fn()
    wrap(
      <AdminAccountStep
        defaults={{}}
        domain="exemple.fr"
        onNext={onNext}
        onBack={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(LABEL_NAME), {
      target: { value: 'koffi' },
    })
    fireEvent.change(screen.getByLabelText(LABEL_PASSWORD), {
      target: { value: 'correct horse battery 9' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    await waitFor(() =>
      expect(onNext).toHaveBeenCalledWith({
        name: 'koffi',
        password: 'correct horse battery 9',
      }),
    )
  })
})
