import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { loginFn } from '@/server/auth-actions'
import { redirectIfAuthenticated } from '@/lib/auth-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/login')({
  beforeLoad: () => redirectIfAuthenticated(),
  component: LoginPage,
})

export function LoginPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await loginFn({ data: { email, password } })
      if (res.status === 'ok') {
        await router.navigate({ to: '/mail/$folder', params: { folder: 'inbox' } })
        return
      }
      setError(
        res.status === 'mfa'
          ? t('login.mfa')
          : res.status === 'rateLimited'
            ? t('login.rateLimited')
            : res.status === 'invalid'
              ? t('login.invalid')
              : t('login.error'),
      )
    } catch {
      setError(t('login.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{t('login.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('login.subtitle')}</p>
        </div>
        {error && (
          <div role="alert" className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('login.email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            placeholder={t('login.emailPlaceholder')}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('login.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('login.signingIn') : t('login.submit')}
        </Button>
      </form>
    </div>
  )
}
