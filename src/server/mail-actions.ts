import { createServerFn } from "@tanstack/react-start"
import { isRedirect } from "@tanstack/react-router"
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
import { sanitizeComposeHtml, htmlToPlainText } from "../lib/compose-html"
import {
  buildSendMethodCalls,
  parseSendResult,
  pickSendIdentity,
  isCleanHeaderValue,
} from "./compose-build"
import type { SendBody } from "./compose-build"
import {
  SHOW_IMAGES_KEYWORD,
  applyImagePrefs,
  normalizeSender,
} from "./image-prefs"

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
  messageId?: string[] | null // RFC 8621 : tableau de message-ids
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

// Pur : résout la valeur texte de la 1ère part du type MIME voulu (via bodyValues).
// RFC 8621 §4.1.4 : `textBody`/`htmlBody` peuvent contenir la MÊME part lorsqu'il n'existe
// pas d'alternative (ex. email html-only → la part text/html apparaît aussi dans textBody).
// On filtre donc par `type` pour ne pas afficher du code HTML comme du texte brut.
function resolveBody(
  parts: RawBodyPart[] | undefined,
  values: RawDetailEmail["bodyValues"],
  wantType: "text/plain" | "text/html"
): string | null {
  const part = Array.isArray(parts)
    ? parts.find((p) => p.type === wantType)
    : undefined
  if (!part?.partId) return null
  const v = values?.[part.partId]?.value
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
          "messageId",
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
    messageId: Array.isArray(e.messageId) ? (e.messageId[0] ?? null) : null,
    from: e.from ?? [],
    to: e.to ?? [],
    cc: e.cc ?? [],
    subject: e.subject ?? "",
    receivedAt: e.receivedAt ?? "",
    unread: (e.keywords ?? {}).$seen !== true,
    imageDecision:
      (e.keywords ?? {})[SHOW_IMAGES_KEYWORD] === true
        ? "message-allowed"
        : "blocked",
    hasAttachment: e.hasAttachment === true,
    textBody: resolveBody(e.textBody, e.bodyValues, "text/plain"),
    htmlBody: resolveBody(e.htmlBody, e.bodyValues, "text/html"),
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
    // sujet du fil = sujet du 1er message chronologique (ordre emailIds)
    subject: messages[0]?.subject ?? "",
    messages,
    emailIds,
    starred: list.some((e) => (e.keywords ?? {}).$flagged === true),
    unread: messages.some((m) => m.unread),
  }
}

// ---------------------------------------------------------------------------
// Task 4 — setFlagsFn (favori / lu-non-lu via keywords)
// ---------------------------------------------------------------------------

type MailFlag = "$seen" | "$flagged"

// Pur : Email/set qui patch un keyword sur plusieurs emails (true=ajoute, false=retire via null).
export function buildSetFlagsCall(
  accountId: string,
  emailIds: string[],
  flag: MailFlag,
  value: boolean
): JmapMethodCall[] {
  const patch = value ? true : null
  const update: Record<string, Record<string, true | null>> = {}
  for (const id of emailIds) update[id] = { [`keywords/${flag}`]: patch }
  return [["Email/set", { accountId, update }, "0"]]
}

export const emailIdsSchema = z.array(z.string().min(1).max(64)).min(1).max(500)

const setFlagsSchema = z.object({
  emailIds: emailIdsSchema,
  flag: z.enum(["$seen", "$flagged"]),
  value: z.boolean(),
})

export const setFlagsFn = createServerFn({ method: "POST" })
  .validator((d: { emailIds: string[]; flag: MailFlag; value: boolean }) =>
    setFlagsSchema.parse(d)
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    try {
      const { jmapUserCall } = await import("./jmap-user")
      const { sid, accountId } = await requireSession()
      await jmapUserCall(
        sid,
        buildSetFlagsCall(accountId, data.emailIds, data.flag, data.value)
      )
      return { ok: true }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("mail action failed", e)
      throw new Error("mail action failed")
    }
  })

// ---------------------------------------------------------------------------
// #70 — Persistance « Afficher les images »
// Par message : keyword JMAP custom. Par expéditeur : store allowlist (côté serveur).
// ---------------------------------------------------------------------------

// Pur : Email/set posant le keyword stalmail_showimages sur plusieurs emails.
export function buildShowImagesCall(
  accountId: string,
  emailIds: string[]
): JmapMethodCall[] {
  const update: Record<string, Record<string, true>> = {}
  for (const id of emailIds)
    update[id] = { [`keywords/${SHOW_IMAGES_KEYWORD}`]: true }
  return [["Email/set", { accountId, update }, "0"]]
}

