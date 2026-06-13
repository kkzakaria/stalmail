import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { JmapMethodCall, JmapMethodResponse } from './jmap'
import type { AppMailbox, AppThread, EmailListPage, MailAddress } from './mail-types'

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
  const raw = get?.[1].list
  const list: RawMailbox[] = Array.isArray(raw) ? (raw as RawMailbox[]) : []
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

type JmapFilter = Record<string, unknown>

function mailboxIdByRole(mailboxes: AppMailbox[], role: string): string | undefined {
  return mailboxes.find((m) => m.role === role)?.id
}

// Pur : dossier URL → filtre JMAP. 'starred' exclut corbeille/spam (R5, aligné Gmail).
export function resolveFilter(folder: string, mailboxes: AppMailbox[]): JmapFilter {
  if (folder === 'starred') {
    const exclude: JmapFilter[] = []
    const trash = mailboxIdByRole(mailboxes, 'trash')
    const spam = mailboxIdByRole(mailboxes, 'spam')
    if (trash) exclude.push({ inMailbox: trash })
    if (spam) exclude.push({ inMailbox: spam })
    if (exclude.length === 0) return { hasKeyword: '$flagged' }
    return {
      operator: 'AND',
      conditions: [{ hasKeyword: '$flagged' }, { operator: 'NOT', conditions: exclude }],
    }
  }
  const id = mailboxIdByRole(mailboxes, folder)
  if (id === undefined) throw new Error(`Unknown mail folder: ${folder}`)
  return { inMailbox: id }
}

// Pur : batch Email/query + Email/get + Thread/get.
export function buildListMethodCalls(
  accountId: string,
  filter: JmapFilter,
  position: number,
  limit: number,
): JmapMethodCall[] {
  return [
    [
      'Email/query',
      {
        accountId,
        collapseThreads: true,
        calculateTotal: true,
        filter,
        sort: [{ property: 'receivedAt', isAscending: false }],
        position,
        limit,
      },
      '0',
    ],
    [
      'Email/get',
      {
        accountId,
        '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' },
        properties: [
          'id', 'threadId', 'mailboxIds', 'keywords',
          'from', 'to', 'subject', 'preview', 'receivedAt', 'hasAttachment',
        ],
      },
      '1',
    ],
    ['Thread/get', { accountId, '#ids': { resultOf: '1', name: 'Email/get', path: '/list/*/threadId' } }, '2'],
  ]
}

interface RawEmail {
  id: string
  threadId: string
  mailboxIds?: Record<string, boolean>
  keywords?: Record<string, boolean>
  from?: MailAddress[] | null
  to?: MailAddress[] | null
  subject?: string
  preview?: string
  receivedAt: string
  hasAttachment?: boolean
}

// Pur : assemble la page depuis les 3 réponses du batch.
export function parseListPage(responses: JmapMethodResponse[], position: number): EmailListPage {
  const query = responses.find(([n]) => n === 'Email/query')?.[1] as
    | { total?: number; queryState?: string; ids?: string[] }
    | undefined
  const rawEmails = responses.find(([n]) => n === 'Email/get')?.[1].list
  const emailList: RawEmail[] = Array.isArray(rawEmails) ? (rawEmails as RawEmail[]) : []
  // RFC 8620 §5.1 : l'ordre du `list` d'un /get n'est pas garanti — on réaligne sur l'ordre
  // trié des ids renvoyés par Email/query (receivedAt desc).
  const orderedIds = Array.isArray(query?.ids) ? query.ids : []
  const byId = new Map(emailList.map((e) => [e.id, e]))
  const emails: RawEmail[] = orderedIds.length
    ? orderedIds.map((id) => byId.get(id)).filter((e): e is RawEmail => e !== undefined)
    : emailList
  const rawThreads = responses.find(([n]) => n === 'Thread/get')?.[1].list
  const threads: { id: string; emailIds: string[] }[] = Array.isArray(rawThreads)
    ? (rawThreads as { id: string; emailIds: string[] }[])
    : []
  const countByThread = new Map(threads.map((t) => [t.id, t.emailIds.length]))

  const appThreads: AppThread[] = emails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    subject: e.subject ?? '',
    preview: e.preview ?? '',
    from: e.from ?? [],
    to: e.to ?? [],
    messageCount: countByThread.get(e.threadId) ?? 1,
    receivedAt: e.receivedAt,
    unread: (e.keywords ?? {}).$seen !== true,
    starred: (e.keywords ?? {}).$flagged === true,
    hasAttachment: e.hasAttachment === true,
    mailboxIds: Object.keys(e.mailboxIds ?? {}),
  }))

  return {
    threads: appThreads,
    total: query?.total ?? appThreads.length,
    position,
    queryState: query?.queryState,
  }
}

const emailListSchema = z.object({
  folder: z.string().min(1).max(64),
  position: z.number().int().min(0),
  limit: z.number().int().min(1).max(200),
})

export const emailListFn = createServerFn({ method: 'GET' })
  .validator((d: { folder: string; position: number; limit: number }) => emailListSchema.parse(d))
  .handler(async ({ data }): Promise<EmailListPage> => {
    const { jmapUserCall } = await import('./jmap-user')
    const { sid, accountId } = await requireSession()
    // Les ids trash/spam (pour 'starred') et l'id du dossier viennent de Mailbox/get.
    const mbxResponses = await jmapUserCall(sid, [
      ['Mailbox/get', { accountId, ids: null, properties: ['id', 'role'] }, '0'],
    ])
    const mailboxes = mapMailboxes(mbxResponses)
    const filter = resolveFilter(data.folder, mailboxes)
    const responses = await jmapUserCall(sid, buildListMethodCalls(accountId, filter, data.position, data.limit))
    return parseListPage(responses, data.position)
  })
