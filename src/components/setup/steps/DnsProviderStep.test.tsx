import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { DnsProviderStep } from './DnsProviderStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

function openCombobox() {
  fireEvent.click(screen.getByRole('button', { expanded: false }))
}

describe('DnsProviderStep', () => {
  it('reveals the secret field when a real provider is selected', async () => {
    wrap(
      <DnsProviderStep
        defaults={{ provider: 'Manual', secret: '', defaultDomain: 'exemple.fr' }}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Clé API')).not.toBeInTheDocument()
    openCombobox()
    fireEvent.click(screen.getByText('Cloudflare'))
    await waitFor(() =>
      expect(screen.getByLabelText('Clé API')).toBeInTheDocument(),
    )
  })

  it('hides the secret and shows the manual note when Manual is selected', async () => {
    wrap(
      <DnsProviderStep
        defaults={{ provider: 'Cloudflare', secret: '', defaultDomain: 'exemple.fr' }}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Clé API')).toBeInTheDocument()
    openCombobox()
    fireEvent.click(screen.getByText('Configuration manuelle'))
    await waitFor(() =>
      expect(screen.queryByLabelText('Clé API')).not.toBeInTheDocument(),
    )
    expect(
      screen.getByText(
        "À l'étape 7, le wizard affichera les enregistrements à copier chez votre fournisseur.",
      ),
    ).toBeInTheDocument()
  })

  it('submits in Manual mode with provider Manual', async () => {
    const onNext = vi.fn()
    wrap(
      <DnsProviderStep
        defaults={{ provider: 'Manual', secret: '' }}
        onNext={onNext}
        onBack={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    await waitFor(() =>
      expect(onNext).toHaveBeenCalledWith({ provider: 'Manual', secret: '' }),
    )
  })
})
