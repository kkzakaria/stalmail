import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Stepper } from './Stepper'
import { WizardProvider, useWizard } from './wizard-context'
import { WelcomeStep } from './steps/WelcomeStep'
import { DomainStep } from './steps/DomainStep'
import { DnsProviderStep } from './steps/DnsProviderStep'
import { AdminAccountStep } from './steps/AdminAccountStep'
import { RecapStep } from './steps/RecapStep'
import { RestartScreen } from './RestartScreen'
import type { DomainValues, DnsProviderValues, AdminAccountValues } from './schemas'

type CollectScreen = 'welcome' | 'domain' | 'dns' | 'account' | 'recap' | 'restarting'

interface Props {
  initialStep: string
  submitBootstrap: (input: DomainValues) => Promise<void>
  pollStep: () => Promise<{ step: string }>
}

export function SetupWizard(props: Props) {
  return (
    <WizardProvider>
      <WizardInner {...props} />
    </WizardProvider>
  )
}

function WizardInner({ initialStep, submitBootstrap, pollStep }: Props) {
  const { t } = useTranslation()
  const { data, setData } = useWizard()
  // In bootstrap mode we drive the collect phase locally; otherwise jump to monitoring.
  const [screen, setScreen] = useState<CollectScreen>(
    initialStep === 'collect' ? 'welcome' : 'restarting',
  )
  const [monitorStep, setMonitorStep] = useState<string>(
    initialStep === 'collect' ? '' : initialStep,
  )

  const collectLabels = [
    t('wizard.steps.welcome'),
    t('wizard.steps.domain'),
    t('wizard.steps.dns'),
    t('wizard.steps.account'),
    t('wizard.steps.recap'),
  ]
  const order: CollectScreen[] = ['welcome', 'domain', 'dns', 'account', 'recap']
  const activeIndex = Math.max(0, order.indexOf(screen))

  // Monitoring phase is implemented in Plan 2b-ii; here we render a placeholder.
  if (monitorStep) {
    return (
      <Card className="mx-auto mt-16 max-w-lg p-8">
        <p data-testid="monitor-step" className="text-muted-foreground text-center text-sm">
          {monitorStep}
        </p>
      </Card>
    )
  }

  return (
    <Card className="mx-auto mt-16 max-w-lg p-8">
      {screen !== 'restarting' && <Stepper labels={collectLabels} activeIndex={activeIndex} />}
      {screen === 'welcome' && <WelcomeStep onNext={() => setScreen('domain')} />}
      {screen === 'domain' && (
        <DomainStep
          defaults={data}
          onBack={() => setScreen('welcome')}
          onNext={(v: DomainValues) => {
            setData(v)
            setScreen('dns')
          }}
        />
      )}
      {screen === 'dns' && (
        <DnsProviderStep
          defaults={data as Partial<DnsProviderValues> & { defaultDomain?: string }}
          onBack={() => setScreen('domain')}
          onNext={(v: DnsProviderValues) => {
            setData(v)
            setScreen('account')
          }}
        />
      )}
      {screen === 'account' && (
        <AdminAccountStep
          defaults={data}
          domain={data.defaultDomain ?? ''}
          onBack={() => setScreen('dns')}
          onNext={(v: AdminAccountValues) => {
            setData(v)
            setScreen('recap')
          }}
        />
      )}
      {screen === 'recap' && (
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
      )}
      {screen === 'restarting' && (
        <RestartScreen poll={pollStep} onReady={(step) => setMonitorStep(step)} />
      )}
    </Card>
  )
}
