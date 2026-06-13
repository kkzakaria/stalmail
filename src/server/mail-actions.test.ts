import { describe, expect, it } from 'vitest'
import { mapMailboxes } from './mail-actions'
import type { JmapMethodResponse } from './jmap'

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
})
