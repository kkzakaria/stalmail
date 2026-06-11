import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loginFn } from '@/server/auth-actions'
import { redirectIfAuthenticated } from '@/lib/auth-guard'
import { getServerTheme } from '@/server/setup-theme'
import type { Theme } from '@/server/setup-theme'
import {
  Alert,
  BrandMark,
  Brand,
  Button,
  Field,
  PasswordInput,
  Spinner,
  StepHeader,
  TextInput,
} from '@/components/setup/ui/primitives'
import { LangSelect } from '@/components/setup/ui/LangSelect'
import { ThemeToggle } from '@/components/setup/ui/ThemeToggle'
import { IconLock } from '@/components/setup/ui/icons'
import '@/components/setup/wizard.css'

export const Route = createFileRoute('/login')({
  beforeLoad: () => redirectIfAuthenticated(),
  loader: async () => {
    const { theme } = await getServerTheme()
    return { theme }
  },
  component: LoginPage,
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function LoginPage() {
  const { t } = useTranslation()
  const router = useRouter()
  // useLoaderData is not available in test environments where the route is mocked
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loaderData = typeof (Route as any).useLoaderData === 'function'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (Route as any).useLoaderData() as { theme: Theme }
    : undefined
  const initialTheme: Theme = loaderData?.theme ?? 'light'

  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const emailOk = EMAIL_RE.test(email)
  const passOk = password.length > 0

  const emailError = touched && !emailOk ? t('login.invalidEmail') : undefined
  const passError = touched && !passOk ? t('login.requiredPassword') : undefined

  async function submit() {
    setTouched(true)
    if (!emailOk || !passOk) return
    if (busy) return
    setServerError(null)
    setBusy(true)
    try {
      const res = await loginFn({ data: { email, password } })
      if (res.status === 'ok') {
        setSuccess(true)
        setTimeout(() => {
          void router.navigate({ to: '/mail/$folder', params: { folder: 'inbox' } })
        }, 600)
        return
      }
      setServerError(
        res.status === 'mfa'
          ? t('login.mfa')
          : res.status === 'rateLimited'
            ? t('login.rateLimited')
            : res.status === 'invalid'
              ? t('login.invalid')
              : t('login.error'),
      )
    } catch {
      setServerError(t('login.error'))
    } finally {
      setBusy(false)
    }
  }

  const submitLabel = success
    ? t('login.success')
    : busy
      ? t('login.signingIn')
      : t('login.submit')

  return (
    <div className="stalmail-wizard login-shell" data-theme={theme}>
      <div className="login-topbar">
        <Brand size={24} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LangSelect />
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
      </div>
      <main className="login-main">
        <div className="login-card">
          <div className="login-head">
            <BrandMark size={40} />
            <StepHeader title={t('login.title')} sub={t('login.subtitle')} />
          </div>

          {serverError && (
            <Alert variant="destructive" title={t('login.errorTitle')}>
              {serverError}
            </Alert>
          )}

          <Field
            label={t('login.email')}
            htmlFor="login-email"
            error={emailError}
          >
            <TextInput
              id="login-email"
              type="email"
              value={email}
              onChange={(v) => setEmail(v.trim())}
              placeholder={t('login.emailPlaceholder')}
              autoFocus
              invalid={touched && !emailOk}
              onEnter={submit}
            />
          </Field>

          <Field
            label={t('login.password')}
            htmlFor="login-password"
            error={passError}
          >
            <PasswordInput
              id="login-password"
              value={password}
              onChange={setPassword}
              invalid={touched && !passOk}
              showLabel={t('wizard.account.show')}
              hideLabel={t('wizard.account.hide')}
              onEnter={submit}
            />
          </Field>

          <Button
            variant="primary"
            size="lg"
            type="button"
            disabled={busy || success}
            onClick={submit}
            style={{ width: '100%' }}
          >
            {busy ? <Spinner size={14} /> : <IconLock size={15} />}
            {submitLabel}
          </Button>
        </div>
      </main>
    </div>
  )
}
