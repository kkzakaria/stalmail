import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { WizardData } from '../wizard-context'

interface Props {
  data: WizardData
  onSubmit: () => Promise<void>
  onBack: () => void
}

export function RecapStep({ data, onSubmit, onBack }: Props) {
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

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t('wizard.recap.title')}</h2>
      <dl className="space-y-2 text-sm">
        <Row label={t('wizard.recap.hostname')} value={data.serverHostname} />
        <Row label={t('wizard.recap.domain')} value={data.defaultDomain} />
        <Row label={t('wizard.recap.dns')} value={data.provider} />
        <Row label={t('wizard.recap.account')} value={`${data.name ?? ''}@${data.defaultDomain ?? ''}`} />
      </dl>
      {error && (
        <div role="alert" className="border-destructive text-destructive rounded-md border p-3 text-sm">
          <p>
            {t('wizard.error.title')}: {error}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void submit()}>
            {t('wizard.error.retry')}
          </Button>
        </div>
      )}
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          {t('wizard.nav.back')}
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? '…' : t('wizard.recap.submit')}
        </Button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between border-b pb-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
