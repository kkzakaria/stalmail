import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Brand } from "./ui/primitives"
import { LangSelect } from "./ui/LangSelect"
import { ThemeToggle } from "./ui/ThemeToggle"
import { StepperH } from "./ui/StepperH"
import { WelcomeStep } from "./steps/WelcomeStep"
import { DomainStep } from "./steps/DomainStep"
import { AccountStep } from "./steps/AccountStep"
import { DnsStep } from "./steps/DnsStep"
import { SslStep } from "./steps/SslStep"
import { DoneStep } from "./steps/DoneStep"
import { RestartScreen } from "./RestartScreen"
import type { DomainValues } from "./schemas"
import type { Theme } from "@/server/setup-theme"
import type { CreateAccountResult, DnsGridRecord } from "@/server/setup-actions"
import type { AcmeStatus } from "@/server/stalwart-acme"
import "./wizard.css"

// Server-derived step (from getStep). 'collect' means bootstrap is still pending.
type ServerStep = "collect" | "dns" | "ssl" | "account" | "done"
// Client sub-phase while step==='collect' (pre-bootstrap) or just after submit.
type Phase = "welcome" | "domain" | "restarting" | "server"

interface Props {
  initialStep: string
  initialDnsManual?: boolean
  initialTheme: Theme
  submitBootstrap: (input: DomainValues) => Promise<void>
  pollStep: () => Promise<{ step: string; dnsManual: boolean }>
  createAccount: (input: {
    name: string
    password: string
  }) => Promise<CreateAccountResult>
  createDnsServer: (input: {
    provider: string
    secret: string
  }) => Promise<{ dnsServerId: string }>
  setDnsManagement: (input: { dnsServerId: string }) => Promise<{ ok: true }>
  setDnsManagementManual: () => Promise<{ ok: true }>
  gridStatus: () => Promise<{ origin: string; records: DnsGridRecord[] }>
  configureAcme: (input: {
    hostname: string
    contactEmail: string
  }) => Promise<{ ok: true }>
  acmeStatus: () => Promise<{ status: AcmeStatus }>
  finishSetup: () => Promise<{ ok: true }>
}

// 1=welcome, 2=domain, then dns/ssl/account/done at 3..6.
const STEP_DOT: Record<ServerStep, number> = {
  collect: 2,
  dns: 3,
  ssl: 4,
  account: 5,
  done: 6,
}

export function SetupWizard({
  initialStep,
  initialDnsManual = false,
  initialTheme,
  submitBootstrap,
  pollStep,
  createAccount,
  createDnsServer,
  setDnsManagement,
  setDnsManagementManual,
  gridStatus,
  configureAcme,
  acmeStatus,
  finishSetup,
}: Props) {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<Theme>(initialTheme)

  const startsCollect = initialStep === "collect"
  // Server-derived step (only meaningful once phase==='server').
  const [serverStep, setServerStep] = useState<ServerStep>(
    startsCollect ? "dns" : (initialStep as ServerStep)
  )
  const [dnsManual, setDnsManual] = useState(initialDnsManual)
  const [phase, setPhase] = useState<Phase>(
    startsCollect ? "welcome" : "server"
  )

  // Session-collected values (not persisted server-side). Empty on a pure resume,
  // which matches the previous behavior — the steps still function.
  const [collected, setCollected] = useState<{
    serverHostname: string
    defaultDomain: string
    adminEmail: string
  }>({ serverHostname: "", defaultDomain: "", adminEmail: "" })
  const [sslStatus, setSslStatus] = useState<AcmeStatus>("pending")

  // Re-derive the server step after each step completes, then advance.
  const refetchStep = () => {
    void pollStep().then(({ step, dnsManual: manual }) => {
      setServerStep(step as ServerStep)
      setDnsManual(manual)
      setPhase("server")
    })
  }

  const steps = [
    { n: 1, label: t("wizard.steps.welcome") },
    { n: 2, label: t("wizard.steps.domain") },
    { n: 3, label: t("wizard.steps.dns") },
    { n: 4, label: t("wizard.steps.ssl") },
    { n: 5, label: t("wizard.steps.account") },
    { n: 6, label: t("wizard.steps.done") },
  ]

  const current =
    phase === "welcome"
      ? 1
      : phase === "domain"
        ? 2
        : phase === "restarting"
          ? 3
          : STEP_DOT[serverStep]

  let content: React.ReactNode
  if (phase === "welcome") {
    content = <WelcomeStep onNext={() => setPhase("domain")} />
  } else if (phase === "domain") {
    content = (
      <DomainStep
        defaults={collected}
        submitBootstrap={async (v) => {
          setCollected((c) => ({
            ...c,
            serverHostname: v.serverHostname,
            defaultDomain: v.defaultDomain,
          }))
          await submitBootstrap(v)
        }}
        onRestart={() => setPhase("restarting")}
      />
    )
  } else if (phase === "restarting") {
    content = <RestartScreen poll={pollStep} onReady={() => refetchStep()} />
  } else if (serverStep === "dns") {
    content = (
      <DnsStep
        hostname={collected.serverHostname}
        domain={collected.defaultDomain}
        createDnsServer={createDnsServer}
        setDnsManagement={setDnsManagement}
        setDnsManagementManual={setDnsManagementManual}
        gridStatus={gridStatus}
        onNext={(manual) => {
          setDnsManual(manual)
          refetchStep()
        }}
      />
    )
  } else if (serverStep === "ssl") {
    content = (
      <SslStep
        hostname={collected.serverHostname}
        contactEmail={
          collected.adminEmail || `admin@${collected.defaultDomain}`
        }
        dnsManual={dnsManual}
        configureAcme={configureAcme}
        acmeStatus={acmeStatus}
        onStatusChange={setSslStatus}
        onNext={refetchStep}
      />
    )
  } else if (serverStep === "account") {
    content = (
      <AccountStep
        domain={collected.defaultDomain}
        createAccount={async (input) => {
          const res = await createAccount(input)
          if (res.status === "ok") {
            setCollected((c) => ({
              ...c,
              adminEmail: `${input.name}@${c.defaultDomain}`,
            }))
          }
          return res
        }}
        onNext={refetchStep}
      />
    )
  } else {
    content = (
      <DoneStep
        domain={collected.defaultDomain}
        hostname={collected.serverHostname}
        adminEmail={collected.adminEmail || `admin@${collected.defaultDomain}`}
        sslStatus={sslStatus}
        finishSetup={finishSetup}
      />
    )
  }

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
          <StepperH steps={steps} current={current} />
          <div className="card shell-card-main">
            <div key={`${phase}-${serverStep}`} className="step-anim">
              {content}
            </div>
          </div>
          <p className="shell-caption">
            {t("wizard.common.stepOf", { n: current })}
          </p>
        </div>
      </div>
    </main>
  )
}
