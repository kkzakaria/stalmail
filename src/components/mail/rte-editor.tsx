import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { sanitizeComposeHtml } from "../../lib/compose-html"

export interface RteEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  ariaLabel: string
  // Barre de mise en forme affichée seulement quand true (togglée par le bouton « Aa »
  // du parent, comme la maquette). Masquée par défaut.
  showToolbar?: boolean
}

export function RteEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  showToolbar = false,
}: RteEditorProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  // Garde le track de la dernière value injectée pour éviter la boucle de rendu
  // (réinjection à chaque frappe = curseur qui saute, P1).
  const lastInjected = useRef<string | null>(null)
  // Retour visuel : état actif gras/italique sous le curseur (boutons .tb-btn.on).
  const [active, setActive] = useState({ bold: false, italic: false })

  function refreshActive() {
    try {
      setActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
      })
    } catch {
      // queryCommandState indisponible (ex. jsdom) — pas de retour visuel, sans crash.
    }
  }

  // Injecte la value externe (citation pré-remplie) — sanitisée (B1) — UNIQUEMENT quand
  // elle change réellement (P1 : pas à chaque rendu, sinon le curseur saute pendant la frappe).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const sanitized = sanitizeComposeHtml(value)
    // Le DOM reflète déjà cette value (frappe round-trippée via emit) → ne pas réinjecter
    // (sinon réécriture d'innerHTML = saut de curseur à chaque caractère).
    if (el.innerHTML === sanitized) {
      lastInjected.current = value
      return
    }
    if (value === lastInjected.current) return
    lastInjected.current = value
    el.innerHTML = sanitized
  }, [value])

  // Frappe : on émet le HTML brut (le serveur sanitise à l'envoi, barrière autoritaire B2).
  function emit() {
    const el = ref.current
    if (!el) return
    // Mémorise la value courante : quand le parent contrôlé la renvoie via `value`,
    // l'useEffect la reconnaît et NE réinjecte PAS (préserve le curseur — bug CodeRabbit #4).
    lastInjected.current = el.innerHTML
    onChange(el.innerHTML)
  }

  // Collage : sanitise le presse-papier avant insertion (défense B1 : contenu hostile collé).
  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const raw =
      e.clipboardData.getData("text/html") ||
      e.clipboardData.getData("text/plain")
    document.execCommand("insertHTML", false, sanitizeComposeHtml(raw))
    emit()
  }

  function exec(cmd: string, arg?: string) {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
    refreshActive()
  }

  function addLink() {
    const url = window.prompt(t("mail.compose.linkPrompt"), "https://")
    if (!url) return
    let parsed: URL
    try {
      parsed = new URL(url, window.location.origin)
    } catch {
      return
    }
    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:" &&
      parsed.protocol !== "mailto:"
    ) {
      return
    }
    exec("createLink", parsed.toString())
  }

  return (
    <div className="rte">
      <div
        ref={ref}
        className="rte-body"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={onPaste}
        onKeyUp={refreshActive}
        onMouseUp={refreshActive}
        onFocus={refreshActive}
      />
      {/* Barre de mise en forme sous la zone de texte (placement maquette), togglée par « Aa ». */}
      {showToolbar && (
        <div className="rte-toolbar" role="toolbar">
          <button
            type="button"
            className={active.bold ? "tb-btn on" : "tb-btn"}
            aria-label={t("mail.compose.bold")}
            title={t("mail.compose.bold")}
            aria-pressed={active.bold}
            onClick={() => exec("bold")}
          >
            <Icon name="bold" size={15} />
          </button>
          <button
            type="button"
            className={active.italic ? "tb-btn on" : "tb-btn"}
            aria-label={t("mail.compose.italic")}
            title={t("mail.compose.italic")}
            aria-pressed={active.italic}
            onClick={() => exec("italic")}
          >
            <Icon name="italic" size={15} />
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-label={t("mail.compose.link")}
            title={t("mail.compose.link")}
            onClick={addLink}
          >
            <Icon name="link" size={15} />
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-label={t("mail.compose.bulletList")}
            title={t("mail.compose.bulletList")}
            onClick={() => exec("insertUnorderedList")}
          >
            <Icon name="list" size={15} />
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-label={t("mail.compose.numberList")}
            title={t("mail.compose.numberList")}
            onClick={() => exec("insertOrderedList")}
          >
            <Icon name="listOrdered" size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
