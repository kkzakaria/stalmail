import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

export type ToastKind = "success" | "error"
type ToastItem = { id: number; message: string; kind: ToastKind }
type Notify = (message: string, kind?: ToastKind) => void

interface ToastCtxValue {
  notify: Notify
  toasts: ToastItem[]
  dismiss: (id: number) => void
}

const ToastCtx = createContext<ToastCtxValue>({
  notify: () => {},
  toasts: [],
  dismiss: () => {},
})

// API stable pour les consommateurs : ne renvoie que notify.
export function useToast(): Notify {
  return useContext(ToastCtx).notify
}

// Fournit le contexte (état + notify) ; ne rend AUCUN visuel — le rendu est délégué à
// <ToastViewport/>, qui doit vivre à l'intérieur de `.app` (cf. note sur ToastViewport).
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const notify = useCallback<Notify>(
    (message, kind = "success") => {
      const id = ++counter.current
      setToasts((prev) => [...prev, { id, message, kind }])
      const timer = setTimeout(() => dismiss(id), 3600) // même délai que la maquette (showToast)
      timers.current.set(id, timer)
    },
    [dismiss]
  )

  // Nettoyage de tous les timers au démontage (évite les fuites mémoire).
  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer))
      timers.current.clear()
    }
  }, [])

  return (
    <ToastCtx.Provider value={{ notify, toasts, dismiss }}>
      {children}
    </ToastCtx.Provider>
  )
}

// Rendu visuel des toasts. DOIT être monté À L'INTÉRIEUR de `.app` : les tokens de thème
// maquette (--ink/--bg/--accent) ET les règles responsive `@container app` y sont scopés.
// Hors de `.app`, le toast perdrait l'accent maquette (→ couleur grise non thémée) et son
// positionnement responsive. Markup fidèle maquette : .toast-wrap > .toast > .toast-msg + bouton.
export function ToastViewport() {
  const { toasts, dismiss } = useContext(ToastCtx)
  const { t } = useTranslation()
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={"toast" + (toast.kind === "error" ? " toast-error" : "")}
        >
          <span className="toast-msg">{toast.message}</span>
          <button onClick={() => dismiss(toast.id)}>
            {t("mail.reader.dismiss")}
          </button>
        </div>
      ))}
    </div>
  )
}
