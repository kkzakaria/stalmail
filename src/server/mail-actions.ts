import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import type { JmapMethodCall, JmapMethodResponse } from "./jmap"
import type {
  AppMailbox,
  AppAttachment,
  AppMessage,
  AppThread,
  AppThreadDetail,
  EmailListPage,
  MailAddress,
} from "./mail-types"

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
  const get = responses.find(([name]) => name === "Mailbox/get")
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

// resolveFilter n'a besoin que de { id, role }. Pour la résolution de filtre on ne
// requête que ['id','role'] : on extrait donc une vue minimale plutôt que de fabriquer
// des AppMailbox partiels (name/sortOrder undefined → tri NaN) via mapMailboxes.
export type MailboxRef = { id: string; role: string | null }

export function mailboxRefs(responses: JmapMethodResponse[]): MailboxRef[] {
  const get = responses.find(([name]) => name === "Mailbox/get")
  const raw = get?.[1].list
  const list = Array.isArray(raw)
    ? (raw as { id: string; role?: string | null }[])
    : []
  return list.map((m) => ({ id: m.id, role: m.role ?? null }))
}

// Récupère sid + accountId depuis la session (server-only).
async function requireSession(): Promise<{ sid: string; accountId: string }> {
  const { readSid } = await import("./session-cookie")
  const { currentSession } = await import("./session")
  const { redirect } = await import("@tanstack/react-router")
  const sid = readSid()
  const session = currentSession(sid)
  if (!sid || !session) throw redirect({ to: "/login" })
  return { sid, accountId: session.accountId }
}

export const mailboxesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppMailbox[]> => {
    const { jmapUserCall } = await import("./jmap-user")
    const { sid, accountId } = await requireSession()
    const responses = await jmapUserCall(sid, [
      [
        "Mailbox/get",
        {
          accountId,
          ids: null,
          properties: [
            "id",
            "name",
            "role",
            "unreadEmails",
            "totalEmails",
            "sortOrder",
          ],
        },
        "0",
      ],
    ])
    return mapMailboxes(responses)
  }
)

type JmapFilter = Record<string, unknown>

function mailboxIdByRole(
  mailboxes: MailboxRef[],
  role: string
): string | undefined {
  return mailboxes.find((m) => m.role === role)?.id
}

// Nom de dossier URL → role de mailbox JMAP (RFC 8621). Le dossier « Indésirables »
// (URL 'spam') correspond au role **'junk'** : il n'existe pas de role "spam" en RFC 8621.
const ROLE_BY_FOLDER = new Map<string, string>([
  ["inbox", "inbox"],
  ["sent", "sent"],
  ["drafts", "drafts"],
  ["archive", "archive"],
  ["spam", "junk"],
  ["trash", "trash"],
])

// Filtre ne correspondant à aucun email — pour un dossier connu dont la mailbox n'a pas
// été provisionnée par Stalwart (ex. Archivés absent) : on affiche « Aucun message » plutôt qu'une erreur.
const MATCH_NONE: JmapFilter = { before: "1970-01-02T00:00:00Z" }

// Pur : dossier URL → filtre JMAP. 'starred' exclut corbeille/indésirables (R5, aligné Gmail).
export function resolveFilter(
  folder: string,
  mailboxes: MailboxRef[]
): JmapFilter {
  if (folder === "starred") {
    const exclude: JmapFilter[] = []
    const trash = mailboxIdByRole(mailboxes, "trash")
    const junk = mailboxIdByRole(mailboxes, "junk")
    if (trash) exclude.push({ inMailbox: trash })
    if (junk) exclude.push({ inMailbox: junk })
    if (exclude.length === 0) return { hasKeyword: "$flagged" }
    return {
      operator: "AND",
      conditions: [
        { hasKeyword: "$flagged" },
        { operator: "NOT", conditions: exclude },
      ],
    }
  }
  const role = ROLE_BY_FOLDER.get(folder)
  if (role === undefined) throw new Error(`Unknown mail folder: ${folder}`)
  const id = mailboxIdByRole(mailboxes, role)
  if (id === undefined) return MATCH_NONE
  return { inMailbox: id }
}

