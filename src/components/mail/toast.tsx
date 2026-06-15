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

const ToastCtx = createContext<Notify>(() => {})

export function useToast(): Notify {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
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

  // Markup fidèle à la maquette : .toast-wrap > .toast > .toast-msg + bouton de fermeture.
  return (
    <ToastCtx.Provider value={notify}>
      {children}
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
    </ToastCtx.Provider>
  )
}
