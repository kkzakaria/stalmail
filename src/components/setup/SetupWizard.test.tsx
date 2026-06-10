import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { SetupWizard } from './SetupWizard'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('SetupWizard', () => {
  it('walks the collect phase and submits the bootstrap', async () => {
    const submitBootstrap = vi.fn().mockResolvedValue(undefined)
    const poll = vi.fn().mockResolvedValue({ step: 'account' })
    wrap(<SetupWizard initialStep="collect" submitBootstrap={submitBootstrap} pollStep={poll} />)

    fireEvent.click(screen.getByRole('button', { name: 'Commencer' }))
    fireEvent.change(screen.getByLabelText('Nom d’hôte du serveur'), { target: { value: 'mail.exemple.fr' } })
    fireEvent.change(screen.getByLabelText('Domaine par défaut'), { target: { value: 'exemple.fr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    // DNS step (Manual default, combobox) → manual note shown, advance via Continuer
    await screen.findByText('Fournisseur DNS')
    expect(
      screen.getByText(
        "À l'étape 7, le wizard affichera les enregistrements à copier chez votre fournisseur.",
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    // Account step
    await screen.findByText('Compte administrateur')
    fireEvent.change(screen.getByLabelText('Nom d’utilisateur'), { target: { value: 'koffi' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct horse battery 9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    // Recap → Configurer le serveur (use the unique submit button to detect the recap screen)
    await screen.findByRole('button', { name: 'Configurer le serveur' })
    fireEvent.click(screen.getByRole('button', { name: 'Configurer le serveur' }))
    await waitFor(() =>
      expect(submitBootstrap).toHaveBeenCalledWith({ serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' }),
    )
    // restart screen appears
    await screen.findByText('Configuration en cours')
  })

  it('starts directly in the monitoring placeholder when initialStep is account', () => {
    wrap(<SetupWizard initialStep="account" submitBootstrap={vi.fn()} pollStep={vi.fn()} />)
    expect(screen.getByTestId('monitor-step').textContent).toBe('account')
  })
})
