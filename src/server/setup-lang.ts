import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { DEFAULT_LANG, isLang, LANG_COOKIE } from '@/i18n/i18n'
import type { Lang } from '@/i18n/i18n'

/**
 * Pure helper — parses the raw Cookie header string to extract the stalmail_lang cookie.
 * Falls back to DEFAULT_LANG if the value is absent or not a recognized Lang.
 * Tested directly; the server-fn wrapper delegates to getCookie() instead.
 */
export function parseLangCookie(cookieHeader: string | undefined): Lang {
  const match = cookieHeader?.match(new RegExp(`${LANG_COOKIE}=([^;]+)`))
  const value = match?.[1]
  return isLang(value) ? value : DEFAULT_LANG
}

/**
 * Server-fn handler — reads the lang cookie via TanStack Start's getCookie() helper
 * (exported from @tanstack/react-start/server via start-server-core/request-response).
 * getCookie() returns undefined when the cookie is absent, which parseLangCookie handles.
 */
export async function getServerLangHandler(): Promise<{ lang: Lang }> {
  const cookieValue = getCookie(LANG_COOKIE)
  return { lang: isLang(cookieValue) ? cookieValue : DEFAULT_LANG }
}

export const getServerLang = createServerFn({ method: 'GET' }).handler(getServerLangHandler)
