import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import type { AcmeStatus } from '@/server/stalwart-acme'
import { SslStep } from './SslStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('SslStep', () => {
  it('configuring → monitor: renders the recap, reports pending status, and Continue advances', async () => {
    const configureAcme = vi.fn(() => Promise.resolve({ ok: true as const }))
    const acmeStatus = vi.fn(
      (): Promise<{ status: AcmeStatus }> => Promise.resolve({ status: 'pending' }),
    )
    const onStatusChange = vi.fn()
    const onNext = vi.fn()

    wrap(
      <SslStep
        hostname="mail.exemple.fr"
        contactEmail="admin@exemple.fr"
        configureAcme={configureAcme}
        acmeStatus={acmeStatus}
        onStatusChange={onStatusChange}
        onNext={onNext}
      />,
    )

    // The monitor recap renders once configureAcme resolves.
    expect(await screen.findByText("Let's Encrypt · TLS-ALPN-01")).toBeInTheDocument()
    expect(screen.getByText('admin@exemple.fr')).toBeInTheDocument()
    expect(screen.getByText('mail.exemple.fr')).toBeInTheDocument()

    // Non-blocking note shows while not valid.
    expect(
      screen.getByText(/Vous pouvez continuer/),
    ).toBeInTheDocument()

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('pending'))
    expect(configureAcme).toHaveBeenCalledWith({
      hostname: 'mail.exemple.fr',
      contactEmail: 'admin@exemple.fr',
    })

    // Continue advances (always enabled — non-blocking).
    fireEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(onNext).toHaveBeenCalled()
  })

  it('status failed: renders the failed hint Alert', async () => {
    const configureAcme = vi.fn(() => Promise.resolve({ ok: true as const }))
    const acmeStatus = vi.fn(
      (): Promise<{ status: AcmeStatus }> => Promise.resolve({ status: 'failed' }),
    )

    wrap(
      <SslStep
        hostname="mail.exemple.fr"
        contactEmail="admin@exemple.fr"
        configureAcme={configureAcme}
        acmeStatus={acmeStatus}
        onStatusChange={vi.fn()}
        onNext={vi.fn()}
      />,
    )

    expect(
      await screen.findByText(/Le port 443 doit être joignable/),
    ).toBeInTheDocument()
  })

  it('configure rejection: shows an error Alert + Retry', async () => {
    const configureAcme = vi.fn(() => Promise.reject(new Error('boom')))
    const acmeStatus = vi.fn(
      (): Promise<{ status: AcmeStatus }> => Promise.resolve({ status: 'pending' }),
    )

    wrap(
      <SslStep
        hostname="mail.exemple.fr"
        contactEmail="admin@exemple.fr"
        configureAcme={configureAcme}
        acmeStatus={acmeStatus}
        onStatusChange={vi.fn()}
        onNext={vi.fn()}
      />,
    )

    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(screen.getByText('Réessayer')).toBeInTheDocument()
  })
})
