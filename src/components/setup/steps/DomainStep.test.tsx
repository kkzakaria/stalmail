import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { DomainStep } from './DomainStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

const HOSTNAME_LABEL = 'Nom d’hôte du serveur'
const DOMAIN_LABEL = 'Domaine par défaut'
const NEXT_LABEL = 'Continuer'
const EXT_TITLE = "Nom d'hôte hors du domaine par défaut"

describe('DomainStep', () => {
  it('shows the invalid hostname error on submit and does not call onNext', async () => {
    const onNext = vi.fn()
    wrap(<DomainStep defaults={{}} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(HOSTNAME_LABEL), {
      target: { value: 'nope' },
    })
    fireEvent.change(screen.getByLabelText(DOMAIN_LABEL), {
      target: { value: 'exemple.fr' },
    })
    fireEvent.click(screen.getByRole('button', { name: NEXT_LABEL }))
    await waitFor(() =>
      expect(
        screen.getByText("Format de nom d'hôte invalide."),
      ).toBeInTheDocument(),
    )
    expect(onNext).not.toHaveBeenCalled()
  })

  it('renders the external-zone warning when the host is outside the domain', () => {
    wrap(<DomainStep defaults={{}} onNext={vi.fn()} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(HOSTNAME_LABEL), {
      target: { value: 'mail.autre.fr' },
    })
    fireEvent.change(screen.getByLabelText(DOMAIN_LABEL), {
      target: { value: 'dupont.fr' },
    })
    expect(screen.getByText(EXT_TITLE)).toBeInTheDocument()
  })

  it('submits valid same-zone values via onNext', async () => {
    const onNext = vi.fn()
    wrap(<DomainStep defaults={{}} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(HOSTNAME_LABEL), {
      target: { value: 'mail.dupont.fr' },
    })
    fireEvent.change(screen.getByLabelText(DOMAIN_LABEL), {
      target: { value: 'dupont.fr' },
    })
    expect(screen.queryByText(EXT_TITLE)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: NEXT_LABEL }))
    await waitFor(() =>
      expect(onNext).toHaveBeenCalledWith({
        serverHostname: 'mail.dupont.fr',
        defaultDomain: 'dupont.fr',
      }),
    )
  })
})