export const showImagesSchema = z.object({ emailIds: emailIdsSchema })

export const showImagesOnceFn = createServerFn({ method: "POST" })
  .validator((d: { emailIds: string[] }) => showImagesSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    try {
      const { jmapUserCall } = await import("./jmap-user")
      const { sid, accountId } = await requireSession()
      await jmapUserCall(sid, buildShowImagesCall(accountId, data.emailIds))
      return { ok: true }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("mail action failed", e)
      throw new Error("mail action failed")
    }
  })

// Anti-traceur : faire confiance à un expéditeur charge AUTOMATIQUEMENT ses images
// distantes (pixels de tracking inclus) sur tous ses futurs mails. Choix explicite et
// révocable (untrustSenderFn). Jamais de « tout afficher » global. L'allowlist est
// scopée à l'accountId de session — aucune valeur influençable par le client n'y entre
// hors l'adresse normalisée.
export const senderSchema = z.object({ sender: z.string().email().max(320) })

export const trustSenderFn = createServerFn({ method: "POST" })
  .validator((d: { sender: string }) => senderSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    try {
      const { addSender } = await import("./image-prefs-store")
      const { accountId } = await requireSession()
      addSender(accountId, normalizeSender(data.sender))
      return { ok: true }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("mail action failed", e)
      throw new Error("mail action failed")
    }
  })

export const untrustSenderFn = createServerFn({ method: "POST" })
  .validator((d: { sender: string }) => senderSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    try {
      const { removeSender } = await import("./image-prefs-store")
      const { accountId } = await requireSession()
      removeSender(accountId, normalizeSender(data.sender))
      return { ok: true }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("mail action failed", e)
      throw new Error("mail action failed")
    }
  })

// ---------------------------------------------------------------------------
// Task 5 — moveThreadFn (archiver / corbeille / spam)
// ---------------------------------------------------------------------------

export type MoveTarget = "archive" | "trash" | "junk" | "inbox"

// Pur : target (UI) → mailboxId, résolu côté serveur depuis Mailbox/get. Accepte 'spam' alias de 'junk'.
export function resolveTargetMailbox(
  target: MoveTarget | "spam",
  mailboxes: MailboxRef[]
): string | undefined {
  const role: string = target === "spam" ? "junk" : target
  return mailboxIdByRole(mailboxes, role)
}

// Rôle JMAP que l'UI attend mais que Stalwart **ne provisionne pas** par défaut (#73) :
// on le crée à la volée au 1er usage. Inbox/Sent/Drafts/Junk/Trash sont déjà fournis par
// les defaultFolders intégrés de Stalwart — seul 'archive' manque. Enum fermé : aucune
// valeur influençable par le client n'atteint le Mailbox/set create.
type ProvisionableRole = "archive"
// Le name n'est pas directement visible (la sidebar affiche un libellé i18n keyé par
// dossier), mais on reste cohérent avec les noms anglais des dossiers par défaut de Stalwart.
const PROVISIONABLE_ROLES: ReadonlyMap<ProvisionableRole, string> = new Map([
  ["archive", "Archive"],
])

// Pur : target (UI) → {role, name} si ce rôle est provisionnable à la volée, sinon undefined.
export function provisionableRole(
  target: MoveTarget | "spam"
): { role: ProvisionableRole; name: string } | undefined {
  const role = target === "spam" ? "junk" : target
  // .get n'accepte qu'une ProvisionableRole ; un role hors enum ne matche jamais.
  if (role !== "archive") return undefined
  const name = PROVISIONABLE_ROLES.get(role)
  return name === undefined ? undefined : { role, name }
}

// Pur : Mailbox/get des {id, role} de tous les mailboxes (résolution de cible).
export function buildMailboxRolesCall(accountId: string): JmapMethodCall {
  return [
    "Mailbox/get",
    { accountId, ids: null, properties: ["id", "role"] },
    "0",
  ]
}

// Pur : Mailbox/set créant un dossier système top-level (role posé à la création).
// role est borné à l'enum fermé ProvisionableRole (cf. provisionableRole).
export function buildCreateMailboxCall(
  accountId: string,
  role: ProvisionableRole,
  name: string,
  creationId: string
): JmapMethodCall {
  return [
    "Mailbox/set",
    { accountId, create: { [creationId]: { name, role, parentId: null } } },
    "0",
  ]
}

