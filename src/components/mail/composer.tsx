import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { RteEditor } from "./rte-editor"
import type { ComposerDraft } from "./use-composer"

type Mode = "min" | "normal" | "max"

export interface ComposerProps {
  initial: ComposerDraft
  sending: boolean
  onSend: (draft: ComposerDraft) => void
  onClose: () => void
}

export function Composer({ initial, sending, onSend, onClose }: ComposerProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ComposerDraft>(initial)
  const [showCc, setShowCc] = useState(initial.cc !== "" || initial.bcc !== "")
  const [mode, setMode] = useState<Mode>("normal")
  const [showFormat, setShowFormat] = useState(false)
  const set = (patch: Partial<ComposerDraft>) =>
    setDraft((d) => ({ ...d, ...patch }))

  // Libellés des bascules de fenêtre (aria-label + title/tooltip, comme la maquette).
  const minimizeLabel =
    mode === "min" ? t("mail.compose.expand") : t("mail.compose.minimize")
  const maximizeLabel =
    mode === "max" ? t("mail.compose.restoreSize") : t("mail.compose.maximize")

  return (
    <div className={`composer composer--${mode}`}>
      <div className="composer-head">
        <b>{draft.subject.trim() || t("mail.compose.newMessage")}</b>
        <button
          type="button"
          className="icon-btn sm composer-mode-btn"
          style={{ marginLeft: "auto" }}
          aria-label={minimizeLabel}
          title={minimizeLabel}
          onClick={() => setMode(mode === "min" ? "normal" : "min")}
        >
          <Icon name="minimize" size={16} />
        </button>
        <button
          type="button"
          className="icon-btn sm composer-mode-btn"
          aria-label={maximizeLabel}
          title={maximizeLabel}
          onClick={() => setMode(mode === "max" ? "normal" : "max")}
        >
          <Icon name={mode === "max" ? "shrink" : "expand"} size={15} />
        </button>
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

      {mode !== "min" && (
        <div className="composer-body-wrap">
          <div className="composer-field">
            <label htmlFor="cmp-to">{t("mail.compose.to")}</label>
            <input
              id="cmp-to"
              aria-label={t("mail.compose.to")}
              value={draft.to}
              onChange={(e) => set({ to: e.target.value })}
            />
            {!showCc && (
              <button
                type="button"
                className="icon-btn sm"
                aria-label={t("mail.compose.ccToggle")}
                title={t("mail.compose.ccToggle")}
                onClick={() => setShowCc(true)}
              >
                {t("mail.compose.ccToggle")}
              </button>
            )}
          </div>

          {showCc && (
            <>
              <div className="composer-field">
                <label htmlFor="cmp-cc">{t("mail.compose.cc")}</label>
                <input
                  id="cmp-cc"
                  aria-label={t("mail.compose.cc")}
                  value={draft.cc}
                  onChange={(e) => set({ cc: e.target.value })}
                />
              </div>
              <div className="composer-field">
                <label htmlFor="cmp-bcc">{t("mail.compose.bcc")}</label>
                <input
                  id="cmp-bcc"
                  aria-label={t("mail.compose.bcc")}
                  value={draft.bcc}
                  onChange={(e) => set({ bcc: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="composer-field">
            <label htmlFor="cmp-subject">{t("mail.compose.subject")}</label>
            <input
              id="cmp-subject"
              aria-label={t("mail.compose.subject")}
              value={draft.subject}
              onChange={(e) => set({ subject: e.target.value })}
            />
          </div>

          <RteEditor
            value={draft.html}
            onChange={(html) => set({ html })}
            placeholder={t("mail.compose.bodyPlaceholder")}
            ariaLabel={t("mail.compose.body")}
            showToolbar={showFormat}
          />

          <div className="composer-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={sending}
              aria-label={t("mail.compose.send")}
              onClick={() => onSend(draft)}
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
      )}
    </div>
  )
}
