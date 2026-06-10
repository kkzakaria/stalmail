import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import type { DnsGridRecord } from '@/server/setup-actions'
import { DnsStep } from './DnsStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

const autoRecords: DnsGridRecord[] = [
  { name: 'mail.exemple.fr.', type: 'A', value: '1.2.3.4', status: 'pending' },
  { name: 'exemple.fr.', type: 'MX', value: '10 mail.exemple.fr.', status: 'verified' },
]

describe('DnsStep', () => {
  it('auto path: runs createDnsServer + setDnsManagement then renders the flat grid', async () => {
    const createDnsServer = vi.fn(() => Promise.resolve({ dnsServerId: 'srv-1' }))
    const setDnsManagement = vi.fn(() => Promise.resolve({ ok: true as const }))
    const gridStatus = vi.fn(() =>
      Promise.resolve({ origin: 'exemple.fr', records: autoRecords }),
    )

    wrap(
      <DnsStep
        provider="Cloudflare"
        secret="tok"
        hostname="mail.exemple.fr"
        domain="exemple.fr"
        createDnsServer={createDnsServer}
        setDnsManagement={setDnsManagement}
        gridStatus={gridStatus}
        onNext={vi.fn()}
      />,
    )

    // The flat table eventually renders the records.
    expect(await screen.findByText('A')).toBeInTheDocument()
    expect(await screen.findByText('MX')).toBeInTheDocument()
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument()

    expect(createDnsServer).toHaveBeenCalledWith({
      provider: 'Cloudflare',
      secret: 'tok',
    })
    expect(setDnsManagement).toHaveBeenCalledWith({ dnsServerId: 'srv-1' })
  })

  it('manual path: renders the sectioned table with copy/download, no DNS server created', async () => {
    const createDnsServer = vi.fn(() => Promise.resolve({ dnsServerId: 'srv-1' }))
    const setDnsManagement = vi.fn(() => Promise.resolve({ ok: true as const }))
    const gridStatus = vi.fn(() =>
      Promise.resolve({
        origin: 'exemple.fr',
        records: [
          { name: 'mail.exemple.fr.', type: 'A', value: '1.2.3.4', status: 'pending' },
          { name: 'exemple.fr.', type: 'MX', value: '10 mail.exemple.fr.', status: 'pending' },
        ] as DnsGridRecord[],
      }),
    )

    wrap(
      <DnsStep
        provider="Manual"
        secret=""
        hostname="mail.exemple.fr"
        domain="exemple.fr"
        createDnsServer={createDnsServer}
        setDnsManagement={setDnsManagement}
        gridStatus={gridStatus}
        onNext={vi.fn()}
      />,
    )

    // The A-group sectioned title from i18n.
    expect(await screen.findByText('Adresse du serveur')).toBeInTheDocument()
    // Zone-file copy + download actions present.
    expect(screen.getByText('Télécharger (.txt)')).toBeInTheDocument()
    expect(screen.getByText('Fichier de zone complet')).toBeInTheDocument()

    expect(createDnsServer).not.toHaveBeenCalled()
    expect(setDnsManagement).not.toHaveBeenCalled()
  })

  it('task badge shows completed when all records are verified', async () => {
    const gridStatus = vi.fn(() =>
      Promise.resolve({
        origin: 'exemple.fr',
        records: [
          { name: 'mail.exemple.fr.', type: 'A', value: '1.2.3.4', status: 'verified' },
          { name: 'exemple.fr.', type: 'MX', value: '10 mail.exemple.fr.', status: 'verified' },
        ] as DnsGridRecord[],
      }),
    )

    wrap(
      <DnsStep
        provider="Manual"
        secret=""
        hostname="mail.exemple.fr"
        domain="exemple.fr"
        createDnsServer={vi.fn(() => Promise.resolve({ dnsServerId: 'srv-1' }))}
        setDnsManagement={vi.fn(() => Promise.resolve({ ok: true as const }))}
        gridStatus={gridStatus}
        onNext={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Terminée')).toBeInTheDocument()
    })
  })
})
