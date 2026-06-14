import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../../i18n/i18n'
import { ThreadList } from './thread-list'
import type { AppThread } from '../../server/mail-types'

beforeAll(() => {
  // @tanstack/react-virtual needs a measurable scroll element + ResizeObserver in jsdom.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as Record<string, unknown>).ResizeObserver = RO

  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 400, height: 600, top: 0, left: 0, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => {} }),
  })
  // Some virtualizer versions read these:
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 400 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 })
})

// Restaure les overrides globaux pour ne pas polluer les autres suites de tests.
afterAll(() => {
  delete (globalThis as Record<string, unknown>).ResizeObserver
  for (const p of ['getBoundingClientRect', 'offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[p]
  }
})

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