// Pur : id du mailbox fraîchement créé (Mailbox/set.created[creationId].id), ou undefined
// si la création a été rejetée (notCreated) ou absente.
export function parseCreatedMailboxId(
  responses: JmapMethodResponse[],
  creationId: string
): string | undefined {
  const set = responses.find(([name]) => name === "Mailbox/set")
  const created = set?.[1].created as
    | Record<string, { id?: string }>
    | undefined
  return created?.[creationId]?.id
}

// Pur : extrait {id, mailboxIds[]} depuis les réponses Email/get.
export function parseEmailMailboxes(
  responses: JmapMethodResponse[]
): { id: string; mailboxIds: string[] }[] {
  const get = responses.find(([name]) => name === "Email/get")
  const raw = get?.[1].list
  const list = (Array.isArray(raw) ? raw : []) as {
    id: string
    mailboxIds?: Record<string, boolean>
  }[]
  return list.map((e) => ({
    id: e.id,
    mailboxIds: e.mailboxIds ? Object.keys(e.mailboxIds) : [],
  }))
}

// Pur : PATCH CIBLÉ (F3). Retire chaque email de ses dossiers SYSTÈME actuels (role != null)
// et l'ajoute à la cible ; PRÉSERVE les mailboxes sans role (futurs labels, 4d). Remplace
// l'ancienne approche « écraser mailboxIds » qui détruisait labels/multi-dossiers.
export function buildMovePatch(
  accountId: string,
  emails: { id: string; mailboxIds: string[] }[],
  mailboxes: MailboxRef[],
  targetId: string
): JmapMethodCall[] {
  const roleIds = new Set(
    mailboxes.filter((m) => m.role !== null).map((m) => m.id)
  )
  const update: Record<string, Record<string, true | null>> = {}
  for (const e of emails) {
    const patch: Record<string, true | null> = {
      [`mailboxIds/${targetId}`]: true,
    }
    for (const mid of e.mailboxIds) {
      if (mid !== targetId && roleIds.has(mid))
        patch[`mailboxIds/${mid}`] = null
    }
    update[e.id] = patch
  }
  return [["Email/set", { accountId, update }, "0"]]
}

const moveSchema = z.object({
  emailIds: emailIdsSchema,
  to: z.enum(["archive", "trash", "junk", "inbox", "spam"]),
})

export const moveThreadFn = createServerFn({ method: "POST" })
  .validator((d: { emailIds: string[]; to: MoveTarget | "spam" }) =>
    moveSchema.parse(d)
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    try {
      const { jmapUserCall } = await import("./jmap-user")
      const { sid, accountId } = await requireSession()
      // 1er aller-retour (2 reads batchés) : rôles des mailboxes + mailboxIds actuels des emails.
      const reads = await jmapUserCall(sid, [
        buildMailboxRolesCall(accountId),
        [
          "Email/get",
          {
            accountId,
            ids: data.emailIds,
            properties: ["id", "mailboxIds"],
          },
          "1",
        ],
      ])
      const refs = mailboxRefs(reads)
      let targetId = resolveTargetMailbox(data.to, refs)
      if (targetId === undefined) {
        // Provisioning à la volée (#73) : Stalwart ne crée pas de dossier 'archive'.
        // On le crée au 1er archivage (vaut pour comptes neufs et existants).
        const prov = provisionableRole(data.to)
        if (prov === undefined)
          throw new Error("move: target mailbox unavailable") // message générique (F4)
        const created = await jmapUserCall(sid, [
          buildCreateMailboxCall(accountId, prov.role, prov.name, "newbox"),
        ])
        targetId = parseCreatedMailboxId(created, "newbox")
        if (targetId === undefined) {
          // Create rejeté : course concurrente probable — un autre archivage a déjà
          // créé le dossier, et l'unicité de rôle (RFC 8621 §2 : un seul mailbox par
          // rôle) fait rejeter ce 2e create. On re-lit les mailboxes et on re-résout
          // avant d'abandonner.
          const reread = await jmapUserCall(sid, [
            buildMailboxRolesCall(accountId),
          ])
          targetId = resolveTargetMailbox(data.to, mailboxRefs(reread))
          if (targetId === undefined)
            throw new Error("move: target mailbox unavailable")
        }
      }
      const emails = parseEmailMailboxes(reads)
      await jmapUserCall(sid, buildMovePatch(accountId, emails, refs, targetId))
      return { ok: true }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("mail action failed", e)
      throw new Error("mail action failed")
    }
  })

const readThreadSchema = z.object({ threadId: z.string().min(1).max(64) })

