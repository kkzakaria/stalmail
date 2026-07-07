import type {
  MailAddress,
  AppThreadDetail,
  AppMessage,
  AppAttachment,
} from "./mail-types"
import { sanitizeComposeHtml } from "../lib/compose-html"
import type { JmapMethodResponse, JmapMethodCall } from "./jmap"

// Rejette les caractères de contrôle interdits dans une valeur d'en-tête (B3 anti-CRLF).
export function isCleanHeaderValue(s: string): boolean {
  // eslint-disable-next-line no-control-regex -- intention sécurité B3 : caractères de contrôle volontairement recherchés
  return !/[\r\n\x00]/.test(s)
}

// Validation email volontairement simple et stricte (pas de display-name autorisé ici).
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

// Parse une saisie "Nom <a@b>, c@d" en adresses structurées. Tout segment dont l'email
// est invalide OU dont le name contient un caractère de contrôle est classé "invalid".
export function parseAddressList(raw: string): {
  valid: MailAddress[]
  invalid: string[]
} {
  const valid: MailAddress[] = []
  const invalid: string[] = []
  for (const segment of raw.split(",")) {
    const seg = segment.trim()
    if (seg === "") continue
    // R-B : name sans <>, email sans <>@espace — refuse "X <a@b> <c@d>" plutôt que de l'absorber.
    const m = /^([^<>]*)<([^<>\s]+@[^<>\s]+)>$/.exec(seg)
    const name = m ? m[1].trim() : ""
    const email = (m ? m[2] : seg).trim()
    if (
      EMAIL_RE.test(email) &&
      isCleanHeaderValue(email) &&
      isCleanHeaderValue(name)
    ) {
      valid.push({ name, email })
    } else {
      invalid.push(seg)
    }
  }
  return { valid, invalid }
}

export type ComposeMode = "compose" | "reply" | "replyAll" | "forward"

export interface ReplyContext {
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  inReplyTo?: string
  references: string[]
  quotedHtml: string
}

function prefixSubject(subject: string, prefix: "Re" | "Fwd"): string {
  const re = new RegExp(`^${prefix}:\\s*`, "i")
  return re.test(subject) ? subject : `${prefix}: ${subject}`
}

function dedupeByEmail(
  addrs: MailAddress[],
  excludeEmail: string
): MailAddress[] {
  const seen = new Set<string>([excludeEmail.toLowerCase()])
  const out: MailAddress[] = []
  for (const a of addrs) {
    const key = a.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

// Construit le contexte de réponse depuis le dernier message du fil. Le transfert
// a son propre chemin (buildForwardContext, par-message — #79).
// quotedHtml passe TOUJOURS par sanitizeComposeHtml : le htmlBody d'origine est non fiable (B1).
export function buildReplyContext(
  detail: AppThreadDetail,
  mode: "reply" | "replyAll",
  selfEmail: string,
  lastMessageId?: string
): ReplyContext {
  const last = detail.messages.at(-1)
  if (!last) throw new Error("buildReplyContext: fil sans message")
  const references = lastMessageId ? [lastMessageId] : []

  const quotedHtml = last.htmlBody
    ? sanitizeComposeHtml(
        `<p><br></p><blockquote>${last.htmlBody}</blockquote>`
      )
    : ""

  const to = last.from
  const cc =
    mode === "replyAll"
      ? dedupeByEmail([...last.to, ...last.cc], selfEmail).filter(
          (a) => a.email.toLowerCase() !== to[0]?.email.toLowerCase()
        )
      : []

  return {
    to,
    cc,
    subject: prefixSubject(detail.subject, "Re"),
    inReplyTo: lastMessageId,
    references,
    quotedHtml,
  }
}

// Échappe une valeur non fiable avant interpolation dans le HTML du composer.
// Requis pour la sécurité (nom d'expéditeur hostile) ET la correction : les
// adresses "Nom <a@b>" seraient sinon avalées comme balises par DOMPurify.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export interface ForwardLabels {
  forwarded: string
  from: string
  date: string
  subject: string
  to: string
  cc: string
}

export interface ForwardContext {
  subject: string
  quotedHtml: string
  attachments: AppAttachment[]
}

// Contexte de transfert d'UN message (issue #79) : bloc d'en-tête + corps cité +
// pièces jointes de l'original. Libellés injectés (i18n en couche UI, fonction pure).
// quotedHtml passe TOUJOURS par sanitizeComposeHtml (B1) ; champs interpolés échappés.
export function buildForwardContext(
  message: AppMessage,
  threadSubject: string,
  labels: ForwardLabels,
  locale: string
): ForwardContext {
  const addr = (a: MailAddress) => (a.name ? `${a.name} <${a.email}>` : a.email)
  const list = (as: MailAddress[]) => as.map(addr).join(", ")
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(message.receivedAt))

  const lines = [
    `---------- ${escapeHtml(labels.forwarded)} ----------`,
    `${escapeHtml(labels.from)} : ${escapeHtml(list(message.from))}`,
    `${escapeHtml(labels.date)} : ${escapeHtml(date)}`,
    `${escapeHtml(labels.subject)} : ${escapeHtml(message.subject)}`,
    `${escapeHtml(labels.to)} : ${escapeHtml(list(message.to))}`,
  ]
  if (message.cc.length > 0) {
    lines.push(`${escapeHtml(labels.cc)} : ${escapeHtml(list(message.cc))}`)
  }

  const body = message.htmlBody
    ? message.htmlBody
    : `<p>${escapeHtml(message.textBody ?? "").replace(/\n/g, "<br>")}</p>`

  const quotedHtml = sanitizeComposeHtml(
    `<p><br></p><p>${lines.join("<br>")}</p><blockquote>${body}</blockquote>`
  )

  return {
    subject: prefixSubject(threadSubject, "Fwd"),
    quotedHtml,
    attachments: message.attachments,
  }
}

