import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGS, LANG_COOKIE } from '@/i18n/i18n'
import { IconGlobe } from './icons'

export function LangSelect() {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage ?? SUPPORTED_LANGS[0]
  const setLang = (lng: string) => {
    void i18n.changeLanguage(lng)
    if (typeof document !== 'undefined') {
      const secure =
        typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${LANG_COOKIE}=${lng}; path=/; max-age=31536000; SameSite=Lax${secure}`
    }
  }
  return (
    <div className="lang-select">
      <IconGlobe size={13} style={{ opacity: 0.65 }} />
      <select
        className="lang-select-el"
        value={current}
        aria-label={t('wizard.welcome.language')}
        onChange={(e) => setLang(e.target.value)}
      >
        {SUPPORTED_LANGS.map((l) => (
          <option key={l} value={l}>
            {t(`wizard.langs.${l}`)}
          </option>
        ))}
      </select>
      <svg
        className="lang-select-chevron"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
}
