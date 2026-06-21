import type { MailAddress, AppThreadDetail } from "./mail-types"
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

// Construit le contexte de réponse/transfert depuis le dernier message du fil.
// quotedHtml passe TOUJOURS par sanitizeComposeHtml : le htmlBody d'origine est non fiable (B1).
export function buildReplyContext(
  detail: AppThreadDetail,
  mode: ComposeMode,
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

  if (mode === "forward") {
    return {
      to: [],
      cc: [],
      subject: prefixSubject(detail.subject, "Fwd"),
      references: [],
      quotedHtml,
    }
  }

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
