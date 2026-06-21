import type { MailAddress, AppThreadDetail } from "./mail-types"
import { sanitizeComposeHtml } from "../lib/compose-html"

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
