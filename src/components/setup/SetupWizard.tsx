import { useState, useEffect, useRef, useCallback } from "react"
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
import { SetupErrorBox } from "./ui/SetupErrorBox"
import { codeFromError, messageKeyForCode } from "./error-code"
import type { DomainValues } from "./schemas"
import type { Theme } from "@/server/setup-theme"
import type { CreateAccountResult, DnsGridRecord } from "@/server/setup-actions"
import type { AcmeStatus } from "@/server/stalwart-acme"
import "./wizard.css"

// Server-derived step (from getStep). 'collect' means bootstrap is still pending.
type ServerStep = "collect" | "dns" | "ssl" | "account" | "done"
// Client sub-phase while step==='collect' (pre-bootstrap) or just after submit.
type Phase = "welcome" | "domain" | "restarting" | "server"

// Auth gate state (client-side only, initialised on mount)
type AuthState =
  | "loading"
  | "authed"
  | "unlocking"
  | "unauthed-no-token"
  | "expired"
  | { kind: "unlock-failed"; code: string }

interface Props {
  initialStep: string
  initialDnsManual?: boolean
  initialTheme: Theme
  unlock: (token: string) => Promise<{ ok: true }>
  authStatus: () => Promise<{ authed: boolean }>
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
  acknowledgeManualSsl: () => Promise<{ ok: true }>
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
  unlock,
  authStatus,
  submitBootstrap,
  pollStep,
  createAccount,
  createDnsServer,
  setDnsManagement,
  setDnsManagementManual,
  gridStatus,
  configureAcme,
  acmeStatus,
  acknowledgeManualSsl,
  finishSetup,
}: Props) {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<Theme>(initialTheme)

  // Auth gate: starts at "loading", resolved on mount (client only).
  const [authState, setAuthState] = useState<AuthState>("loading")
  // Token kept in memory only — never stored in state to avoid leaking to the DOM.
  const tokenRef = useRef<string | null>(null)

  // Keep latest prop references stable for use inside callbacks without stale closure issues.
  const unlockRef = useRef(unlock)
  const authStatusRef = useRef(authStatus)
  unlockRef.current = unlock
  authStatusRef.current = authStatus

  // Stable re-unlock helper (used both on mount and in recovery).
  const doUnlock = useCallback((token: string) => unlockRef.current(token), [])
  const doAuthStatus = useCallback(() => authStatusRef.current(), [])

  // Mount effect: read URL fragment, attempt unlock if token present, then check auth.
  useEffect(() => {
    // Guard SSR
    if (typeof window === "undefined") return

    const hash = window.location.hash
    const match = /[#&]token=([^&]+)/.exec(hash)
    let token: string | null = null
    if (match) {
      try {
        token = decodeURIComponent(match[1])
      } catch {
        // Malformed percent-encoding — treat as no token present
        token = null
      }
    }

    if (token) {
      tokenRef.current = token
      // Scrub the fragment from the URL immediately (do not expose the token in history)
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      )
      setAuthState("unlocking")
      doUnlock(token)
        .then(() => doAuthStatus())
        .then(({ authed }) => {
          setAuthState(authed ? "authed" : "unauthed-no-token")
        })
        .catch((e: unknown) => {
          const code = codeFromError(e)
          setAuthState({ kind: "unlock-failed", code })
        })
    } else {
      // No token in URL — just check auth status (e.g. valid cookie still present)
      doAuthStatus()
        .then(({ authed }) => {
          setAuthState(authed ? "authed" : "unauthed-no-token")
        })
        .catch(() => {
          setAuthState("unauthed-no-token")
        })
    }
  }, [doUnlock, doAuthStatus])

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
  // Set when a re-derivation (pollStep) fails so the wizard surfaces a retryable
  // error instead of silently going stale / emitting an unhandled rejection.
  const [pollError, setPollError] = useState<string | null>(null)

  // Keep latest prop references for stable callbacks.
  const pollStepRef = useRef(pollStep)
  const submitBootstrapRef = useRef(submitBootstrap)
  const createAccountRef = useRef(createAccount)
  const createDnsServerRef = useRef(createDnsServer)
  const setDnsManagementRef = useRef(setDnsManagement)
  const setDnsManagementManualRef = useRef(setDnsManagementManual)
  const configureAcmeRef = useRef(configureAcme)
  const acknowledgeManualSslRef = useRef(acknowledgeManualSsl)
  const finishSetupRef = useRef(finishSetup)
  pollStepRef.current = pollStep
  submitBootstrapRef.current = submitBootstrap
  createAccountRef.current = createAccount
  createDnsServerRef.current = createDnsServer
  setDnsManagementRef.current = setDnsManagement
  setDnsManagementManualRef.current = setDnsManagementManual
  configureAcmeRef.current = configureAcme
  acknowledgeManualSslRef.current = acknowledgeManualSsl
  finishSetupRef.current = finishSetup

  // Stable re-auth recovery helper.
  // Wraps any async call: on SETUP-UNAUTHENTICATED, re-unlocks if token available, then retries.
  const withReauth = useCallback(
    <TArgs extends any[], TResult>(
      cb: (...args: TArgs) => Promise<TResult>
    ): ((...args: TArgs) => Promise<TResult>) =>
      async (...args: TArgs) => {
        try {
          return await cb(...args)
        } catch (e: unknown) {
          if (codeFromError(e) === "SETUP-UNAUTHENTICATED") {
            const token = tokenRef.current
            if (token) {
              try {
                await doUnlock(token)
              } catch {
                setAuthState("expired")
                throw e
              }
              return await cb(...args)
            } else {
              setAuthState("expired")
            }
          }
          throw e
        }
      },
    [doUnlock]
  )

  // Re-derive the server step after each step completes, then advance.
  const refetchStep = useCallback(() => {
    setPollError(null)
    pollStepRef
      .current()
      .then(({ step, dnsManual: manual }) => {
        setServerStep(step as ServerStep)
        setDnsManual(manual)
        setPhase("server")
      })
      .catch((e: unknown) => {
        setPollError(codeFromError(e))
      })
  }, [])

  // Stable wrapped callbacks passed to steps — created once, not on every render.
  const stableSubmitBootstrap = useCallback(
    (v: DomainValues) =>
      withReauth(async (values: DomainValues) => {
        setCollected((c) => ({
          ...c,
          serverHostname: values.serverHostname,
          defaultDomain: values.defaultDomain,
        }))
        await submitBootstrapRef.current(values)
      })(v),
    [withReauth]
  )

  const stableCreateAccount = useCallback(
    (input: { name: string; password: string }) =>
      withReauth(async (i: { name: string; password: string }) => {
        const res = await createAccountRef.current(i)
        if (res.status === "ok") {
          setCollected((c) => ({
            ...c,
            adminEmail: `${i.name}@${c.defaultDomain}`,
          }))
        }
        return res
      })(input),
    [withReauth]
  )

  const stableRefetchStep = useCallback(
    () => withReauth(async () => refetchStep())(),
    [withReauth, refetchStep]
  )

  const stableCreateDnsServer = useCallback(
    (input: { provider: string; secret: string }) =>
      withReauth((i: { provider: string; secret: string }) =>
        createDnsServerRef.current(i)
      )(input),
    [withReauth]
  )

  const stableSetDnsManagement = useCallback(
    (input: { dnsServerId: string }) =>
      withReauth((i: { dnsServerId: string }) =>
        setDnsManagementRef.current(i)
      )(input),
    [withReauth]
  )

  const stableSetDnsManagementManual = useCallback(
    () => withReauth(() => setDnsManagementManualRef.current())(),
    [withReauth]
  )

  const stableConfigureAcme = useCallback(
    (input: { hostname: string; contactEmail: string }) =>
      withReauth((i: { hostname: string; contactEmail: string }) =>
        configureAcmeRef.current(i)
      )(input),
    [withReauth]
  )

  const stableAcknowledgeManualSsl = useCallback(
    () => withReauth(() => acknowledgeManualSslRef.current())(),
    [withReauth]
  )

  const stableFinishSetup = useCallback(
    () => withReauth(() => finishSetupRef.current())(),
    [withReauth]
  )

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

  // --- Auth gate rendering ---
  if (authState === "loading") {
    return (
      <main className="stalmail-wizard" data-theme={theme}>
        <div className="shell shell-card">
          <div className="shell-card-col">
            <div className="shell-card-top">
              <Brand size={24} />
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (authState === "unlocking") {
    return (
      <main className="stalmail-wizard" data-theme={theme}>
        <div className="shell shell-card">
          <div className="shell-card-col">
            <div className="shell-card-top">
              <Brand size={24} />
            </div>
            <div className="card shell-card-main">
              <div className="step-anim">
                <p role="status" className="text-center text-muted-foreground">
                  {t("wizard.unlock.unlocking")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (authState === "unauthed-no-token" || authState === "expired") {
    const isExpired = authState === "expired"
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
            <div className="card shell-card-main">
              <div className="step-anim">
                <h1 className="text-lg font-semibold">
                  {isExpired
                    ? t("wizard.unlock.expiredTitle")
                    : t("wizard.unlock.requiredTitle")}
                </h1>
                <p className="mt-2 text-muted-foreground">
                  {isExpired
                    ? t("wizard.unlock.expiredDesc")
                    : t("wizard.unlock.requiredDesc")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof authState === "object" && authState.kind === "unlock-failed") {
    const code = authState.code
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
            <div className="card shell-card-main">
              <div className="step-anim">
                <SetupErrorBox
                  code={code}
                  messageKey={messageKeyForCode(code)}
                  onRetry={() => {
                    const token = tokenRef.current
                    if (token) {
                      setAuthState("unlocking")
                      doUnlock(token)
                        .then(() => doAuthStatus())
                        .then(({ authed }) => {
                          setAuthState(authed ? "authed" : "unauthed-no-token")
                        })
                        .catch((e: unknown) => {
                          const newCode = codeFromError(e)
                          setAuthState({ kind: "unlock-failed", code: newCode })
                        })
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  // authState === "authed" → render the full wizard
  let content: React.ReactNode
  if (pollError) {
    content = (
      <SetupErrorBox
        code={pollError}
        messageKey={messageKeyForCode(pollError)}
        onRetry={refetchStep}
      />
    )
  } else if (phase === "welcome") {
    content = <WelcomeStep onNext={() => setPhase("domain")} />
  } else if (phase === "domain") {
    content = (
      <DomainStep
        defaults={collected}
        submitBootstrap={stableSubmitBootstrap}
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
        createDnsServer={stableCreateDnsServer}
        setDnsManagement={stableSetDnsManagement}
        setDnsManagementManual={stableSetDnsManagementManual}
        gridStatus={gridStatus}
        onNext={(manual) => {
          setDnsManual(manual)
          stableRefetchStep()
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
        configureAcme={stableConfigureAcme}
        acmeStatus={acmeStatus}
        onStatusChange={setSslStatus}
        acknowledgeManualSsl={stableAcknowledgeManualSsl}
        onNext={stableRefetchStep}
      />
    )
  } else if (serverStep === "account") {
    content = (
      <AccountStep
        domain={collected.defaultDomain}
        createAccount={stableCreateAccount}
        onNext={stableRefetchStep}
      />
    )
  } else {
    content = (
      <DoneStep
        domain={collected.defaultDomain}
        hostname={collected.serverHostname}
        adminEmail={collected.adminEmail || `admin@${collected.defaultDomain}`}
        sslStatus={sslStatus}
        finishSetup={stableFinishSetup}
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
