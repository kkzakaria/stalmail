import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { SUPPORTED_LANGS, LANG_COOKIE } from '@/i18n/i18n'

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t, i18n } = useTranslation()

  const setLang = (lng: string) => {
    void i18n.changeLanguage(lng)
    if (typeof document !== 'undefined') {
      const secure =
        typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${LANG_COOKIE}=${lng}; path=/; max-age=31536000; SameSite=Lax${secure}`
    }
  }

  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center gap-2">
        {SUPPORTED_LANGS.map((lng) => (
          <Button
            key={lng}
            variant={i18n.resolvedLanguage === lng ? 'default' : 'outline'}
            size="sm"
            onClick={() => setLang(lng)}
          >
            {lng.toUpperCase()}
          </Button>
        ))}
      </div>
      <h1 className="text-2xl font-semibold">{t('wizard.welcome.title')}</h1>
      <p className="text-muted-foreground">{t('wizard.welcome.subtitle')}</p>
      <Button onClick={onNext}>{t('wizard.welcome.start')}</Button>
    </div>
  )
}
