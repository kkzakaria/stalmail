import i18next from 'i18next'
import type { i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { fr, en } from './resources'

export const SUPPORTED_LANGS = ['fr', 'en'] as const
export type Lang = (typeof SUPPORTED_LANGS)[number]
export const DEFAULT_LANG: Lang = 'fr'
export const LANG_COOKIE = 'stalmail_lang'

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'en'
}

// Synchronous, bundled resources — no async backend, so no Suspense needed.
export function createI18n(lng: Lang = DEFAULT_LANG): I18n {
  const instance = i18next.createInstance()
  void instance.use(initReactI18next).init({
    lng,
    fallbackLng: DEFAULT_LANG,
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  return instance
}