// READ-ONLY (invariant design §2.5) : aucun Email/set ici.
export const readThreadFn = createServerFn({ method: "GET" })
  .validator((d: { threadId: string }) => readThreadSchema.parse(d))
  .handler(async ({ data }): Promise<AppThreadDetail> => {
    try {
      const { jmapUserCall } = await import("./jmap-user")
      const { sid, accountId } = await requireSession()
      const responses = await jmapUserCall(
        sid,
        buildReadThreadCalls(accountId, data.threadId)
      )
      const { getPrefs } = await import("./image-prefs-store")
      return applyImagePrefs(parseThreadDetail(responses), getPrefs(accountId))
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("mail action failed", e)
      throw new Error("mail action failed")
    }
  })

// ─── Composer / Envoi ────────────────────────────────────────────────────────

const addressSchema = z.object({
  name: z
    .string()
    .max(255)
    .refine(isCleanHeaderValue, "name: caractère interdit"),
  email: z.string().email().max(320),
})

const headerLine = z
  .string()
  .max(998)
  .refine(isCleanHeaderValue, "en-tête: caractère interdit")

const messageId = z.string().min(3).max(998).refine(isCleanHeaderValue)

export const sendMailSchema = z
  .object({
    mode: z.enum(["compose", "reply", "replyAll", "forward"]),
    to: z.array(addressSchema).max(100),
    cc: z.array(addressSchema).max(100),
    bcc: z.array(addressSchema).max(100),
    subject: headerLine,
    html: z.string().max(256 * 1024),
    inReplyTo: messageId.optional(),
    references: z.array(messageId).max(50),
  })
  .refine((d) => d.to.length + d.cc.length + d.bcc.length <= 100, {
    message: "trop de destinataires",
  })
  .refine((d) => d.to.length + d.cc.length + d.bcc.length >= 1, {
    message: "au moins un destinataire",
  })

type SendMailInput = z.infer<typeof sendMailSchema>

export const sendMailFn = createServerFn({ method: "POST" })
  .validator((d: SendMailInput) => sendMailSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; emailId: string }> => {
    try {
      const { jmapUserCall, SUBMISSION_CAPABILITIES } =
        await import("./jmap-user")
      const { consumeSendSlot } = await import("./send-rate-limit")
      const { sid, accountId } = await requireSession()

      // P2 : currentSession n'expose PAS d'email (uniquement { accountId, accountName }).
      // La clé de rate-limit anti-spam est donc l'accountId (stable, par compte).
      // Consommation ATOMIQUE du créneau avant tout await (CodeRabbit #7) : empêche deux
      // envois concurrents de dépasser le cap en passant tous deux le check avant enregistrement.
      if (!consumeSendSlot(accountId)) {
        throw new Error("send rate limited")
      }

      // Lecture : dossiers drafts/sent + identités (R1).
      const readResponses = await jmapUserCall(sid, [
        [
          "Mailbox/get",
          { accountId, ids: null, properties: ["id", "role"] },
          "0",
        ],
        ["Identity/get", { accountId, ids: null }, "1"],
      ])
      const mailboxes = mailboxRefs(readResponses)
      const draftsId = mailboxIdByRole(mailboxes, "drafts")
      const sentId = mailboxIdByRole(mailboxes, "sent")
      // accountEmail inconnu côté session → "" : pickSendIdentity retombe sur la première
      // identité du compte (toujours scopée à l'accountId de session par Identity/get, R1).
      const identity = pickSendIdentity(readResponses, "")
      if (!draftsId || !sentId || !identity) {
        throw new Error("send: mailbox/identity unavailable")
      }

      // Sanitisation autoritaire serveur (B2) + alternative texte.
      const html = sanitizeComposeHtml(data.html)
      const text = htmlToPlainText(html)
      const body: SendBody = {
        to: data.to,
        cc: data.cc,
        bcc: data.bcc,
        subject: data.subject,
        html,
        text,
        inReplyTo: data.inReplyTo,
        references: data.references,
      }

      const responses = await jmapUserCall(
        sid,
        buildSendMethodCalls(accountId, body, { draftsId, sentId, identity }),
        SUBMISSION_CAPABILITIES
      )
      const result = parseSendResult(responses)
      if (!result.ok) throw new Error(`send failed: ${result.code}`)
      // Pas de recordSend ici : le créneau a déjà été consommé atomiquement en tête (#7).
      return { ok: true, emailId: result.emailId }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("send mail failed", e) // R6 : détail en logs serveur uniquement
      throw new Error("send mail failed")
    }
  })
