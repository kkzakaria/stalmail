import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon, Avatar } from "./mail-icons"
import { formatThreadDate } from "./format-date"
import { pickBody, buildFrameDoc, hasRemoteImages } from "./email-body"
import type { AppMessage } from "../../server/mail-types"

export function MessageItem({
  message,
  defaultOpen = false,
}: {
  message: AppMessage
  defaultOpen?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  // intentionnel : sticky par session (ne ré-alerte pas au repli/dépli)
  const [showImages, setShowImages] = useState(false)

  const lead = message.from.at(0)
  const leadName = lead?.name || lead?.email || "—"
  const body = useMemo(() => pickBody(message), [message])
  const remote = body.kind === "html" && hasRemoteImages(body.content)
  const frameDoc = useMemo(
    () =>
      body.kind === "html" ? buildFrameDoc(body.content, { showImages }) : "",
    [body, showImages]
  )

  return (
    <div className={"msg" + (open ? "" : " collapsed")}>
      <div
        className="msg-head"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setOpen((o) => !o)
          }
        }}
      >
        <Avatar name={leadName} email={lead?.email ?? ""} />
        <div className="who">
          <div className="nm">{leadName}</div>
          {open && message.to.length > 0 && (
            <div className="to">
              {t("mail.reader.to")}{" "}
              {message.to.map((r) => r.name || r.email).join(", ")}
            </div>
          )}
        </div>
        <div className="when">{formatThreadDate(message.receivedAt)}</div>
      </div>

      {open && (
        <div className="msg-body">
          {remote && !showImages && (
            <div className="img-block-banner">
              {t("mail.reader.imagesBlocked")}{" "}
              <button
                className="banner-btn"
                onClick={() => setShowImages(true)}
              >
                {t("mail.reader.showImages")}
              </button>
            </div>
          )}
          {body.kind === "text" ? (
            <p style={{ whiteSpace: "pre-wrap" }}>{body.content}</p>
          ) : (
            <iframe
              className="msg-html-frame"
              title={message.subject || leadName}
              sandbox=""
              srcDoc={frameDoc}
            />
          )}

          {message.attachments.length > 0 && (
            <div className="attach-row">
              {message.attachments.map((a) => (
                <button
                  key={a.blobId}
                  className="attach"
                  disabled
                  aria-label={a.name}
                >
                  <div className="fi">
                    {(a.type.split("/")[1] ?? t("mail.reader.file")).slice(
                      0,
                      4
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="fn">{a.name}</div>
                    <div className="fs">
                      {Math.ceil(a.size / 1024)} {t("mail.reader.sizeKB")}
                    </div>
                  </div>
                  <Icon name="download" size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
