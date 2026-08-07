import { useRef, useState } from "react"
import type { FocusEvent } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { leavesZone } from "./recipients-zone"
import { RteEditor } from "./rte-editor"
import type { ComposerDraft } from "./use-composer"
import { useGestureSafeCollapse } from "./use-gesture-safe-collapse"

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
  // Bascules INDÉPENDANTES pour Cc et Cci : un seul état affichait les deux champs
  // à la fois alors qu'on peut ne vouloir que l'un.
  const [showCc, setShowCc] = useState(initial.cc !== "")
  const [showBcc, setShowBcc] = useState(initial.bcc !== "")
  // Quelle rangée doit recevoir le focus à son PROCHAIN montage. L'intention est
  // consommée au montage : `autoFocus` ne sait pas distinguer une ouverture par
  // bascule d'un simple remontage (retour du mode réduit), et un drapeau
  // permanent y volerait le curseur.
  const pendingFocus = useRef<"cc" | "bcc" | null>(null)
  const [mode, setMode] = useState<Mode>("normal")
  const [showFormat, setShowFormat] = useState(false)
  const set = (patch: Partial<ComposerDraft>) =>
    setDraft((d) => ({ ...d, ...patch }))
  const collapseAfterGesture = useGestureSafeCollapse()

  // Repli au niveau de la ZONE : une rangée vide ne se referme qu'en SORTANT
  // de la zone destinataires (design 2026-08-06, décisions 2 à 4).
  const collapseEmptyRows = (e: FocusEvent<HTMLDivElement>) => {
    // currentTarget est lu ICI, pas dans un callback différé : React le remet
    // à null dès que le handler a rendu la main.
    if (!leavesZone(e.currentTarget, e.relatedTarget)) return
    collapseAfterGesture(() => {
      if (draft.cc.trim() === "") setShowCc(false)
      if (draft.bcc.trim() === "") setShowBcc(false)
    })
  }

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
          <div className="recip-zone" onBlur={collapseEmptyRows}>
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
                  aria-label={t("mail.compose.cc")}
                  title={t("mail.compose.cc")}
                  onClick={() => {
                    pendingFocus.current = "cc"
                    setShowCc(true)
                  }}
                >
                  {t("mail.compose.cc")}
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  className="icon-btn sm"
                  aria-label={t("mail.compose.bcc")}
                  title={t("mail.compose.bcc")}
                  onClick={() => {
                    pendingFocus.current = "bcc"
                    setShowBcc(true)
                  }}
                >
                  {t("mail.compose.bcc")}
                </button>
              )}
            </div>

            {showCc && (
              <div className="composer-field">
                <label htmlFor="cmp-cc">{t("mail.compose.cc")}</label>
                <input
                  id="cmp-cc"
                  aria-label={t("mail.compose.cc")}
                  ref={(el) => {
                    if (el && pendingFocus.current === "cc") {
                      pendingFocus.current = null
                      el.focus()
                    }
                  }}
                  value={draft.cc}
                  onChange={(e) => set({ cc: e.target.value })}
                />
              </div>
            )}
            {showBcc && (
              <div className="composer-field">
                <label htmlFor="cmp-bcc">{t("mail.compose.bcc")}</label>
                <input
                  id="cmp-bcc"
                  aria-label={t("mail.compose.bcc")}
                  ref={(el) => {
                    if (el && pendingFocus.current === "bcc") {
                      pendingFocus.current = null
                      el.focus()
                    }
                  }}
                  value={draft.bcc}
                  onChange={(e) => set({ bcc: e.target.value })}
                />
              </div>
            )}
          </div>

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
