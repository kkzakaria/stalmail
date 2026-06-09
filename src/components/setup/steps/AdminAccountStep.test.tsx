import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { AdminAccountStep } from './AdminAccountStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

// The fr translation uses U+2019 curly apostrophe: 'Nom d’utilisateur'
const LABEL_NAME = 'Nom d’utilisateur'

describe('AdminAccountStep', () => {
  it('submits a valid account and shows a strength label', async () => {
    const onNext = vi.fn()
    wrap(<AdminAccountStep defaults={{}} domain="exemple.fr" onNext={onNext} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(LABEL_NAME), { target: { value: 'koffi' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct horse battery 9' } })
    expect(screen.getByText('Fort')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(onNext).toHaveBeenCalledWith({ name: 'koffi', password: 'correct horse battery 9' }))
  })

  it('shows the derived email from name + domain', () => {
    wrap(<AdminAccountStep defaults={{ name: 'koffi' }} domain="exemple.fr" onNext={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByText('koffi@exemple.fr')).toBeInTheDocument()
  })
})
