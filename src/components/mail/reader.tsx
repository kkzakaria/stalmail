import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { MessageItem } from "./message-item"
import { QuickReply } from "./quick-reply"
import { useQuickReplyDraft } from "./use-quick-reply-draft"
import type { AppThreadDetail } from "../../server/mail-types"
import type { MoveTo } from "./use-thread-actions"
import type { ComposerDraft } from "./use-composer"

export interface ReaderProps {
  folder: string
  detail: AppThreadDetail | undefined
  isLoading: boolean
  isError: boolean
  star: (value: boolean) => void
  markRead: (value: boolean) => void
  move: (to: MoveTo) => void
  onBack: () => void
  onSend?: (draft: ComposerDraft) => boolean | void | Promise<boolean | void>
  sending?: boolean
  selfEmail?: string
  onShowOnce?: (emailId: string) => void
  onHideImages?: (emailId: string) => void
  onTrustSender?: (sender: string) => void
  onUntrustSender?: (sender: string) => void
}

export function Reader({
  folder,
  detail,
  isLoading,
  isError,
  star,
  markRead,
  move,
  onBack,
  onSend,
  sending,
  selfEmail,
  onShowOnce,
  onHideImages,
  onTrustSender,
  onUntrustSender,
}: ReaderProps) {
  const { t } = useTranslation()
  // Instancié avant les early-returns (règle des hooks) : l'état du brouillon
  // de réponse rapide vit ici pour être partagé avec le transfert par-message.
  const quickReply = useQuickReplyDraft(detail, selfEmail ?? "")

  if (isError) {
    return (
      <section className="reader">
        <div className="empty">
          <div>
            <p>{t("mail.reader.loadError")}</p>
          </div>
        </div>
      </section>
    )
  }

  if (isLoading && !detail) {
    return (
      <section className="reader">
        <div className="reader-bar" aria-hidden="true" />
        <div className="reader-scroll scroll">
          <div className="reader-inner">
            <div className="msg msg-skeleton" aria-hidden="true">
              <div className="skel-line skel-line-1" />
              <div className="skel-line skel-line-2" />
            </div>
          </div>
        </div>
      </section>
    )
  }

  if (!detail && !isLoading) {
    return (
      <section className="reader">
        <div className="empty">
          <div>
            <div className="glyph">
              <Icon name="mail-open" size={28} />
            </div>
            <h3>{t("mail.reader.empty")}</h3>
            <p>{t("mail.reader.emptyHint")}</p>
          </div>
        </div>
      </section>
    )
  }

  const inSpam = folder === "spam"

  return (
    <section className="reader">
      <div className="reader-bar">
        <button
          className="icon-btn sm"
          onClick={onBack}
          aria-label={t("mail.reader.back")}
          title={t("mail.reader.back")}
        >
          <Icon name="chev-left" size={18} />
        </button>
        <button
          className="icon-btn sm act-pos"
          aria-label={t("mail.reader.archive")}
          title={t("mail.reader.archive")}
          onClick={() => move("archive")}
        >
          <Icon name="archive" size={17} />
        </button>
        <button
          className="icon-btn sm act-danger"
          aria-label={t("mail.reader.trash")}
          title={t("mail.reader.trash")}
          onClick={() => move("trash")}
        >
          <Icon name="trash2" size={17} />
        </button>
        {inSpam ? (
          <button
            className="icon-btn sm act-pos"
            aria-label={t("mail.reader.notSpam")}
            title={t("mail.reader.notSpam")}
            onClick={() => move("inbox")}
          >
            <Icon name="inbox" size={17} />
          </button>
        ) : (
          <button
            className="icon-btn sm act-danger"
            aria-label={t("mail.reader.spam")}
            title={t("mail.reader.spam")}
            onClick={() => move("spam")}
          >
            <Icon name="spam" size={17} />
          </button>
        )}
        <span className="sp" />
        <button
          className={"icon-btn sm act-star" + (detail?.starred ? " on" : "")}
          style={detail?.starred ? { color: "#e8b23a" } : undefined}
          aria-label={t("mail.reader.star")}
          aria-pressed={detail?.starred ?? false}
          title={t("mail.reader.star")}
          onClick={() => star(!detail?.starred)}
        >
          <Icon name={detail?.starred ? "star-fill" : "star"} size={17} />
        </button>
        <button
          className="icon-btn sm"
          aria-label={t("mail.reader.markUnread")}
          title={t("mail.reader.markUnread")}
          onClick={() => markRead(false)}
        >
          <Icon name="mail" size={17} />
        </button>
      </div>

      <div className="reader-scroll scroll">
        <div className="reader-inner">
          {detail && (
            <>
              <div className="thread-head">
                <div className="thread-subject">{detail.subject}</div>
                <div className="thread-meta">
                  <span className="row-time" style={{ marginLeft: "auto" }}>
                    {t("mail.reader.messages", {
                      count: detail.messages.length,
                    })}
                  </span>
                </div>
              </div>

              {detail.messages.map((m, i) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  defaultOpen={i === detail.messages.length - 1}
                  onShowOnce={onShowOnce}
                  onHideImages={onHideImages}
                  onTrustSender={onTrustSender}
                  onUntrustSender={onUntrustSender}
                  onForward={onSend ? quickReply.openForward : undefined}
                />
              ))}

              {onSend && (
                <QuickReply
                  draft={quickReply.draft}
                  sending={sending ?? false}
                  onOpenReply={quickReply.openReply}
                  onPatch={quickReply.patch}
                  onClose={quickReply.close}
                  onSend={onSend}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
