import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  getStep,
  submitBootstrapFn,
  createAdminAccountFn,
  createDnsServerFn,
  setDnsManagementFn,
  dnsGridStatusFn,
} from '@/server/setup-actions'
import { getServerTheme } from '@/server/setup-theme'
import { SetupWizard } from '@/components/setup/SetupWizard'

export const Route = createFileRoute('/setup/')({
  loader: async () => {
    const [{ step }, { theme }] = await Promise.all([getStep(), getServerTheme()])
    return { step, theme }
  },
  component: SetupPage,
  errorComponent: SetupError,
})

function SetupPage() {
  const { step, theme } = Route.useLoaderData()
  return (
    <SetupWizard
      initialStep={step}
      initialTheme={theme}
      submitBootstrap={(data) => submitBootstrapFn({ data }).then(() => undefined)}
      pollStep={() => getStep()}
      createAccount={(input) => createAdminAccountFn({ data: input })}
      createDnsServer={(input) => createDnsServerFn({ data: input })}
      setDnsManagement={(input) => setDnsManagementFn({ data: input })}
      gridStatus={() => dnsGridStatusFn()}
    />
  )
}

function SetupError() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div role="alert" className="text-center">
        <p className="text-destructive font-medium">{t('wizard.error.title')}</p>
        <button className="mt-4 underline" onClick={() => window.location.reload()}>
          {t('wizard.error.retry')}
        </button>
      </div>
    </main>
  )
}
