import { createServerFn } from '@tanstack/react-start'

export const THEME_COOKIE = 'stalmail_theme'
export type Theme = 'light' | 'dark'
export const DEFAULT_THEME: Theme = 'light'

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark'
}

/**
 * Pure parser — extracts the theme from a Cookie header string.
 * Falls back to DEFAULT_THEME if absent or unrecognised.
 * Tested directly; the server-fn handler reads the cookie via getCookie() instead.
 */
export function parseThemeCookie(cookieHeader?: string): Theme {
  if (!cookieHeader) return DEFAULT_THEME
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === THEME_COOKIE) {
      const v = decodeURIComponent(rest.join('='))
      return isTheme(v) ? v : DEFAULT_THEME
    }
  }
  return DEFAULT_THEME
}

/**
 * Server fn — reads the theme cookie SSR-side. `@tanstack/react-start/server` is a
 * server-only entry, so it is imported lazily INSIDE the handler: a top-level import
 * would pull a server-only module into the client graph (the loader that calls this is
 * isomorphic) and trip TanStack Start's import-protection plugin at build time.
 */
export const getServerTheme = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ theme: Theme }> => {
    const { getCookie } = await import('@tanstack/react-start/server')
    const raw = getCookie(THEME_COOKIE)
    return { theme: isTheme(raw) ? raw : DEFAULT_THEME }
  },
)
