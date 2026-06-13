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
export type VirtualFolder = 'starred' | 'snoozed'

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
