import { useTranslation } from 'react-i18next'
import { BrandMark, StepHeader, Button } from '../ui/primitives'
import { IconGlobe, IconServer, IconArrowR } from '../ui/icons'

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="step-body step-welcome">
      <BrandMark size={52} />
      <StepHeader title={t('wizard.welcome.title')} sub={t('wizard.welcome.subtitle')} />
      <div className="need-box">
        <p className="need-title">{t('wizard.welcome.needTitle')}</p>
        <p className="need-item"><IconGlobe size={14} />{t('wizard.welcome.need1')}</p>
        <p className="need-item"><IconServer size={14} />{t('wizard.welcome.need2')}</p>
      </div>
      <Button variant="primary" size="lg" onClick={onNext}>
        {t('wizard.welcome.start')}<IconArrowR size={16} />
      </Button>
    </div>
  )
}
