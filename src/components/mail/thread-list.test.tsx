import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../../i18n/i18n'
import { ThreadList } from './thread-list'
import type { AppThread } from '../../server/mail-types'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  )
}

const mk = (id: string): AppThread => ({
  id, threadId: id, subject: `Sujet ${id}`, preview: 'p', from: [{ name: 'A', email: 'a@x' }],
  to: [], messageCount: 1, receivedAt: '2026-06-12T08:00:00', unread: false, starred: false,
  hasAttachment: false, mailboxIds: ['mi'],
})

describe('ThreadList', () => {
  it('rend les threads fournis par le hook injecté', () => {
    const threads = [mk('e0'), mk('e1')]
    const useThreads = () => ({ total: 2, isError: false, threadAt: (i: number) => threads[i] })
    wrap(<ThreadList folder="inbox" useThreadsHook={useThreads} />)
    expect(screen.getByText('Sujet e0')).toBeInTheDocument()
    expect(screen.getByText('Sujet e1')).toBeInTheDocument()
  })

  it("affiche une alerte d'erreur si isError", () => {
    const useThreads = () => ({ total: undefined, isError: true, threadAt: () => undefined })
    wrap(<ThreadList folder="inbox" useThreadsHook={useThreads} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it("affiche l'état vide si total = 0", () => {
    const useThreads = () => ({ total: 0, isError: false, threadAt: () => undefined })
    wrap(<ThreadList folder="inbox" useThreadsHook={useThreads} />)
    expect(screen.getByText('Aucun message')).toBeInTheDocument()
  })
})
