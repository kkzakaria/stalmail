import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { MessageItem } from "./message-item"
import type { AppThreadDetail } from "../../server/mail-types"

export interface ReaderProps {
  folder: string
  detail: AppThreadDetail | undefined
  isLoading: boolean
  isError: boolean
  star: (value: boolean) => void
  markRead: (value: boolean) => void
  move: (to: "archive" | "trash" | "junk" | "inbox" | "spam") => void
  onBack: () => void
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
}: ReaderProps) {
  const { t } = useTranslation()

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
          title={t("mail.reader.back")}
        >
          <Icon name="chev-left" size={18} />
        </button>
        <button
          className="icon-btn sm"
          title={t("mail.reader.archive")}
          onClick={() => move("archive")}
        >
          <Icon name="archive" size={17} />
        </button>
        <button
          className="icon-btn sm"
          title={t("mail.reader.trash")}
          onClick={() => move("trash")}
        >
          <Icon name="trash2" size={17} />
        </button>
        <button
          className="icon-btn sm"
          title={t("mail.reader.snooze")}
          disabled
        >
          <Icon name="clock" size={17} />
        </button>
        {inSpam ? (
          <button
            className="icon-btn sm"
            title={t("mail.reader.notSpam")}
            onClick={() => move("inbox")}
          >
            <Icon name="mail-open" size={17} />
          </button>
        ) : (
          <button
            className="icon-btn sm"
            title={t("mail.reader.spam")}
            onClick={() => move("spam")}
          >
            <Icon name="spam" size={17} />
          </button>
        )}
        <button className="icon-btn sm" title={t("mail.reader.label")} disabled>
          <Icon name="tag" size={17} />
        </button>
        <span className="sp" />
        <button
          className={"icon-btn sm" + (detail?.starred ? " on" : "")}
          title={t("mail.reader.star")}
          onClick={() => star(!detail?.starred)}
        >
          <Icon name={detail?.starred ? "star-fill" : "star"} size={17} />
        </button>
        <button
          className="icon-btn sm"
          title={t("mail.reader.markUnread")}
          onClick={() => markRead(false)}
        >
          <Icon name="mail-open" size={17} />
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
                />
              ))}

              <div className="reply-bar">
                <button
                  className="reply-bar-main"
                  disabled
                  title={t("mail.reader.reply")}
                >
                  <Icon name="reply" size={16} />
                  <span className="rb-text">{t("mail.reader.reply")}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
