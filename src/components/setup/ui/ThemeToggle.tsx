import { useTranslation } from 'react-i18next'
import type { Theme } from '@/server/setup-theme'
import { THEME_COOKIE } from '@/server/setup-theme'
import { IconSun, IconMoon } from './icons'

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const { t } = useTranslation()
  const dark = theme === 'dark'
  const title = dark ? t('wizard.theme.toLight') : t('wizard.theme.toDark')
  const toggle = () => {
    const next: Theme = dark ? 'light' : 'dark'
    onChange(next)
    if (typeof document !== 'undefined') {
      const secure =
        typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax${secure}`
    }
  }
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={title}
      aria-label={title}
      aria-pressed={dark}
    >
      {dark ? <IconMoon size={15} /> : <IconSun size={15} />}
    </button>
  )
}
