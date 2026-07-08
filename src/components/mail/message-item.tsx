import { memo, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon, Avatar } from "./mail-icons"
import type { IconName } from "./mail-icons"
import { formatThreadDate } from "./format-date"
import { pickBody, buildFrameDoc, hasRemoteImages } from "./email-body"
import type { AppMessage } from "../../server/mail-types"

// Bandeau images factorisé (CodeRabbit #128) : les 3 variantes (blocked / message-allowed /
// sender-allowed) ne diffèrent que par le ton, l'icône, la note et les actions.
// Deux tons honnêtes : "shielded" (blocage actif = état sain, neutre) et "exposed"
// (contenu distant chargé = pixels de tracking possibles → c'est LUI qui porte le signal).
function ImageBanner({
  tone,
  icon,
  note,
  actions,
}: {
  tone: "shielded" | "exposed"
  icon: IconName
  note: string
  // Trois poids d'action : "primary" (ponctuel, plein accent), "tonal" (engagement,
  // accent doux) et défaut (neutre bordé — révocations).
  actions: {
    label: string
    onClick: () => void
    variant?: "primary" | "tonal"
  }[]
}) {
  return (
    <div
      className={"img-block-banner" + (tone === "exposed" ? " exposed" : "")}
      role="note"
    >
      <Icon name={icon} size={16} className="banner-ico" />
      <span className="banner-note">{note}</span>
      <span className="banner-actions">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={"banner-btn" + (a.variant ? ` ${a.variant}` : "")}
            onClick={a.onClick}
          >
            {a.label}
          </button>
        ))}
      </span>
    </div>
  )
}

// React.memo : évite le re-rendu de chaque message du thread à chaque frappe
// dans l'éditeur de réponse rapide (CodeRabbit #138) — combiné aux callbacks
// mémoïsés de useQuickReplyDraft.
export const MessageItem = memo(function MessageItem({
  message,
  defaultOpen = false,
  onShowOnce,
  onHideImages,
  onTrustSender,
  onUntrustSender,
  onForward,
}: {
  message: AppMessage
  defaultOpen?: boolean
  onShowOnce?: (emailId: string) => void
  onHideImages?: (emailId: string) => void
  onTrustSender?: (sender: string) => void
  onUntrustSender?: (sender: string) => void
  onForward?: (message: AppMessage) => void
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
      <div className="msg-head">
        {/* Deux vrais boutons frères : le toggle porte la sémantique disclosure
            (aria-expanded), le ↪ vit hors du toggle (anti-pattern ARIA du
            contrôle imbriqué levé, suivi #138). */}
        <button
          type="button"
          className="msg-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
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
        </button>
        {open && onForward && (
          <button
            type="button"
            className="icon-btn sm"
            aria-label={t("mail.compose.forwardMessage", { sender: leadName })}
            title={t("mail.compose.forwardMessage", { sender: leadName })}
            onClick={() => onForward(message)}
          >
            <Icon name="forward" size={16} />
          </button>
        )}
      </div>

      {open && (
        <div className="msg-body">
          {remote && decision === "blocked" && (
            <ImageBanner
              tone="shielded"
              icon="shield-check"
              note={t("mail.reader.imagesBlocked")}
              actions={[
                // Deux styles distincts : l'engagement durable en tonal (accent doux),
                // l'action ponctuelle « Afficher les images » en primaire pleine, au bord droit.
                ...(senderEmail
                  ? [
                      {
                        label: t("mail.reader.trustSender", {
                          sender: senderEmail,
                        }),
                        onClick: () => onTrustSender?.(senderEmail),
                        variant: "tonal" as const,
                      },
                    ]
                  : []),
                {
                  label: t("mail.reader.showImages"),
                  onClick: () => onShowOnce?.(message.id),
                  variant: "primary" as const,
                },
              ]}
            />
          )}
          {remote && decision === "message-allowed" && (
            <ImageBanner
              tone="exposed"
              icon="image"
              note={t("mail.reader.imagesShown")}
              actions={[
                {
                  // Clé dédiée (≠ blockSender) : cette action ne retire QUE le keyword
                  // par-message, pas la confiance expéditeur (CodeRabbit #128).
                  label: t("mail.reader.blockImages"),
                  onClick: () => onHideImages?.(message.id),
                },
              ]}
            />
          )}
          {remote && decision === "sender-allowed" && senderEmail && (
            <ImageBanner
              tone="exposed"
              icon="image"
              note={t("mail.reader.imagesFromSenderShown", {
                sender: senderEmail,
              })}
              actions={[
                {
                  label: t("mail.reader.blockSender"),
                  onClick: () => onUntrustSender?.(senderEmail),
                },
              ]}
            />
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
})
