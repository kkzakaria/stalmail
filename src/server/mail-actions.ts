import { createServerFn } from '@tanstack/react-start'
import type { JmapMethodResponse } from './jmap'
import type { AppMailbox } from './mail-types'

interface RawMailbox {
  id: string
  name: string
  role?: string | null
  unreadEmails: number
  totalEmails: number
  sortOrder: number
}

// Pur : extrait + trie les mailboxes d'une réponse Mailbox/get.
export function mapMailboxes(responses: JmapMethodResponse[]): AppMailbox[] {
  const get = responses.find(([name]) => name === 'Mailbox/get')
  const list = (get?.[1].list as RawMailbox[] | undefined) ?? []
  return list
    .map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role ?? null,
      unreadEmails: m.unreadEmails,
      totalEmails: m.totalEmails,
      sortOrder: m.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

// Récupère sid + accountId depuis la session (server-only).
async function requireSession(): Promise<{ sid: string; accountId: string }> {
  const { readSid } = await import('./session-cookie')
  const { currentSession } = await import('./session')
  const { redirect } = await import('@tanstack/react-router')
  const sid = readSid()
  const session = currentSession(sid)
  if (!sid || !session) throw redirect({ to: '/login' })
  return { sid, accountId: session.accountId }
}

export const mailboxesFn = createServerFn({ method: 'GET' }).handler(async (): Promise<AppMailbox[]> => {
  const { jmapUserCall } = await import('./jmap-user')
  const { sid, accountId } = await requireSession()
  const responses = await jmapUserCall(sid, [
    [
      'Mailbox/get',
      { accountId, ids: null, properties: ['id', 'name', 'role', 'unreadEmails', 'totalEmails', 'sortOrder'] },
      '0',
    ],
  ])
  return mapMailboxes(responses)
})
