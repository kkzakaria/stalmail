import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { RteEditor } from "./rte-editor"
import { buildReplyContext } from "../../server/compose-build"
import type { ComposeMode } from "../../server/compose-build"
import type { AppThreadDetail, MailAddress } from "../../server/mail-types"
import type { ComposerDraft } from "./use-composer"

export interface QuickReplyProps {
  detail: AppThreadDetail
  selfEmail: string
  sending: boolean
  // Retourne true si l'envoi a réussi → la réponse rapide se réinitialise.
  onSend: (draft: ComposerDraft) => boolean | void | Promise<boolean | void>
}

function formatAddrs(addrs: MailAddress[]): string {
  return addrs
    .map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))
    .join(", ")
}

export function QuickReply({
  detail,
  selfEmail,
  sending,
  onSend,
}: QuickReplyProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ComposerDraft | null>(null)
  const [showFormat, setShowFormat] = useState(false)

  function open(mode: ComposeMode) {
    const last = detail.messages.at(-1)
    const ctx = buildReplyContext(
      detail,
      mode,
      selfEmail,
      last?.messageId ?? undefined
    )
    setDraft({
      mode,
      to: formatAddrs(ctx.to),
      cc: formatAddrs(ctx.cc),
      bcc: "",
      subject: ctx.subject,
      html: ctx.quotedHtml,
      inReplyTo: ctx.inReplyTo,
      references: ctx.references,
    })
  }

  if (!draft) {
    return (
      <div className="reply-bar">
        <button
          type="button"
          className="reply-bar-main"
          aria-label={t("mail.compose.reply")}
          title={t("mail.compose.reply")}
          onClick={() => open("reply")}
        >
          <Icon name="reply" size={16} /> {t("mail.compose.reply")}
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.replyAll")}
          title={t("mail.compose.replyAll")}
          onClick={() => open("replyAll")}
        >
          <Icon name="replyAll" size={17} />
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.forward")}
          title={t("mail.compose.forward")}
          onClick={() => open("forward")}
        >
          <Icon name="forward" size={17} />
        </button>
      </div>
    )
  }

  const set = (patch: Partial<ComposerDraft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d))

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

  return (
    <div className="quick-reply">
      {/* En-tête unique (maquette) : mode + destinataire éditable + fermer à droite. */}
      <div className="qr-head">
        <Icon name={modeIcon} size={15} />
        <span>{modeLabel}</span>
        <input
          className="qr-to"
          aria-label={t("mail.compose.to")}
          value={draft.to}
          onChange={(e) => set({ to: e.target.value })}
        />
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.close")}
          title={t("mail.compose.close")}
          onClick={() => setDraft(null)}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <RteEditor
        value={draft.html}
        onChange={(html) => set({ html })}
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
            if (ok) setDraft(null)
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
