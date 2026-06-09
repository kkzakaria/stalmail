import { createServerFn } from '@tanstack/react-start'
import { DEFAULT_LANG, isLang, LANG_COOKIE } from '@/i18n/i18n'
import type { Lang } from '@/i18n/i18n'

/**
 * Pure helper — parses the raw Cookie header string to extract the stalmail_lang cookie.
 * Falls back to DEFAULT_LANG if the value is absent or not a recognized Lang.
 * Tested directly; the server-fn handler reads the cookie via getCookie() instead.
 */
export function parseLangCookie(cookieHeader: string | undefined): Lang {
  const match = cookieHeader?.match(new RegExp(`${LANG_COOKIE}=([^;]+)`))
  const value = match?.[1]
  return isLang(value) ? value : DEFAULT_LANG
}

/**
 * Server fn — reads the lang cookie SSR-side. `@tanstack/react-start/server` is a
 * server-only entry, so it is imported lazily INSIDE the handler: a top-level import
 * would pull a server-only module into the client graph (the loader that calls this is
 * isomorphic) and trip TanStack Start's import-protection plugin at build time.
 */
export const getServerLang = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ lang: Lang }> => {
    const { getCookie } = await import('@tanstack/react-start/server')
    const cookieValue = getCookie(LANG_COOKIE)
    return { lang: isLang(cookieValue) ? cookieValue : DEFAULT_LANG }
  },
)
