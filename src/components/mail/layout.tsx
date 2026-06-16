import type { ReactNode } from "react"

export function MailLayout({
  sidebar,
  list,
  reader,
  overlay,
}: {
  sidebar: ReactNode
  list: ReactNode
  reader?: ReactNode
  // Rendu à l'intérieur de `.app` (overlays scopés aux tokens/thème maquette : ex. ToastViewport).
  overlay?: ReactNode
}) {
  return (
    <div className="app">
      {sidebar}
      <section className="list">{list}</section>
      {reader ?? (
        <section className="reader reader-placeholder" aria-hidden="true" />
      )}
      {overlay}
    </div>
  )
}
