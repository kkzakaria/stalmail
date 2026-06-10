// Stalmail wizard — step 6: admin account creation (monitoring phase).
// Ports the design prototype StepAccount
// (docs/design/wizard-handoff/project/wizard/steps-monitor.jsx), replacing the
// timer simulation with the real createAccount server-function call.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CreateAccountResult } from '@/server/setup-actions'
import { scorePassword } from '../password-strength'
import { Alert, Field, PasswordInput, Spinner, StepHeader, StepNav } from '../ui/primitives'
import { StrengthMeter } from '../ui/StrengthMeter'
import { IconCheck } from '../ui/icons'

type Phase = 'creating' | 'weak' | 'retrying' | 'done' | 'error'

interface Props {
  name: string
  password: string
  domain: string
  createAccount: (input: { name: string; password: string }) => Promise<CreateAccountResult>
  onPasswordChange: (pw: string) => void
  onNext: () => void
}

export function AccountStep({
  name,
  password,
  domain,
  createAccount,
  onPasswordChange,
  onNext,
}: Props) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('creating')
  const [newPass, setNewPass] = useState('')
  const [touched, setTouched] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const ranRef = useRef(false)
  const email = `${name}@${domain}`

  // Initial create — runs once on mount and is reused by the error-retry button.
  const runCreate = () => {
    setPhase('creating')
    setErrorMsg('')
    createAccount({ name, password })
      .then((result) => {
        setPhase(result.status === 'ok' ? 'done' : 'weak')
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
  }

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    runCreate()
    // Run-once mount effect; runCreate uses stable props/setters only.
  }, [])

  const doRetry = () => {
    setTouched(true)
    if (newPass.length < 8 || newPass === password) return
    setPhase('retrying')
    setErrorMsg('')
    createAccount({ name, password: newPass })
      .then((result) => {
        if (result.status === 'ok') {
          onPasswordChange(newPass)
          setPhase('done')
        } else {
          setPhase('weak')
        }
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
  }

  return (
    <div className="step-body">
      <StepHeader title={t('wizard.account.title')} />

      {phase === 'creating' || phase === 'retrying' ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t('wizard.account.monitor.creating', { email })}
        </p>
      ) : null}

      {phase === 'weak' ? (
        <>
          <Alert variant="destructive" title={t('wizard.account.monitor.weakTitle')}>
            {t('wizard.account.monitor.weak')}
          </Alert>
          <Field
            label={t('wizard.account.monitor.newPassword')}
            htmlFor="f-newpass"
            error={
              touched && newPass.length < 8
                ? t('wizard.account.invalidPassword')
                : undefined
            }
          >
            <PasswordInput
              id="f-newpass"
              value={newPass}
              invalid={touched && newPass.length < 8}
              showLabel={t('wizard.account.show')}
              hideLabel={t('wizard.account.hide')}
              onChange={setNewPass}
              onEnter={doRetry}
            />
          </Field>
          <StrengthMeter
            password={newPass}
            label={t(`wizard.account.strength.${scorePassword(newPass)}`)}
          />
          <StepNav
            onNext={doRetry}
            nextLabel={t('wizard.account.monitor.retry')}
            backLabel={t('wizard.common.back')}
          />
        </>
      ) : null}

      {phase === 'error' ? (
        <>
          <Alert variant="destructive" title={t('wizard.error.title')}>
            {errorMsg}
          </Alert>
          <StepNav
            onNext={runCreate}
            nextLabel={t('wizard.error.retry')}
            backLabel={t('wizard.common.back')}
          />
        </>
      ) : null}

      {phase === 'done' ? (
        <>
          <p className="inline-status inline-status-ok">
            <IconCheck size={15} />
            {t('wizard.account.monitor.done', { email })}
          </p>
          <StepNav
            onNext={onNext}
            nextLabel={t('wizard.common.next')}
            backLabel={t('wizard.common.back')}
          />
        </>
      ) : null}
    </div>
  )
}
