import { describe, expect, it } from 'vitest'
import { mapMailboxes, resolveFilter, buildListMethodCalls, parseListPage } from './mail-actions'
import type { JmapMethodResponse } from './jmap'
import type { AppMailbox } from './mail-types'

describe('mapMailboxes', () => {
  it('mappe Mailbox/get vers AppMailbox[] trié par sortOrder', () => {
    const responses: JmapMethodResponse[] = [
      [
        'Mailbox/get',
        {
          list: [
            { id: 'm2', name: 'Envoyés', role: 'sent', unreadEmails: 0, totalEmails: 3, sortOrder: 2 },
            { id: 'm1', name: 'Réception', role: 'inbox', unreadEmails: 5, totalEmails: 40, sortOrder: 1 },
          ],
        },
        '0',
      ],
    ]
    const out = mapMailboxes(responses)
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(out[0]).toMatchObject({ role: 'inbox', unreadEmails: 5, totalEmails: 40 })
  })

  it('normalise role absent en null', () => {
    const responses: JmapMethodResponse[] = [
      ['Mailbox/get', { list: [{ id: 'm1', name: 'X', unreadEmails: 0, totalEmails: 0, sortOrder: 0 }] }, '0'],
    ]
    expect(mapMailboxes(responses)[0].role).toBeNull()
  })

  it('retourne [] quand Mailbox/get est absent ou list non-tableau', () => {
    expect(mapMailboxes([])).toEqual([])
  })
})

const MBX: AppMailbox[] = [
  { id: 'mi', name: 'In', role: 'inbox', unreadEmails: 0, totalEmails: 0, sortOrder: 1 },
  { id: 'mt', name: 'Trash', role: 'trash', unreadEmails: 0, totalEmails: 0, sortOrder: 2 },
  { id: 'ms', name: 'Spam', role: 'spam', unreadEmails: 0, totalEmails: 0, sortOrder: 3 },
]

describe('resolveFilter', () => {
  it('dossier réel → inMailbox sur l\'id du role', () => {
    expect(resolveFilter('inbox', MBX)).toEqual({ inMailbox: 'mi' })
  })

  it('starred → $flagged AND NOT (trash, spam) [R5]', () => {
    expect(resolveFilter('starred', MBX)).toEqual({
      operator: 'AND',
      conditions: [
        { hasKeyword: '$flagged' },
        { operator: 'NOT', conditions: [{ inMailbox: 'mt' }, { inMailbox: 'ms' }] },
      ],
    })
  })

  it('starred sans trash/spam → filtre keyword seul (pas de NOT vide)', () => {
    const inboxOnly: AppMailbox[] = [
      { id: 'mi', name: 'In', role: 'inbox', unreadEmails: 0, totalEmails: 0, sortOrder: 1 },
    ]
    expect(resolveFilter('starred', inboxOnly)).toEqual({ hasKeyword: '$flagged' })
    expect(resolveFilter('starred', [])).toEqual({ hasKeyword: '$flagged' })
  })

  it('dossier inconnu (rôle absent) → lève une erreur', () => {
    expect(() => resolveFilter('sent', MBX)).toThrow(/Unknown mail folder/)
  })
})

describe('buildListMethodCalls', () => {
  it('Email/query inclut collapseThreads + calculateTotal + position/limit', () => {
    const calls = buildListMethodCalls('acc', { inMailbox: 'mi' }, 50, 50)
    const [, query] = calls[0]
    expect(query).toMatchObject({
      accountId: 'acc',
      collapseThreads: true,
      calculateTotal: true,
      position: 50,
      limit: 50,
      sort: [{ property: 'receivedAt', isAscending: false }],
    })
    expect(query.filter).toEqual({ inMailbox: 'mi' })
    expect(calls[1][0]).toBe('Email/get')
    expect(calls[2][0]).toBe('Thread/get')
    expect(calls[2][1]['#ids']).toMatchObject({
      resultOf: '1',
      name: 'Email/get',
      path: '/list/*/threadId',
    })
  })
})

describe('parseListPage', () => {
  it('assemble threads (messageCount via Thread/get), total et position', () => {
    const responses: JmapMethodResponse[] = [
      ['Email/query', { total: 120, position: 0 }, '0'],
      [
        'Email/get',
        {
          list: [
            {
              id: 'e1',
              threadId: 't1',
              mailboxIds: { mi: true },
              keywords: { $flagged: true },
              from: [{ name: 'Alice', email: 'a@x.fr' }],
              to: [{ name: 'Moi', email: 'me@x.fr' }],
              subject: 'Sujet',
              preview: 'Aperçu',
              receivedAt: '2026-06-10T08:00:00Z',
              hasAttachment: true,
            },
          ],
        },
        '1',
      ],
      ['Thread/get', { list: [{ id: 't1', emailIds: ['e1', 'e2', 'e3'] }] }, '2'],
    ]
    const page = parseListPage(responses, 0)
    expect(page.total).toBe(120)
    expect(page.position).toBe(0)
    expect(page.threads).toHaveLength(1)
    expect(page.threads[0]).toMatchObject({
      id: 'e1',
      threadId: 't1',
      messageCount: 3,
      unread: true, // $seen absent ⇒ non lu
      starred: true,
      hasAttachment: true,
      mailboxIds: ['mi'],
    })
  })

  it('unread = true quand $seen absent, false quand présent', () => {
    const mk = (keywords: Record<string, boolean>): JmapMethodResponse[] => [
      ['Email/query', { total: 1, position: 0 }, '0'],
      [
        'Email/get',
        {
          list: [
            {
              id: 'e1', threadId: 't1', mailboxIds: {}, keywords,
              from: [], to: [], subject: '', preview: '', receivedAt: '2026-06-10T08:00:00Z',
              hasAttachment: false,
            },
          ],
        },
        '1',
      ],
      ['Thread/get', { list: [{ id: 't1', emailIds: ['e1'] }] }, '2'],
    ]
    expect(parseListPage(mk({}), 0).threads[0].unread).toBe(true)
    expect(parseListPage(mk({ $seen: true }), 0).threads[0].unread).toBe(false)
  })
})
