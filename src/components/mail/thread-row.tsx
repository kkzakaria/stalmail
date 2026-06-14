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
        <div className="row-fg">
          <div className="row-rail">
            <span className="avatar avatar-skel" />
          </div>
          <div className="row-main">
            <div className="skel-line skel-line-1" />
            <div className="skel-line skel-line-2" />
          </div>
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
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen?.(thread.id)
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Ouvrir le message : ${thread.subject}`}
    >
      <div className="row-fg">
        <div className="row-rail">
          <span className="unread-dot" />
          <Avatar name={leadName} email={leadEmail} />
        </div>
        <div className="row-main">
          <div className="row-line1">
            <span className="from-name">
              {leadName}
              {thread.messageCount > 1 && (
                <span className="thread-count"> · {thread.messageCount}</span>
              )}
            </span>
            {thread.hasAttachment && (
              <Icon name="paperclip" size={13} className="row-attach" />
            )}
            <span className="row-time">{formatThreadDate(thread.receivedAt, now)}</span>
          </div>
          <div className="subj">{thread.subject}</div>
          <div className="snippet">{thread.preview}</div>
        </div>
        {thread.starred && (
          <span className="star-btn on" aria-hidden="true">
            <Icon name="star-fill" size={17} className="row-star" />
          </span>
        )}
      </div>
    </div>
  )
}