export interface SendIdentity {
  id: string
  name: string
  email: string
}

interface RawIdentity {
  id: string
  name?: string | null
  email: string
}

// Choisit l'identité d'expédition (R1 : jamais fournie par le client). Priorité à
// celle dont l'email == compte de session ; sinon la première.
export function pickSendIdentity(
  responses: JmapMethodResponse[],
  accountEmail: string
): SendIdentity | null {
  const get = responses.find(([name]) => name === "Identity/get")
  const raw = get?.[1].list
  const list: RawIdentity[] = Array.isArray(raw) ? (raw as RawIdentity[]) : []
  if (list.length === 0) return null
  const match =
    list.find((i) => i.email.toLowerCase() === accountEmail.toLowerCase()) ??
    list[0]
  return { id: match.id, name: match.name ?? "", email: match.email }
}

export interface SendBody {
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  html: string
  text: string
  inReplyTo?: string
  references: string[]
  attachments: AppAttachment[]
}

const EMAIL_CREATE_ID = "draft"
const SUBMISSION_CREATE_ID = "sub"

// Construit le batch Email/set (brouillon) + EmailSubmission/set (envoi). bcc UNIQUEMENT
// dans l'enveloppe (R2). from depuis l'identité serveur (R1). Threading via headers (B3).
export function buildSendMethodCalls(
  accountId: string,
  body: SendBody,
  ctx: { draftsId: string; sentId: string; identity: SendIdentity }
): JmapMethodCall[] {
  const draft: Record<string, unknown> = {
    mailboxIds: { [ctx.draftsId]: true },
    keywords: { $draft: true, $seen: true },
    from: [{ name: ctx.identity.name, email: ctx.identity.email }],
    to: body.to,
    subject: body.subject,
    bodyValues: {
      html: { value: body.html },
      plain: { value: body.text },
    },
    htmlBody: [{ partId: "html", type: "text/html" }],
    textBody: [{ partId: "plain", type: "text/plain" }],
  }
  if (body.cc.length > 0) draft.cc = body.cc
  if (body.inReplyTo)
    draft["header:In-Reply-To:asMessageIds"] = [body.inReplyTo]
  if (body.references.length > 0)
    draft["header:References:asMessageIds"] = body.references

  // Transfert (#79) : blobs existants du compte référencés tels quels (RFC 8621,
  // propriété de commodité). size jamais transmis — Stalwart le recalcule (F1/F2).
  if (body.attachments.length > 0) {
    draft.attachments = body.attachments.map((a) => ({
      blobId: a.blobId,
      type: a.type,
      name: a.name,
      disposition: "attachment",
    }))
  }

  // Enveloppe SMTP : tous les destinataires, bcc compris (mais jamais en en-tête).
  const rcptTo = [...body.to, ...body.cc, ...body.bcc].map((a) => ({
    email: a.email,
  }))

  return [
    ["Email/set", { accountId, create: { [EMAIL_CREATE_ID]: draft } }, "0"],
    [
      "EmailSubmission/set",
      {
        accountId,
        create: {
          [SUBMISSION_CREATE_ID]: {
            emailId: `#${EMAIL_CREATE_ID}`,
            identityId: ctx.identity.id,
            envelope: { mailFrom: { email: ctx.identity.email }, rcptTo },
          },
        },
        onSuccessUpdateEmail: {
          [`#${SUBMISSION_CREATE_ID}`]: {
            "keywords/$draft": null,
            [`mailboxIds/${ctx.draftsId}`]: null,
            [`mailboxIds/${ctx.sentId}`]: true,
          },
        },
      },
      "1",
    ],
  ]
}

export type SendErrorCode = "rejected" | "quota" | "failed"
export type SendResult =
  | { ok: true; emailId: string }
  | { ok: false; code: SendErrorCode }

function firstSetError(args: Record<string, unknown>): string | null {
  const nc = args.notCreated as
    | Record<string, { type?: string } | undefined>
    | undefined
  if (!nc) return null
  const first = Object.values(nc)[0]
  if (!first) return null
  return first.type ?? "unknown"
}

// Mappe les SetError JMAP/SMTP vers un code i18n fixe (R6 : aucun détail propagé).
export function parseSendResult(responses: JmapMethodResponse[]): SendResult {
  const emailSet = responses.find(([n]) => n === "Email/set")
  const submission = responses.find(([n]) => n === "EmailSubmission/set")

  const emailErr = emailSet ? firstSetError(emailSet[1]) : "unknown"
  if (emailErr) return { ok: false, code: "failed" }

  const subErr = submission ? firstSetError(submission[1]) : "unknown"
  if (subErr) {
    if (subErr === "overQuota") return { ok: false, code: "quota" }
    if (subErr === "forbiddenFrom" || subErr === "forbiddenToSend")
      return { ok: false, code: "rejected" }
    return { ok: false, code: "failed" }
  }

  // Succès réel uniquement si l'Email a un id ET la submission a été créée.
  const created = emailSet![1].created as
    | Record<string, { id?: string }>
    | undefined
  const emailId = created ? (Object.values(created)[0]?.id ?? null) : null
  const subCreated = submission![1].created as
    | Record<string, unknown>
    | undefined
  const submissionOk = subCreated ? Object.keys(subCreated).length > 0 : false
  if (!emailId || !submissionOk) return { ok: false, code: "failed" }
  return { ok: true, emailId }
}
