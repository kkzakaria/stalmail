import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon, Avatar } from "./mail-icons"
import { formatThreadDate } from "./format-date"
import { pickBody, buildFrameDoc, hasRemoteImages } from "./email-body"
import type { AppMessage } from "../../server/mail-types"

export function MessageItem({
  message,
  defaultOpen = false,
  onShowOnce,
  onHideImages,
  onTrustSender,
  onUntrustSender,
}: {
  message: AppMessage
  defaultOpen?: boolean
  onShowOnce?: (emailId: string) => void
  onHideImages?: (emailId: string) => void
  onTrustSender?: (sender: string) => void
  onUntrustSender?: (sender: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)

  // Décision d'affichage résolue côté serveur (readThreadFn). Absent → "blocked" (défaut sûr).
  const decision = message.imageDecision ?? "blocked"
  const showImages = decision !== "blocked"

  const lead = message.from.at(0)
  const leadName = lead?.name || lead?.email || "—"
  const senderEmail = lead?.email ?? ""
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
        <Avatar name={leadName} email={senderEmail} />
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
          {remote && decision === "blocked" && (
            <div className="img-block-banner">
              <span className="banner-note">
                {t("mail.reader.imagesBlocked")}
              </span>{" "}
              <button
                type="button"
                className="banner-btn"
                onClick={() => onShowOnce?.(message.id)}
              >
                {t("mail.reader.showImages")}
              </button>{" "}
              {senderEmail && (
                <button
                  type="button"
                  className="banner-btn"
                  onClick={() => onTrustSender?.(senderEmail)}
                >
                  {t("mail.reader.trustSender", { sender: senderEmail })}
                </button>
              )}
            </div>
          )}
          {remote && decision === "message-allowed" && (
            <div className="img-block-banner">
              <span className="banner-note">
                {t("mail.reader.imagesShown")}
              </span>{" "}
              <button
                type="button"
                className="banner-btn"
                onClick={() => onHideImages?.(message.id)}
              >
                {t("mail.reader.blockSender")}
              </button>
            </div>
          )}
          {remote && decision === "sender-allowed" && senderEmail && (
            <div className="img-block-banner">
              <span className="banner-note">
                {t("mail.reader.imagesFromSenderShown", {
                  sender: senderEmail,
                })}
              </span>{" "}
              <button
                type="button"
                className="banner-btn"
                onClick={() => onUntrustSender?.(senderEmail)}
              >
                {t("mail.reader.blockSender")}
              </button>
            </div>
          )}
          {body.kind === "text" ? (
            <p style={{ whiteSpace: "pre-wrap" }}>{body.content}</p>
          ) : (
            <iframe
              className="msg-html-frame"
              title={message.subject || leadName}
              // sandbox SANS allow-scripts/allow-same-origin/allow-forms : le HTML reste
              // inerte et en origine opaque. allow-popups laisse les liens user-cliqués s'ouvrir
              // dans un nouvel onglet (base target=_blank) au lieu du reader ; -to-escape-sandbox
              // est REQUIS pour que cet onglet soit un contexte NORMAL (sinon le site externe
              // hériterait du sandbox : pas de JS, origine opaque → cassé). Revue sécu : non
              // exploitable (pas de scripts pour auto-ouvrir, rel="noopener noreferrer" coupe opener).
              sandbox="allow-popups allow-popups-to-escape-sandbox"
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
