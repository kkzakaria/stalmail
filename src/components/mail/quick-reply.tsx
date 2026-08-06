import { useEffect, useState } from "react"
import type { FocusEvent } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { leavesZone } from "./recipients-zone"
import { RteEditor } from "./rte-editor"
import type { ComposerDraft } from "./use-composer"
import { useGestureSafeCollapse } from "./use-gesture-safe-collapse"

export interface QuickReplyProps {
  draft: ComposerDraft | null
  // Incrémenté à chaque OUVERTURE de brouillon (openReply/openForward), pas
  // sur un patch — sert à réinitialiser les bascules Cc/Cci ci-dessous
  // quand une nouvelle cible remplace l'ancienne sans fermeture (#142).
  draftKey: number
  sending: boolean
  onOpenReply: (mode: "reply" | "replyAll") => void
  onPatch: (patch: Partial<ComposerDraft>) => void
  onClose: () => void
  // Retourne true si l'envoi a réussi → la réponse rapide se réinitialise.
  onSend: (draft: ComposerDraft) => boolean | void | Promise<boolean | void>
}

// Présentationnel : l'état du brouillon vit dans useQuickReplyDraft (Reader).
// Le transfert n'a plus de bouton ici — il est par-message (MessageItem, #79).
export function QuickReply({
  draft,
  draftKey,
  sending,
  onOpenReply,
  onPatch,
  onClose,
  onSend,
}: QuickReplyProps) {
  const { t } = useTranslation()
  const [showFormat, setShowFormat] = useState(false)
  // Bascules INDÉPENDANTES Cc/Cci (pattern du grand Composer), forward uniquement.
  // Réinitialisées à chaque OUVERTURE (draftKey), pas à chaque patch : un
  // changement de cible sans fermeture (transférer A puis B) doit aussi
  // refermer les rangées (revue PR #142) — un simple `[!draft]` les ratait.
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  useEffect(() => {
    setShowCc(false)
    setShowBcc(false)
  }, [draftKey])
  const collapseAfterGesture = useGestureSafeCollapse()

  if (!draft) {
    return (
      <div className="reply-bar">
        <button
          type="button"
          className="reply-bar-main"
          aria-label={t("mail.compose.reply")}
          title={t("mail.compose.reply")}
          onClick={() => onOpenReply("reply")}
        >
          <Icon name="reply" size={16} /> {t("mail.compose.reply")}
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.replyAll")}
          title={t("mail.compose.replyAll")}
          onClick={() => onOpenReply("replyAll")}
        >
          <Icon name="replyAll" size={17} />
        </button>
      </div>
    )
  }

  const modeIcon =
    draft.mode === "forward"
      ? "forward"
      : draft.mode === "replyAll"
        ? "replyAll"
        : "reply"
  const modeLabel =
    draft.mode === "forward"
      ? t("mail.compose.forward")
      : draft.mode === "replyAll"
        ? t("mail.compose.replyAll")
        : t("mail.compose.reply")

  // Repli au niveau de la ZONE : une rangée vide ne se referme qu'en SORTANT
  // de la zone destinataires. Circuler entre champs et bascules ne referme
  // rien, et toute rangée vide oubliée en chemin est rattrapée à la sortie
  // (design 2026-08-06, décisions 2 à 4).
  const collapseEmptyRows = (e: FocusEvent<HTMLDivElement>) => {
    // currentTarget est lu ICI, pas dans un callback différé : React le remet
    // à null dès que le handler a rendu la main (fait établi n°4).
    if (!leavesZone(e.currentTarget, e.relatedTarget)) return
    collapseAfterGesture(() => {
      if (draft.cc.trim() === "") setShowCc(false)
      if (draft.bcc.trim() === "") setShowBcc(false)
    })
  }

  return (
    <div className="quick-reply">
      <div className="recip-zone" onBlur={collapseEmptyRows}>
        {/* En-tête unique (maquette) : mode + label À + destinataire éditable + fermer à droite. */}
        <div className="qr-head">
          <Icon name={modeIcon} size={15} />
          <span>{modeLabel}</span>
          <label className="qr-label" htmlFor="qr-to">
            {t("mail.compose.to")}
          </label>
          <input
            id="qr-to"
            className="qr-to"
            value={draft.to}
            onChange={(e) => onPatch({ to: e.target.value })}
          />
          {/* Pas d'aria-label ici : le texte visible sert de nom accessible et
              évite un doublon avec getByLabelText (qui matche aussi aria-label). */}
          {draft.mode === "forward" && !showCc && (
            <button
              type="button"
              className="icon-btn sm"
              title={t("mail.compose.cc")}
              onClick={() => setShowCc(true)}
            >
              {t("mail.compose.cc")}
            </button>
          )}
          {draft.mode === "forward" && !showBcc && (
            <button
              type="button"
              className="icon-btn sm"
              title={t("mail.compose.bcc")}
              onClick={() => setShowBcc(true)}
            >
              {t("mail.compose.bcc")}
            </button>
          )}
          <button
            type="button"
            className="icon-btn sm"
            aria-label={t("mail.compose.close")}
            title={t("mail.compose.close")}
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        {draft.mode === "forward" && showCc && (
          <div className="qr-field">
            <label htmlFor="qr-cc">{t("mail.compose.cc")}</label>
            <input
              id="qr-cc"
              // Focus à l'ouverture : la rangée est utilisable sans second clic,
              // et le focus clavier ne retombe plus sur <body>. Inconditionnel
              // ici — dans la réponse rapide les rangées démarrent fermées, donc
              // tout montage est une ouverture par bascule.
              autoFocus
              value={draft.cc}
              onChange={(e) => onPatch({ cc: e.target.value })}
            />
          </div>
        )}
        {draft.mode === "forward" && showBcc && (
          <div className="qr-field">
            <label htmlFor="qr-bcc">{t("mail.compose.bcc")}</label>
            <input
              id="qr-bcc"
              autoFocus
              value={draft.bcc}
              onChange={(e) => onPatch({ bcc: e.target.value })}
            />
          </div>
        )}
      </div>
      {/* Puces des pièces jointes reprises (transfert) — retirables une à une. */}
      {draft.attachments.length > 0 && (
        <div className="attach-row">
          {draft.attachments.map((a) => (
            <div key={a.blobId} className="attach">
              <div className="fi">
                {(a.type.split("/")[1] ?? t("mail.reader.file")).slice(0, 4)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="fn">{a.name}</div>
                <div className="fs">
                  {Math.ceil(a.size / 1024)} {t("mail.reader.sizeKB")}
                </div>
              </div>
              <button
                type="button"
                className="attach-x"
                aria-label={t("mail.compose.removeAttachment", {
                  name: a.name,
                })}
                title={t("mail.compose.removeAttachment", { name: a.name })}
                onClick={() =>
                  onPatch({
                    attachments: draft.attachments.filter(
                      (x) => x.blobId !== a.blobId
                    ),
                  })
                }
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <RteEditor
        value={draft.html}
        onChange={(html) => onPatch({ html })}
        ariaLabel={t("mail.compose.body")}
        showToolbar={showFormat}
      />
      <div className="composer-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={sending}
          aria-label={t("mail.compose.send")}
          onClick={async () => {
            // Réinitialise la réponse rapide sur succès (sinon elle reste ouverte
            // avec le contenu envoyé). onSend renvoie true quand l'envoi a abouti.
            const ok = await onSend(draft)
            if (ok) onClose()
          }}
        >
          <Icon name="send" size={16} /> {t("mail.compose.send")}
        </button>
        <button
          type="button"
          className={showFormat ? "icon-btn on" : "icon-btn"}
          aria-label={t("mail.compose.formatting")}
          title={t("mail.compose.formatting")}
          aria-pressed={showFormat}
          onClick={() => setShowFormat((v) => !v)}
        >
          <span className="aa-glyph">Aa</span>
        </button>
      </div>
    </div>
  )
}