// Pur : batch Email/query + Email/get + Thread/get.
export function buildListMethodCalls(
  accountId: string,
  filter: JmapFilter,
  position: number,
  limit: number
): JmapMethodCall[] {
  return [
    [
      "Email/query",
      {
        accountId,
        collapseThreads: true,
        calculateTotal: true,
        filter,
        sort: [{ property: "receivedAt", isAscending: false }],
        position,
        limit,
      },
      "0",
    ],
    [
      "Email/get",
      {
        accountId,
        "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
        properties: [
          "id",
          "threadId",
          "mailboxIds",
          "keywords",
          "from",
          "to",
          "subject",
          "preview",
          "receivedAt",
          "hasAttachment",
        ],
      },
      "1",
    ],
    [
      "Thread/get",
      {
        accountId,
        "#ids": { resultOf: "1", name: "Email/get", path: "/list/*/threadId" },
      },
      "2",
    ],
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
export function parseListPage(
  responses: JmapMethodResponse[],
  position: number
): EmailListPage {
  const query = responses.find(([n]) => n === "Email/query")?.[1] as
    | { total?: number; queryState?: string; ids?: string[] }
    | undefined
  const rawEmails = responses.find(([n]) => n === "Email/get")?.[1].list
  const emailList: RawEmail[] = Array.isArray(rawEmails)
    ? (rawEmails as RawEmail[])
    : []
  // RFC 8620 §5.1 : l'ordre du `list` d'un /get n'est pas garanti — on réaligne sur l'ordre
  // trié des ids renvoyés par Email/query (receivedAt desc).
  const orderedIds = Array.isArray(query?.ids) ? query.ids : []
  const byId = new Map(emailList.map((e) => [e.id, e]))
  const emails: RawEmail[] = orderedIds.length
    ? orderedIds
        .map((id) => byId.get(id))
        .filter((e): e is RawEmail => e !== undefined)
    : emailList
  const rawThreads = responses.find(([n]) => n === "Thread/get")?.[1].list
  const threads: { id: string; emailIds: string[] }[] = Array.isArray(
    rawThreads
  )
    ? (rawThreads as { id: string; emailIds: string[] }[])
    : []
  const countByThread = new Map(threads.map((t) => [t.id, t.emailIds.length]))

  const appThreads: AppThread[] = emails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    subject: e.subject ?? "",
    preview: e.preview ?? "",
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

export const emailListFn = createServerFn({ method: "GET" })
  .validator((d: { folder: string; position: number; limit: number }) =>
    emailListSchema.parse(d)
  )
  .handler(async ({ data }): Promise<EmailListPage> => {
    const { jmapUserCall } = await import("./jmap-user")
    const { sid, accountId } = await requireSession()
    // Les ids trash/junk (pour 'starred') et l'id du dossier viennent de Mailbox/get.
    // Vue minimale { id, role } : on ne requête et ne mappe que ce dont resolveFilter a besoin.
    const mbxResponses = await jmapUserCall(sid, [
      [
        "Mailbox/get",
        { accountId, ids: null, properties: ["id", "role"] },
        "0",
      ],
    ])
    const filter = resolveFilter(data.folder, mailboxRefs(mbxResponses))
    const responses = await jmapUserCall(
      sid,
      buildListMethodCalls(accountId, filter, data.position, data.limit)
    )
    return parseListPage(responses, data.position)
  })

// ---------------------------------------------------------------------------
// Task 3 — readThreadFn + parseThreadDetail (READ-ONLY)
// ---------------------------------------------------------------------------

interface RawBodyPart {
  partId?: string
  type?: string
}

interface RawDetailEmail {
  id: string
  from?: MailAddress[] | null
  to?: MailAddress[] | null
  cc?: MailAddress[] | null
  subject?: string
  receivedAt?: string
  keywords?: Record<string, boolean>
  hasAttachment?: boolean
  textBody?: RawBodyPart[]
  htmlBody?: RawBodyPart[]
  bodyValues?: Record<string, { value?: string }>
  attachments?: {
    blobId: string
    name?: string
    type?: string
    size?: number
  }[]
}

// Pur : résout le 1er part d'un type donné en sa valeur texte (via bodyValues).
function resolveBody(
  parts: RawBodyPart[] | undefined,
  values: RawDetailEmail["bodyValues"]
): string | null {
  const first = Array.isArray(parts) ? parts[0] : undefined
  if (!first?.partId) return null
  const v = values?.[first.partId]?.value
  return typeof v === "string" && v !== "" ? v : null
}

// Pur : batch readThread.
export function buildReadThreadCalls(
  accountId: string,
  threadId: string
): JmapMethodCall[] {
  return [
    ["Thread/get", { accountId, ids: [threadId] }, "0"],
    [
      "Email/get",
      {
        accountId,
        "#ids": { resultOf: "0", name: "Thread/get", path: "/list/*/emailIds" },
        properties: [
          "id",
          "from",
          "to",
          "cc",
          "subject",
          "receivedAt",
          "keywords",
          "hasAttachment",
          "textBody",
          "htmlBody",
          "bodyValues",
          "attachments",
        ],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
        maxBodyValueBytes: 256000,
      },
      "1",
    ],
  ]
}

// Pur : assemble AppThreadDetail depuis Thread/get + Email/get.
export function parseThreadDetail(
  responses: JmapMethodResponse[]
): AppThreadDetail {
  const threadRaw = responses.find(([n]) => n === "Thread/get")?.[1]
  const threadList = Array.isArray(threadRaw?.list)
    ? (threadRaw.list as { id?: string; emailIds?: string[] }[])
    : []
  const thread = threadList[0] as
    | { id?: string; emailIds?: string[] }
    | undefined
  const threadId = thread?.id ?? ""
  const emailIds = Array.isArray(thread?.emailIds) ? thread.emailIds : []

  const rawList = responses.find(([n]) => n === "Email/get")?.[1].list
  const list: RawDetailEmail[] = Array.isArray(rawList)
    ? (rawList as RawDetailEmail[])
    : []
  const byId = new Map(list.map((e) => [e.id, e]))
  // Ordre chronologique = ordre des emailIds du Thread (sinon ordre brut).
  const ordered: RawDetailEmail[] = emailIds.length
    ? emailIds
        .map((id) => byId.get(id))
        .filter((e): e is RawDetailEmail => e !== undefined)
    : list

  const messages: AppMessage[] = ordered.map((e) => ({
    id: e.id,
    from: e.from ?? [],
    to: e.to ?? [],
    cc: e.cc ?? [],
    subject: e.subject ?? "",
    receivedAt: e.receivedAt ?? "",
    unread: (e.keywords ?? {}).$seen !== true,
    hasAttachment: e.hasAttachment === true,
    textBody: resolveBody(e.textBody, e.bodyValues),
    htmlBody: resolveBody(e.htmlBody, e.bodyValues),
    attachments: (e.attachments ?? []).map(
      (a): AppAttachment => ({
        blobId: a.blobId,
        name: a.name ?? "pièce jointe",
        type: a.type ?? "application/octet-stream",
        size: a.size ?? 0,
      })
    ),
  }))

  return {
    threadId,
    subject: messages[0]?.subject ?? "",
    messages,
    emailIds,
    starred: list.some((e) => (e.keywords ?? {}).$flagged === true),
    unread: messages.some((m) => m.unread),
  }
}

const readThreadSchema = z.object({ threadId: z.string().min(1).max(64) })

// READ-ONLY (invariant design §2.5) : aucun Email/set ici.
export const readThreadFn = createServerFn({ method: "GET" })
  .validator((d: { threadId: string }) => readThreadSchema.parse(d))
  .handler(async ({ data }): Promise<AppThreadDetail> => {
    const { jmapUserCall } = await import("./jmap-user")
    const { sid, accountId } = await requireSession()
    const responses = await jmapUserCall(
      sid,
      buildReadThreadCalls(accountId, data.threadId)
    )
    return parseThreadDetail(responses)
  })
