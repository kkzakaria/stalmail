import type { ReactNode } from 'react'

export function MailLayout({ sidebar, list }: { sidebar: ReactNode; list: ReactNode }) {
  return (
    <div className="app">
      {sidebar}
      <section className="list">{list}</section>
      <section className="reader reader-placeholder" aria-hidden="true" />
    </div>
  )
}
