// Stalmail wizard — step 8: SSL certificate via ACME (monitoring phase).
// Ports the design prototype StepSsl
// (docs/design/wizard-handoff/project/wizard/steps-monitor.jsx), replacing the
// timer simulation with the real configureAcme mutation and a live acmeStatus()
// poll. NON-BLOCKING: Continue is always enabled (Stalwart keeps retrying).
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { AcmeStatus } from "@/server/stalwart-acme"
import { Alert, Badge, Spinner, StepHeader, StepNav } from "../ui/primitives"
import { IconInfo } from "../ui/icons"
import { SetupErrorBox } from "../ui/SetupErrorBox"
import { codeFromError, messageKeyForCode } from "../error-code"

type Phase = "configuring" | "monitor" | "manual" | "error"

interface Props {
  hostname: string
  contactEmail: string
  dnsManual: boolean
  configureAcme: (i: {
    hostname: string
    contactEmail: string
  }) => Promise<{ ok: true }>
  acmeStatus: () => Promise<{ status: AcmeStatus }>
  onStatusChange: (s: AcmeStatus) => void
  /** Called before onNext in manual DNS mode to write the SSL acknowledgment marker. */
  acknowledgeManualSsl: () => Promise<{ ok: true }>
  onNext: () => void
}

export function SslStep({
  hostname,
  contactEmail,
  dnsManual,
  configureAcme,
  acmeStatus,
  onStatusChange,
  acknowledgeManualSsl,
  onNext,
}: Props) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>(
    dnsManual ? "manual" : "configuring"
  )
  const [status, setStatus] = useState<AcmeStatus>("pending")
  const [errorCode, setErrorCode] = useState("")
  const [ackBusy, setAckBusy] = useState(false)

  const mountedRef = useRef(true)
  const ranRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Keep the latest poll callbacks so the phase-keyed interval never calls stale props.
  const acmeStatusRef = useRef(acmeStatus)
  acmeStatusRef.current = acmeStatus
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // configure the ACME provider then enter the monitor phase. Re-runnable on retry.
  const run = () => {
    setErrorCode("")
    setPhase("configuring")
    configureAcme({ hostname, contactEmail })
      .then(() => {
        if (!mountedRef.current) return
        setPhase("monitor")
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return
        setErrorCode(codeFromError(e))
        setPhase("error")
      })
  }

  // Manual DNS: write the SSL acknowledgment marker, then advance. Re-runnable on retry.
  const acknowledgeManual = () => {
    setAckBusy(true)
    acknowledgeManualSsl()
      .then(() => {
        setAckBusy(false)
        onNext()
      })
      .catch((e: unknown) => {
        setAckBusy(false)
        if (!mountedRef.current) return
        setErrorCode(codeFromError(e) || "SETUP-SSL-REJECTED")
        setPhase("error")
      })
  }

  // Retry the action for the CURRENT mode: manual ack in manual DNS mode, the
  // ACME auto path otherwise. (A manual failure must not jump to configureAcme.)
  const retry = () => {
    if (dnsManual) {
      setErrorCode("")
      setPhase("manual")
      acknowledgeManual()
    } else {
      run()
    }
  }

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    // Manual DNS: DNS-01 ACME can't run here — skip configureAcme, show the note.
    if (!dnsManual) run()
    // Run-once mount effect; run uses stable props/setters only.
  }, [])

  // Poll acmeStatus() once immediately on entering monitor, then every 5s.
  useEffect(() => {
    if (phase !== "monitor") return
    const fetchStatus = () => {
      acmeStatusRef
        .current()
        .then((res) => {
          if (!mountedRef.current) return
          setStatus(res.status)
          onStatusChangeRef.current(res.status)
        })
        .catch(() => {
          // Transient errors are ignored; the next tick retries.
        })
    }
    fetchStatus()
    pollRef.current = setInterval(fetchStatus, 5000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [phase])

  const badgeVariant =
    status === "failed"
      ? "destructive"
      : status === "valid"
        ? "success"
        : "pending"

  return (
    <div className="step-body">
      <StepHeader
        title={t("wizard.ssl.title")}
        sub={t("wizard.ssl.subtitle")}
      />

      {phase === "configuring" ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t("wizard.ssl.configuring")}
        </p>
      ) : null}

      {phase === "manual" ? (
        <>
          <Alert variant="info" title={t("wizard.ssl.manualTitle")}>
            {t("wizard.ssl.manualNote")}
          </Alert>
          <StepNav
            onNext={acknowledgeManual}
            nextLabel={t("wizard.common.next")}
            backLabel={t("wizard.common.back")}
            busy={ackBusy}
          />
        </>
      ) : null}

      {phase === "error" ? (
        <SetupErrorBox
          code={errorCode}
          messageKey={messageKeyForCode(errorCode)}
          onRetry={retry}
        />
      ) : null}

      {phase === "monitor" ? (
        <>
          <div className="recap">
            <div className="recap-row">
              <span className="recap-label">{t("wizard.ssl.provider")}</span>
              <span className="recap-value">
                {t("wizard.ssl.providerValue")}
              </span>
            </div>
            <div className="recap-row">
              <span className="recap-label">{t("wizard.ssl.contact")}</span>
              <span className="recap-value mono">{contactEmail}</span>
            </div>
            <div className="recap-row">
              <span className="recap-label">{t("wizard.ssl.san")}</span>
              <span className="recap-value mono">{hostname}</span>
            </div>
            <div className="recap-row">
              <span className="recap-label">{t("wizard.ssl.task")}</span>
              <span className="recap-value">
                <Badge variant={badgeVariant} pulse={status === "pending"}>
                  {t("wizard.ssl.status." + status)}
                </Badge>
              </span>
            </div>
          </div>

          {status === "failed" ? (
            <Alert variant="warning" title={t("wizard.ssl.status.failed")}>
              {t("wizard.ssl.failedHint")}
            </Alert>
          ) : null}

          {status !== "valid" ? (
            <p
              className="help"
              style={{ display: "flex", alignItems: "flex-start", gap: 6 }}
            >
              <IconInfo size={14} style={{ marginTop: 2 }} />
              {t("wizard.ssl.nonBlocking")}
            </p>
          ) : null}

          <StepNav
            onNext={onNext}
            nextLabel={t("wizard.common.next")}
            backLabel={t("wizard.common.back")}
          />
        </>
      ) : null}
    </div>
  )
}
