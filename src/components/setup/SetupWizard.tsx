import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brand } from './ui/primitives'
import { LangSelect } from './ui/LangSelect'
import { ThemeToggle } from './ui/ThemeToggle'
import { StepperH } from './ui/StepperH'
import { WizardProvider, useWizard } from './wizard-context'
import { WelcomeStep } from './steps/WelcomeStep'
import { DomainStep } from './steps/DomainStep'
import { DnsProviderStep } from './steps/DnsProviderStep'
import { AdminAccountStep } from './steps/AdminAccountStep'
import { RecapStep } from './steps/RecapStep'
import { AccountStep } from './steps/AccountStep'
import { DnsStep } from './steps/DnsStep'
import { RestartScreen } from './RestartScreen'
import type { DomainValues, DnsProviderValues, AdminAccountValues } from './schemas'
import type { Theme } from '@/server/setup-theme'
import type { CreateAccountResult, DnsGridRecord } from '@/server/setup-actions'
import './wizard.css'

type CollectScreen = 'welcome' | 'domain' | 'dns' | 'account' | 'recap' | 'restarting'

interface Props {
  initialStep: string
  initialTheme: Theme
  submitBootstrap: (input: DomainValues) => Promise<void>
  pollStep: () => Promise<{ step: string }>
  createAccount: (input: { name: string; password: string }) => Promise<CreateAccountResult>
  createDnsServer: (input: { provider: string; secret: string }) => Promise<{ dnsServerId: string }>
  setDnsManagement: (input: { dnsServerId: string }) => Promise<{ ok: true }>
  gridStatus: () => Promise<{ origin: string; records: DnsGridRecord[] }>
}

export function SetupWizard(props: Props) {
  return (
    <WizardProvider>
      <WizardInner {...props} />
    </WizardProvider>
  )
}

function WizardInner({
  initialStep,
  initialTheme,
  submitBootstrap,
  pollStep,
  createAccount,
  createDnsServer,
  setDnsManagement,
  gridStatus,
}: Props) {
  const { t } = useTranslation()
  const { data, setData } = useWizard()
  const [theme, setTheme] = useState<Theme>(initialTheme)
  // In bootstrap mode we drive the collect phase locally; otherwise jump to monitoring.
  const [screen, setScreen] = useState<CollectScreen>(
    initialStep === 'collect' ? 'welcome' : 'restarting',
  )
  const [monitorStep, setMonitorStep] = useState<string>(
    initialStep === 'collect' ? '' : initialStep,
  )

  const steps = [
    { n: 1, label: t('wizard.steps.welcome'), group: 'config' as const },
    { n: 2, label: t('wizard.steps.domain'), group: 'config' as const },
    { n: 3, label: t('wizard.steps.dnsProvider'), group: 'config' as const },
    { n: 4, label: t('wizard.steps.admin'), group: 'config' as const },
    { n: 5, label: t('wizard.steps.recap'), group: 'config' as const },
    { n: 6, label: t('wizard.steps.account'), group: 'activation' as const },
    { n: 7, label: t('wizard.steps.dnsRecords'), group: 'activation' as const },
    { n: 8, label: t('wizard.steps.ssl'), group: 'activation' as const },
    { n: 9, label: t('wizard.steps.done'), group: 'activation' as const },
  ]

  const screenToCurrent: Record<CollectScreen, number> = {
    welcome: 1,
    domain: 2,
    dns: 3,
    account: 4,
    recap: 5,
    restarting: 6,
  }
  const monitorToCurrent: Record<string, number> = {
    account: 6,
    dns: 7,
    ssl: 8,
    done: 9,
  }
  const current = monitorStep
    ? (monitorToCurrent[monitorStep] ?? 6)
    : screenToCurrent[screen]
  const caption = monitorStep
    ? t('wizard.common.stepOf', { n: current })
    : t('wizard.common.stepOf', { n: current <= 5 ? current : 6 })

  // Monitoring phase: account + DNS are live (Plan 2b-ii Stage A); ssl/done stay placeholder.
  const content = monitorStep === 'account' ? (
    <AccountStep
      name={data.name ?? ''}
      password={data.password ?? ''}
      domain={data.defaultDomain ?? ''}
      createAccount={createAccount}
      onPasswordChange={(pw) => setData({ password: pw })}
      onNext={() => setMonitorStep('dns')}
    />
  ) : monitorStep === 'dns' ? (
    <DnsStep
      provider={data.provider ?? 'Manual'}
      secret={data.secret ?? ''}
      hostname={data.serverHostname ?? ''}
      domain={data.defaultDomain ?? ''}
      createDnsServer={createDnsServer}
      setDnsManagement={setDnsManagement}
      gridStatus={gridStatus}
      onNext={() => setMonitorStep('ssl')}
    />
  ) : monitorStep ? (
    <p data-testid="monitor-step" className="step-body" style={{ textAlign: 'center' }}>
      {monitorStep}
    </p>
  ) : screen === 'welcome' ? (
    <WelcomeStep onNext={() => setScreen('domain')} />
  ) : screen === 'domain' ? (
    <DomainStep
      defaults={data}
      onBack={() => setScreen('welcome')}
      onNext={(v: DomainValues) => {
        setData(v)
        setScreen('dns')
      }}
    />
  ) : screen === 'dns' ? (
    <DnsProviderStep
      defaults={data as Partial<DnsProviderValues> & { defaultDomain?: string }}
      onBack={() => setScreen('domain')}
      onNext={(v: DnsProviderValues) => {
        setData(v)
        setScreen('account')
      }}
    />
  ) : screen === 'account' ? (
    <AdminAccountStep
      defaults={data}
      domain={data.defaultDomain ?? ''}
      onBack={() => setScreen('dns')}
      onNext={(v: AdminAccountValues) => {
        setData(v)
        setScreen('recap')
      }}
    />
  ) : screen === 'recap' ? (
    <RecapStep
      data={data}
      goTo={(target) => setScreen(target)}
      onBack={() => setScreen('account')}
      onSubmit={async () => {
        await submitBootstrap({
          serverHostname: data.serverHostname ?? '',
          defaultDomain: data.defaultDomain ?? '',
        })
        setScreen('restarting')
      }}
    />
  ) : (
    <RestartScreen poll={pollStep} onReady={(step) => setMonitorStep(step)} />
  )

  return (
    <main className="stalmail-wizard" data-theme={theme}>
      <div className="shell shell-card">
        <div className="shell-card-col">
          <div className="shell-card-top">
            <Brand size={24} />
            <div className="shell-top-actions">
              <LangSelect />
              <ThemeToggle theme={theme} onChange={setTheme} />
            </div>
          </div>
          <StepperH
            steps={steps}
            current={current}
            groupLabels={{
              config: t('wizard.groups.config'),
              activation: t('wizard.groups.activation'),
            }}
          />
          <div className="card shell-card-main">
            <div key={screen} className="step-anim">
              {content}
            </div>
          </div>
          <p className="shell-caption">{caption}</p>
        </div>
      </div>
    </main>
  )
}
