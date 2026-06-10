import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcmeStatus } from '@/server/stalwart-acme'
import { Alert, Badge, Spinner, StepHeader } from '../ui/primitives'
import { IconCheck, IconMail } from '../ui/icons'

interface Props {
  domain: string
  hostname: string
  adminEmail: string
  sslStatus: AcmeStatus
  finishSetup: () => Promise<{ ok: true }>
}

export function DoneStep({ domain, hostname, adminEmail, sslStatus, finishSetup }: Props) {
  const { t } = useTranslation()
  const [finishing, setFinishing] = useState(true)
  const ranRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    if (!ranRef.current) {
      ranRef.current = true
      // Finalize is idempotent; surface nothing on error and still show the recap.
      void finishSetup()
        .catch(() => undefined)
        .finally(() => {
          if (mountedRef.current) setFinishing(false)
        })
    }
    return () => {
      mountedRef.current = false
    }
  }, [finishSetup])

  if (finishing) {
    return (
      <div className="step-body">
        <p className="inline-status">
          <Spinner size={14} />
          {t('wizard.done.finishing')}
        </p>
      </div>
    )
  }

  const sslOk = sslStatus === 'valid'

  return (
    <div className="step-body step-done">
      <span className="done-mark">
        <IconCheck size={26} strokeWidth={2.5} />
      </span>
      <StepHeader title={t('wizard.done.title')} sub={t('wizard.done.subtitle')} />
      <div className="recap" style={{ width: '100%' }}>
        <div className="recap-row">
          <span className="recap-label">{t('wizard.done.domain')}</span>
          <span className="recap-value mono">{domain}</span>
        </div>
        <div className="recap-row">
          <span className="recap-label">{t('wizard.done.host')}</span>
          <span className="recap-value mono">{hostname}</span>
        </div>
        <div className="recap-row">
          <span className="recap-label">{t('wizard.done.ssl')}</span>
          <span className="recap-value">
            <Badge variant={sslOk ? 'success' : 'pending'} pulse={!sslOk}>
              {sslOk ? t('wizard.done.sslOk') : t('wizard.done.sslPending')}
            </Badge>
          </span>
        </div>
        <div className="recap-row">
          <span className="recap-label">{t('wizard.done.admin')}</span>
          <span className="recap-value mono">{adminEmail}</span>
        </div>
      </div>
      <Alert variant="info" title={t('wizard.done.backupTitle')}>
        {t('wizard.done.backup')}
      </Alert>
      <a
        className="btn btn-primary btn-lg"
        href="/login"
        style={{ alignSelf: 'center', textDecoration: 'none' }}
      >
        <IconMail size={16} />
        {t('wizard.done.open')}
      </a>
    </div>
  )
}
