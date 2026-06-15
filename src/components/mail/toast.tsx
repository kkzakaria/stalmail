import { createContext, useCallback, useContext, useRef, useState } from "react"
import type { ReactNode } from "react"

export type ToastKind = "success" | "error"
type ToastItem = { id: number; message: string; kind: ToastKind }
type Notify = (message: string, kind?: ToastKind) => void

const ToastCtx = createContext<Notify>(() => {})

export function useToast(): Notify {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const notify = useCallback<Notify>(
    (message, kind = "success") => {
      const id = ++counter.current
      setToasts((t) => [...t, { id, message, kind }])
      setTimeout(() => dismiss(id), 3600) // même délai que la maquette (showToast)
    },
    [dismiss]
  )

  // Markup fidèle à la maquette : .toast-wrap > .toast > .toast-msg + bouton de fermeture.
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={"toast" + (t.kind === "error" ? " toast-error" : "")}
          >
            <span className="toast-msg">{t.message}</span>
            <button onClick={() => dismiss(t.id)}>OK</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
