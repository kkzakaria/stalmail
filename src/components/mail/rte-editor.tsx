import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { sanitizeComposeHtml } from "../../lib/compose-html"

export interface RteEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  ariaLabel: string
}

export function RteEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: RteEditorProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  // Garde le track de la dernière value injectée pour éviter la boucle de rendu
  // (réinjection à chaque frappe = curseur qui saute, P1).
  const lastInjected = useRef<string | null>(null)

  // Injecte la value externe (citation pré-remplie) — sanitisée (B1) — UNIQUEMENT quand
  // elle change réellement (P1 : pas à chaque rendu, sinon le curseur saute pendant la frappe).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (value === lastInjected.current) return
    lastInjected.current = value
    el.innerHTML = sanitizeComposeHtml(value)
  }, [value])

  // Frappe : on émet le HTML brut (le serveur sanitise à l'envoi, barrière autoritaire B2).
  function emit() {
    const el = ref.current
    if (!el) return
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
      <div className="rte-toolbar" role="toolbar">
        <button
          type="button"
          aria-label={t("mail.compose.bold")}
          onClick={() => exec("bold")}
        >
          <Icon name="bold" size={15} />
        </button>
        <button
          type="button"
          aria-label={t("mail.compose.italic")}
          onClick={() => exec("italic")}
        >
          <Icon name="italic" size={15} />
        </button>
        <button
          type="button"
          aria-label={t("mail.compose.link")}
          onClick={addLink}
        >
          <Icon name="link" size={15} />
        </button>
        <button
          type="button"
          aria-label={t("mail.compose.bulletList")}
          onClick={() => exec("insertUnorderedList")}
        >
          <Icon name="list" size={15} />
        </button>
        <button
          type="button"
          aria-label={t("mail.compose.numberList")}
          onClick={() => exec("insertOrderedList")}
        >
          <Icon name="listOrdered" size={15} />
        </button>
      </div>
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
      />
    </div>
  )
}
