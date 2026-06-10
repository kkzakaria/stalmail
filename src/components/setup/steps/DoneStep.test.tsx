import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { DoneStep } from './DoneStep'

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)
}

describe('DoneStep', () => {
  it('finalizes once then shows the recap', async () => {
    const finishSetup = vi.fn().mockResolvedValue({ ok: true } as const)
    wrap(
      <DoneStep
        domain="dupont.fr"
        hostname="mail.dupont.fr"
        adminEmail="marie@dupont.fr"
        sslStatus="pending"
        finishSetup={finishSetup}
      />,
    )
    // The finishing spinner shows first.
    expect(screen.getByText('Finalisation…')).toBeInTheDocument()
    // After the async finalize, the recap appears.
    expect(await screen.findByText('Votre serveur est prêt')).toBeInTheDocument()
    expect(screen.getByText('marie@dupont.fr')).toBeInTheDocument()
    await waitFor(() => expect(finishSetup).toHaveBeenCalledTimes(1))
  })

  it('shows the active SSL label when the certificate is valid', async () => {
    const finishSetup = vi.fn().mockResolvedValue({ ok: true } as const)
    wrap(
      <DoneStep
        domain="dupont.fr"
        hostname="mail.dupont.fr"
        adminEmail="marie@dupont.fr"
        sslStatus="valid"
        finishSetup={finishSetup}
      />,
    )
    expect(await screen.findByText("Actif (Let's Encrypt)")).toBeInTheDocument()
  })

  it('shows the pending SSL label when the certificate is not yet active', async () => {
    const finishSetup = vi.fn().mockResolvedValue({ ok: true } as const)
    wrap(
      <DoneStep
        domain="dupont.fr"
        hostname="mail.dupont.fr"
        adminEmail="marie@dupont.fr"
        sslStatus="pending"
        finishSetup={finishSetup}
      />,
    )
    expect(await screen.findByText("En cours d'obtention")).toBeInTheDocument()
  })

  it('links the mailbox button to /login', async () => {
    const finishSetup = vi.fn().mockResolvedValue({ ok: true } as const)
    wrap(
      <DoneStep
        domain="dupont.fr"
        hostname="mail.dupont.fr"
        adminEmail="marie@dupont.fr"
        sslStatus="valid"
        finishSetup={finishSetup}
      />,
    )
    const link = await screen.findByRole('link', { name: /ouvrir ma boîte mail/i })
    expect(link).toHaveAttribute('href', '/login')
  })
})
