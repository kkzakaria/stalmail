import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router"
import type { QueryClient } from "@tanstack/react-query"
import type { ComponentType } from "react"
import { lazy, Suspense } from "react"
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../i18n/i18n'
import { getServerLang } from '../server/setup-lang'

import appCss from "../styles.css?url"

const isDev = process.env.NODE_ENV !== "production"

// Chargement dynamique : Vite/Rollup exclut ces modules du bundle production
const DevTools: ComponentType = isDev
  ? lazy(async () => {
      const [{ TanStackDevtools }, { TanStackRouterDevtoolsPanel }] = await Promise.all([
        import("@tanstack/react-devtools"),
        import("@tanstack/react-router-devtools"),
      ])
      return {
        default: function DevToolsPanel() {
          return (
            <TanStackDevtools
              config={{ position: "bottom-right" }}
              plugins={[{ name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> }]}
            />
          )
        },
      }
    })
  : () => null

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async () => {
    const { lang } = await getServerLang()
    return { lang }
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Stalmail",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { lang } = Route.useLoaderData()
  const i18n = createI18n(lang)
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        {isDev && (
          <Suspense fallback={null}>
            <DevTools />
          </Suspense>
        )}
        <Scripts />
      </body>
    </html>
  )
}
