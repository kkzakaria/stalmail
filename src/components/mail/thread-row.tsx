import { Icon, Avatar } from './mail-icons'
import { formatThreadDate } from './format-date'
import type { AppThread } from '../../server/mail-types'

const RECIPIENT_FOLDERS = new Set(['sent', 'drafts'])

export function ThreadRow({
  thread,
  folder,
  selected = false,
  now,
  onOpen,
}: {
  thread: AppThread | undefined
  folder: string
  selected?: boolean
  now?: Date
  onOpen?: (id: string) => void
}) {
  if (!thread) {
    return (
      <div className="row row-skeleton" aria-hidden="true">
        <div className="row-rail">
          <span className="avatar avatar-skel" />
        </div>
        <div className="row-main">
          <div className="skel-line skel-line-1" />
          <div className="skel-line skel-line-2" />
        </div>
      </div>
    )
  }

  const addrs = RECIPIENT_FOLDERS.has(folder) ? thread.to : thread.from
  const lead = addrs.at(0)
  const leadName = lead?.name || lead?.email || '—'
  const leadEmail = lead?.email ?? ''

  return (
    <div
      className={'row' + (thread.unread ? ' unread' : '') + (selected ? ' sel' : '')}
      onClick={() => onOpen?.(thread.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen?.(thread.id) }}
      role="button"
      tabIndex={0}
    >
      <div className="row-rail">
        <span className="unread-dot" />
        <Avatar name={leadName} email={leadEmail} />
      </div>
      <div className="row-main">
        <div className="row-line1">
          <span className="from-name">{leadName}</span>
          {thread.messageCount > 1 && <span className="thread-count">{thread.messageCount}</span>}
          {thread.starred && <Icon name="star-fill" size={14} className="row-star" />}
          <span className="row-date">{formatThreadDate(thread.receivedAt, now)}</span>
        </div>
        <div className="row-line2">
          <span className="subject">{thread.subject}</span>
          <span className="snippet">{thread.preview}</span>
          {thread.hasAttachment && <Icon name="paperclip" size={14} className="row-attach" />}
        </div>
      </div>
    </div>
  )
}
