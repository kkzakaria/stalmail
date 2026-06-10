import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { SetupWizard } from './SetupWizard'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

const monitorProps = () => ({
  createAccount: vi.fn().mockResolvedValue({ status: 'ok' as const }),
  createDnsServer: vi.fn().mockResolvedValue({ dnsServerId: 's1' }),
  setDnsManagement: vi.fn().mockResolvedValue({ ok: true as const }),
  gridStatus: vi.fn().mockResolvedValue({ origin: 'x', records: [] }),
  configureAcme: vi.fn().mockResolvedValue({ ok: true as const }),
  acmeStatus: vi.fn().mockResolvedValue({ status: 'pending' as const }),
  finishSetup: vi.fn().mockResolvedValue({ ok: true as const }),
})

describe('SetupWizard', () => {
  it('renders the card shell: welcome screen, header lang/theme, and a 9-dot stepper', () => {
    const { container } = wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...monitorProps()}
      />,
    )
    // Welcome screen
    expect(screen.getByText('Bienvenue sur Stalmail')).toBeInTheDocument()
    // Header: language select + theme toggle
    expect(screen.getByLabelText('Langue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Passer au thème sombre' })).toBeInTheDocument()
    // Stepper renders all 9 dots
    expect(container.querySelectorAll('.step-dot')).toHaveLength(9)
  })

  it('flips the wizard root data-theme when the theme toggle is clicked', () => {
    const { container } = wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...monitorProps()}
      />,
    )
    const root = container.querySelector('.stalmail-wizard') as HTMLElement
    expect(root.getAttribute('data-theme')).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Passer au thème sombre' }))
    expect(root.getAttribute('data-theme')).toBe('dark')
  })

  it('walks the collect phase and submits the bootstrap', async () => {
    const submitBootstrap = vi.fn().mockResolvedValue(undefined)
    const poll = vi.fn().mockResolvedValue({ step: 'account' })
    wrap(
      <SetupWizard
        initialStep="collect"
        initialTheme="light"
        submitBootstrap={submitBootstrap}
        pollStep={poll}
        {...monitorProps()}
      />,
    )

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

  it('renders the AccountStep when initialStep is account, then advances to the DnsStep', async () => {
    wrap(
      <SetupWizard
        initialStep="account"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...monitorProps()}
      />,
    )
    // AccountStep renders (its title), and reaches the done status after the mocked create.
    expect(screen.getByText('Compte administrateur')).toBeInTheDocument()
    await screen.findByText('Continuer')
    // Advancing reaches the DnsStep (step 7).
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    await screen.findByText('Enregistrements DNS')
  })

  it('renders the SslStep when initialStep is ssl, then advances to the DoneStep', async () => {
    wrap(
      <SetupWizard
        initialStep="ssl"
        initialTheme="light"
        submitBootstrap={vi.fn()}
        pollStep={vi.fn()}
        {...monitorProps()}
      />,
    )
    // SslStep configures then reaches the monitor recap (non-blocking note).
    await screen.findByText('Certificat SSL')
    await screen.findByText(/Stalwart réessaiera automatiquement/)
    // Advancing reaches the DoneStep (step 9).
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    await screen.findByText('Votre serveur est prêt')
  })
})
