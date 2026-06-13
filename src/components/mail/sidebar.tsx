import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Icon } from './mail-icons'
import type { AppMailbox } from '../../server/mail-types'

// Ordre figé sur la maquette : virtuels intercalés après inbox (spec §2.2).
export const FOLDER_ORDER = [
  'inbox', 'starred', 'snoozed', 'sent', 'drafts', 'archive', 'spam', 'trash',
] as const

const ICON_BY_FOLDER: Record<string, string> = {
  inbox: 'inbox', starred: 'star', snoozed: 'clock', sent: 'send',
  drafts: 'draft', archive: 'archive', spam: 'spam', trash: 'trash',
}
const UNREAD_BADGE_ON = new Set(['inbox', 'drafts'])

export function AppSidebar({
  mailboxes,
  activeFolder,
  accountName,
}: {
  mailboxes: AppMailbox[]
  activeFolder: string
  accountName: string
}) {
  const { t } = useTranslation()
  const byRole = new Map<string, AppMailbox>(
    mailboxes.filter((m): m is AppMailbox & { role: string } => m.role !== null).map((m) => [m.role, m]),
  )

  return (
    <nav className="nav">
      <div className="nav-head">
        <div className="account">
          <span className="avatar" aria-hidden="true">
            {accountName.slice(0, 1).toUpperCase()}
          </span>
          <span className="meta">
            <b>{accountName}</b>
            <span>{accountName}</span>
          </span>
        </div>
      </div>

      <button className="compose-btn" disabled aria-label={t('mail.compose')}>
        <Icon name="compose" size={16} />
        {t('mail.compose')}
      </button>

      <div className="nav-scroll">
        {FOLDER_ORDER.map((folder) => {
          const mbx = byRole.get(folder)
          const unread = mbx?.unreadEmails ?? 0
          return (
            <Link
              key={folder}
              to="/mail/$folder"
              params={{ folder }}
              className={'nav-item' + (folder === activeFolder ? ' active' : '')}
            >
              <Icon name={ICON_BY_FOLDER[folder] ?? folder} size={18} className="ico" />
              <span className="txt">{t(`mail.${folder}`)}</span>
              {UNREAD_BADGE_ON.has(folder) && unread > 0 && <span className="count">{unread}</span>}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
