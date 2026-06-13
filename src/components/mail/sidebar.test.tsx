import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../../i18n/i18n'
import { AppSidebar, FOLDER_ORDER } from './sidebar'
import type { AppMailbox } from '../../server/mail-types'

// vi.mock est hissé par vitest au-dessus des imports — le mock est actif même si déclaré ici.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    className,
    children,
  }: {
    to?: string
    params?: Record<string, string>
    className?: string
    children?: React.ReactNode
  }) => <a className={className}>{children}</a>,
}))

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)
}

const mailboxes: AppMailbox[] = [
  { id: 'mi', name: 'Réception', role: 'inbox', unreadEmails: 3, totalEmails: 40, sortOrder: 1 },
  { id: 'ms', name: 'Envoyés', role: 'sent', unreadEmails: 0, totalEmails: 10, sortOrder: 2 },
]

describe('AppSidebar', () => {
  it('ordonne les dossiers selon FOLDER_ORDER (virtuels après inbox)', () => {
    expect(FOLDER_ORDER.slice(0, 3)).toEqual(['inbox', 'starred', 'snoozed'])
  })

  it('marque le dossier actif', () => {
    const { container } = wrap(
      <AppSidebar mailboxes={mailboxes} activeFolder="inbox" accountName="me@x.fr" />,
    )
    const active = container.querySelector('.nav-item.active')
    expect(active?.textContent).toContain('Boîte de réception')
  })

  it('affiche le compteur non-lus sur inbox', () => {
    wrap(<AppSidebar mailboxes={mailboxes} activeFolder="inbox" accountName="me@x.fr" />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('bouton composer désactivé (Plan 4c)', () => {
    wrap(<AppSidebar mailboxes={mailboxes} activeFolder="inbox" accountName="me@x.fr" />)
    expect(screen.getByRole('button', { name: /nouveau message/i })).toBeDisabled()
  })
})
