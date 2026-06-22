import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { Avatar, Icon } from "./mail-icons"
import type { AppMailbox } from "../../server/mail-types"

// Ordre figé sur la maquette : virtuels intercalés après inbox (spec §2.2).
export const FOLDER_ORDER = [
  "inbox",
  "starred",
  "snoozed",
  "sent",
  "drafts",
  "archive",
  "spam",
  "trash",
] as const

const ICON_BY_FOLDER: Record<string, string> = {
  inbox: "inbox",
  starred: "star",
  snoozed: "clock",
  sent: "send",
  drafts: "draft",
  archive: "archive",
  spam: "spam",
  trash: "trash",
}
const UNREAD_BADGE_ON = new Set(["inbox", "drafts"])

export function AppSidebar({
  mailboxes,
  activeFolder,
  accountName,
  onCompose,
}: {
  mailboxes: AppMailbox[]
  activeFolder: string
  accountName: string
  onCompose?: () => void
}) {
  const { t } = useTranslation()
  const byRole = new Map<string, AppMailbox>(
    mailboxes
      .filter((m): m is AppMailbox & { role: string } => m.role !== null)
      .map((m) => [m.role, m])
  )

  return (
    <nav className="nav">
      {/* account-wrap (pas nav-head, réservé au logo « brand » qu'on ne rend pas) : évite
          le padding 16px superflu au-dessus du compte. */}
      <div className="account-wrap">
        <div className="account">
          <Avatar name={accountName} email={accountName} size={32} />
          <span className="meta">
            {/* La session n'expose que l'email (= username JMAP) ; pas de displayName distinct
                avant le Plan 4b. Les deux lignes affichent donc volontairement accountName. */}
            <b>{accountName}</b>
            <span>{accountName}</span>
          </span>
        </div>
      </div>

      <button
        className="compose-btn"
        onClick={onCompose}
        disabled={!onCompose}
        aria-label={t("mail.compose.newMessage")}
      >
        <Icon name="compose" size={16} />
        {t("mail.compose.newMessage")}
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
              className={
                "nav-item" + (folder === activeFolder ? " active" : "")
              }
            >
              <Icon
                name={ICON_BY_FOLDER[folder] ?? folder}
                size={18}
                className="ico"
              />
              <span className="txt">{t(`mail.${folder}`)}</span>
              {UNREAD_BADGE_ON.has(folder) && unread > 0 && (
                <span className="count">{unread}</span>
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
