import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { DomainStep } from './DomainStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('DomainStep', () => {
  it('submits valid hostname + domain via onNext', async () => {
    const onNext = vi.fn()
    wrap(<DomainStep defaults={{}} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Nom d’hôte public'), { target: { value: 'mail.exemple.fr' } })
    fireEvent.change(screen.getByLabelText('Domaine email'), { target: { value: 'exemple.fr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() =>
      expect(onNext).toHaveBeenCalledWith({ serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' }),
    )
  })

  it('does not advance with an invalid hostname', async () => {
    const onNext = vi.fn()
    wrap(<DomainStep defaults={{}} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Nom d’hôte public'), { target: { value: 'nope' } })
    fireEvent.change(screen.getByLabelText('Domaine email'), { target: { value: 'exemple.fr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(onNext).not.toHaveBeenCalled())
  })
})
