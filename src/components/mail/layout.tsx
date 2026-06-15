import type { ReactNode } from "react"

export function MailLayout({
  sidebar,
  list,
  reader,
}: {
  sidebar: ReactNode
  list: ReactNode
  reader?: ReactNode
}) {
  return (
    <div className="app">
      {sidebar}
      <section className="list">{list}</section>
      {reader ?? (
        <section className="reader reader-placeholder" aria-hidden="true" />
      )}
    </div>
  )
}
