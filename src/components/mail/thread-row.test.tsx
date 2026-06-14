import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThreadRow } from './thread-row'
import type { AppThread } from '../../server/mail-types'

const base: AppThread = {
  id: 'e1', threadId: 't1', subject: 'Sujet', preview: 'Aperçu',
  from: [{ name: 'Alice Martin', email: 'a@x.fr' }],
  to: [{ name: 'Bob Client', email: 'b@x.fr' }],
  messageCount: 1, receivedAt: '2026-06-12T08:00:00', unread: false,
  starred: false, hasAttachment: false, mailboxIds: ['mi'],
}
const now = new Date('2026-06-12T10:00:00')

describe('ThreadRow', () => {
  it('point non-lu visible si unread', () => {
    const { container } = render(<ThreadRow thread={{ ...base, unread: true }} folder="inbox" now={now} />)
    expect(container.querySelector('.unread-dot')).toBeInTheDocument()
  })

  it('icône étoile pleine si starred', () => {
    const { container } = render(<ThreadRow thread={{ ...base, starred: true }} folder="inbox" now={now} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.querySelector('.row-star')).toBeInTheDocument()
  })

  it('trombone si hasAttachment', () => {
    const { container } = render(<ThreadRow thread={{ ...base, hasAttachment: true }} folder="inbox" now={now} />)
    expect(container.querySelector('.row-attach')).toBeInTheDocument()
  })

  it('compteur +N si messageCount > 1', () => {
    const { container } = render(<ThreadRow thread={{ ...base, messageCount: 4 }} folder="inbox" now={now} />)
    expect(container.querySelector('.thread-count')?.textContent).toContain('4')
  })

  it('affiche l\'expéditeur dans inbox', () => {
    render(<ThreadRow thread={base} folder="inbox" now={now} />)
    expect(screen.getByText('Alice Martin')).toBeInTheDocument()
  })

  it('affiche le destinataire dans sent', () => {
    render(<ThreadRow thread={base} folder="sent" now={now} />)
    expect(screen.getByText('Bob Client')).toBeInTheDocument()
  })

  it('rend un skeleton quand thread est undefined', () => {
    const { container } = render(<ThreadRow thread={undefined} folder="inbox" now={now} />)
    expect(container.querySelector('.row-skeleton')).toBeInTheDocument()
    expect(container.querySelector('.unread-dot')).not.toBeInTheDocument()
  })

  it('ne plante pas si from/to est vide (affiche le fallback —)', () => {
    const { container } = render(<ThreadRow thread={{ ...base, from: [], to: [] }} folder="inbox" now={now} />)
    expect(container.querySelector('.from-name')).toHaveTextContent('—')
  })

  it('appelle onOpen au clic', () => {
    const onOpen = vi.fn()
    const { container } = render(<ThreadRow thread={base} folder="inbox" now={now} onOpen={onOpen} />)
    fireEvent.click(container.querySelector('.row')!)
    expect(onOpen).toHaveBeenCalledWith('e1')
  })

  it('appelle onOpen sur Entrée et Espace', () => {
    const onOpen = vi.fn()
    const { container } = render(<ThreadRow thread={base} folder="inbox" now={now} onOpen={onOpen} />)
    const row = container.querySelector('.row')!
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('applique la classe sel si selected', () => {
    const { container } = render(<ThreadRow thread={base} folder="inbox" now={now} selected />)
    expect(container.querySelector('.row.sel')).toBeInTheDocument()
  })
})
