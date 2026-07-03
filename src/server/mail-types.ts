// Types partagés entre server functions (mail-actions) et composants UI (mail/*).
export interface AppMailbox {
  id: string
  name: string
  role: string | null // 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | null
  unreadEmails: number
  totalEmails: number
  sortOrder: number
}

// Dossiers virtuels sans mailbox JMAP réelle.
export type VirtualFolder = "starred" | "snoozed"

export interface MailAddress {
  name: string
  email: string
}

export interface AppThread {
  id: string // id de l'email représentatif (résultat collapsé Email/query)
  threadId: string
  subject: string
  preview: string
  from: MailAddress[]
  to: MailAddress[]
  messageCount: number
  receivedAt: string // ISO 8601
  unread: boolean // !keywords['$seen']
  starred: boolean // keywords['$flagged'] === true
  hasAttachment: boolean
  mailboxIds: string[]
}

export interface EmailListPage {
  threads: AppThread[]
  total: number
  position: number
  queryState?: string // réservé pour Email/queryChanges (Plan 4d)
}

export interface MailBodyPart {
  partId?: string
  type: string // 'text/plain' | 'text/html' | …
  value?: string // résolu depuis bodyValues
}

export interface AppAttachment {
  blobId: string
  name: string
  type: string
  size: number
}

export type ImageDecision = "sender-allowed" | "message-allowed" | "blocked"

// Verdict DMARC extrait d'Authentication-Results (#126). "none" = pas de verdict
// (courrier interne via soumission, ou en-tête absent/illisible — fail-closed).
export type AuthVerdict = "pass" | "fail" | "none"

export interface AppMessage {
  id: string
  messageId: string | null // Message-ID RFC (ex. "<abc@host>"), null si absent
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  receivedAt: string // ISO 8601
  unread: boolean
  hasAttachment: boolean
  textBody: string | null
  htmlBody: string | null
  attachments: AppAttachment[]
  // Décision d'affichage des images distantes, résolue côté serveur (readThreadFn).
  // Absent (client bundle / factories de test) → traité comme "blocked" (défaut sûr).
  imageDecision?: ImageDecision
}

export interface AppThreadDetail {
  threadId: string
  subject: string
  messages: AppMessage[] // ordre chronologique (selon emailIds du Thread)
  emailIds: string[] // pour les actions au niveau fil
  starred: boolean // agrégat ($flagged sur au moins un message)
  unread: boolean // agrégat (au moins un message non lu)
}
