import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, StepHeader, StepNav } from '../ui/primitives'
import { IconInfo } from '../ui/icons'
import type { WizardData } from '../wizard-context'

type EditTarget = 'domain' | 'dns' | 'account'

interface Props {
  data: WizardData
  onSubmit: () => Promise<void>
  onBack: () => void
  goTo: (screen: EditTarget) => void
}

export function RecapStep({ data, onSubmit, onBack, goTo }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const isManual = data.provider === 'Manual'
  const rows: ReadonlyArray<{
    label: string
    value: string
    mono?: boolean
    to: EditTarget
  }> = [
    {
      label: t('wizard.recap.hostname'),
      value: data.serverHostname ?? '',
      mono: true,
      to: 'domain',
    },
    {
      label: t('wizard.recap.domain'),
      value: data.defaultDomain ?? '',
      mono: true,
      to: 'domain',
    },
    {
      label: t('wizard.recap.dns'),
      value: isManual
        ? t('wizard.recap.dnsManual')
        : t('wizard.recap.dnsAuto', { provider: data.provider }),
      to: 'dns',
    },
    {
      label: t('wizard.recap.account'),
      value: `${data.name ?? ''}@${data.defaultDomain ?? ''}`,
      mono: true,
      to: 'account',
    },
  ]

  return (
    <div className="step-body">
      <StepHeader
        title={t('wizard.recap.title')}
        sub={t('wizard.recap.subtitle')}
      />

      <div className="recap">
        {rows.map((r, i) => (
          <div key={i} className="recap-row">
            <span className="recap-label">{r.label}</span>
            <span className={`recap-value${r.mono ? ' mono' : ''}`}>
              {r.value}
            </span>
            <button
              type="button"
              className="recap-edit"
              onClick={() => goTo(r.to)}
            >
              {t('wizard.recap.edit')}
            </button>
          </div>
        ))}
      </div>

      <p className="help" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconInfo size={14} />
        {t('wizard.recap.note')}
      </p>

      {error ? (
        <Alert
          variant="destructive"
          title={t('wizard.error.title')}
          action={
            <Button variant="outline" size="sm" onClick={() => void submit()}>
              {t('wizard.error.retry')}
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      <StepNav
        onBack={onBack}
        onNext={() => void submit()}
        backLabel={t('wizard.common.back')}
        nextLabel={t('wizard.recap.submit')}
        busy={busy}
      />
    </div>
  )
}
