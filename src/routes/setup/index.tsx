import { createFileRoute, redirect } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  getStep,
  submitBootstrapFn,
  createAdminAccountFn,
  createDnsServerFn,
  setDnsManagementFn,
  setDnsManagementManualFn,
  dnsGridStatusFn,
  discoverServerIpFn,
  hostAddressStatusFn,
  configureAcmeFn,
  acmeStatusFn,
  finishSetupFn,
  setupStatusFn,
  markSslConfiguredFn,
  unlockSetupFn,
  setupAuthStatusFn,
  setupContextFn,
} from "@/server/setup-actions"
import { getServerTheme } from "@/server/setup-theme"
import { SetupWizard } from "@/components/setup/SetupWizard"

export const Route = createFileRoute("/setup/")({
  beforeLoad: async () => {
    const { configured } = await setupStatusFn()
    if (configured) throw redirect({ to: "/login" })
  },
  loader: async () => {
    const [{ step, dnsManual }, { theme }, context] = await Promise.all([
      getStep(),
      getServerTheme(),
      setupContextFn(),
    ])
    return { step, dnsManual, theme, context }
  },
  component: SetupPage,
  errorComponent: SetupError,
})

function SetupPage() {
  const { step, dnsManual, theme, context } = Route.useLoaderData()
  return (
    <SetupWizard
      initialStep={step}
      initialDnsManual={dnsManual}
      initialTheme={theme}
      initialContext={context}
      unlock={(token) => unlockSetupFn({ data: { token } })}
      authStatus={() => setupAuthStatusFn()}
      submitBootstrap={(data) =>
        submitBootstrapFn({ data }).then(() => undefined)
      }
      pollStep={() => getStep()}
      createAccount={(input) => createAdminAccountFn({ data: input })}
      createDnsServer={(input) => createDnsServerFn({ data: input })}
      setDnsManagement={(input) => setDnsManagementFn({ data: input })}
      setDnsManagementManual={() => setDnsManagementManualFn()}
      gridStatus={() => dnsGridStatusFn()}
      discoverServerIp={() => discoverServerIpFn()}
      hostAddressStatus={(ip) => hostAddressStatusFn({ data: ip })}
      configureAcme={(input) => configureAcmeFn({ data: input })}
      acmeStatus={() => acmeStatusFn()}
      acknowledgeManualSsl={() => markSslConfiguredFn()}
      finishSetup={() => finishSetupFn()}
    />
  )
}

function SetupError() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div role="alert" className="text-center">
        <p className="font-medium text-destructive">
          {t("wizard.error.title")}
        </p>
        <button
          className="mt-4 underline"
          onClick={() => window.location.reload()}
        >
          {t("wizard.error.retry")}
        </button>
      </div>
    </main>
  )
}
