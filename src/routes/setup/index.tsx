import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { getStep, submitBootstrapFn } from '@/server/setup-actions'
import { SetupWizard } from '@/components/setup/SetupWizard'

export const Route = createFileRoute('/setup/')({
  loader: async () => await getStep(),
  component: SetupPage,
  errorComponent: SetupError,
})

function SetupPage() {
  const { step } = Route.useLoaderData()
  return (
    <main className="flex min-h-svh flex-col bg-muted/30 px-4">
      <SetupWizard
        initialStep={step}
        submitBootstrap={(data) => submitBootstrapFn({ data }).then(() => undefined)}
        pollStep={() => getStep()}
      />
    </main>
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
