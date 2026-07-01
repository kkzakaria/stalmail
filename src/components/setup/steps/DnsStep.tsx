// Stalmail wizard — DNS step: collect provider+secret (merged from the former
// DnsProviderStep), then execute. Auto path: createDnsServer → setDnsManagement →
// live gridStatus() poll. Manual path: setDnsManagementManual → grid (copy/download).
// The secret never leaves this component (collected and passed straight to
// createDnsServer). Ports the design prototype StepDns.
import { Fragment, useEffect, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { DNS_PROVIDERS } from "@/lib/dns-providers"
import type { DnsProvider } from "@/lib/dns-providers"
import type { DnsGridRecord, HostAddressRecord } from "@/server/setup-actions"
import { isIpv4, isIpv6 } from "@/lib/ip"
import { HostAddressSection } from "./HostAddressSection"
import type { DnsProviderValues } from "../schemas"
import { dnsProviderSchema } from "../schemas"
import {
  Alert,
  Badge,
  CopyButton,
  Field,
  Spinner,
  StepHeader,
  StepNav,
  TextInput,
} from "../ui/primitives"
import { Combobox } from "../ui/Combobox"
import {
  StatusBadge,
  CopyIconBtn,
  DownloadButton,
} from "../ui/monitor-primitives"
import { IconCheck, IconInfo } from "../ui/icons"
import { SetupErrorBox } from "../ui/SetupErrorBox"
import { codeFromError, messageKeyForCode } from "../error-code"
import type { DnsManagementStatus } from "@/server/stalwart-dns"

// Décision de transition de la phase 'verifying' à partir du statut sondé et du
// temps écoulé. Pure → testée isolément. La tâche DnsManagement met ~80-100s à
// s'exécuter (probe #62, variable — un token invalide déclenche en plus un
// rate-limit 429 côté provider qui rallonge l'échec) ; au-delà de la deadline on
// passe à la grille sans bloquer (Stalwart continue de réessayer en tâche de fond).
export function nextVerifyPhase(
  status: DnsManagementStatus,
  elapsedMs: number,
  deadlineMs: number
): "error" | "grid" | "wait" {
  if (status === "failed") return "error"
  if (status === "published") return "grid"
  return elapsedMs >= deadlineMs ? "grid" : "wait"
}

// 3 min : marge confortable au-dessus des ~80-100s d'exécution observés (incl.
// rate-limit 429), pour capter un token invalide avant de tomber sur la grille.
const VERIFY_DEADLINE_MS = 180_000

function zoneFileText(records: DnsGridRecord[]) {
  const pad = (s: string, n: number) => (s.length >= n ? s + " " : s.padEnd(n))
  return records
    .map((r) => pad(r.name, 34) + "3600 IN " + pad(r.type, 6) + r.value)
    .join("\n")
}

// Groups by type for the manual sectioned view (title/desc keys: groups.<key>.t/.d).
const DNS_GROUP_DEFS = [
  { type: "MX", key: "mx" },
  { type: "TXT", key: "txt" },
  { type: "SRV", key: "srv" },
  { type: "CNAME", key: "cname" },
] as const

const PROVIDER_OPTIONS = DNS_PROVIDERS.filter((p) => p !== "Manual")

type Phase =
  | "form"
  | "connecting"
  | "publishing"
  | "verifying"
  | "grid"
  | "error"

interface Props {
  hostname: string
  domain: string
  createDnsServer: (i: {
    provider: string
    secret: string
  }) => Promise<{ dnsServerId: string }>
  setDnsManagement: (i: { dnsServerId: string }) => Promise<{ ok: true }>
  setDnsManagementManual: () => Promise<{ ok: true }>
  gridStatus: () => Promise<{ origin: string; records: DnsGridRecord[] }>
  dnsManagementStatus: () => Promise<{ status: DnsManagementStatus }>
  discoverServerIp: () => Promise<{ ipv4: string | null; ipv6: string | null }>
  hostAddressStatus: (ip: {
    ipv4?: string
    ipv6?: string
  }) => Promise<{ records: HostAddressRecord[] }>
  onNext: (manual: boolean) => void
}

export function DnsStep({
  hostname,
  domain,
  createDnsServer,
  setDnsManagement,
  setDnsManagementManual,
  gridStatus,
  dnsManagementStatus,
  discoverServerIp,
  hostAddressStatus,
  onNext,
}: Props) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>("form")
  const [provider, setProvider] = useState("Manual")
  const [records, setRecords] = useState<DnsGridRecord[]>([])
  const [errorCode, setErrorCode] = useState("")
  const [serverIp, setServerIp] = useState<{
    ipv4: string | null
    ipv6: string | null
  } | null>(null)
  const [ipDiscovery, setIpDiscovery] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle")
  const [hostRecords, setHostRecords] = useState<HostAddressRecord[]>([])

  const isManual = provider === "Manual"

  const mountedRef = useRef(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dnsManagementStatusRef = useRef(dnsManagementStatus)
  dnsManagementStatusRef.current = dnsManagementStatus

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const form = useForm({
    defaultValues: { provider: "Manual", secret: "" },
    validators: { onSubmit: dnsProviderSchema },
    onSubmit: ({ value }: { value: DnsProviderValues }) => {
      setProvider(value.provider)
      if (value.provider === "Manual") {
        runManual()
      } else {
        runAuto(value.provider, value.secret)
      }
    },
  })

  // Auto path: createDnsServer -> setDnsManagement -> grid. Re-runnable on retry.
  const runAuto = (prov: string, secret: string) => {
    setErrorCode("")
    setPhase("connecting")
    createDnsServer({ provider: prov, secret })
      .then(({ dnsServerId }) => {
        if (!mountedRef.current) return null
        setPhase("publishing")
        return setDnsManagement({ dnsServerId })
      })
      .then((res) => {
        if (!mountedRef.current || res === null) return
        setPhase("verifying")
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return
        setErrorCode(codeFromError(e))
        setPhase("error")
      })
  }

  // Manual path: confirm manual management server-side, then show the grid.
  const runManual = () => {
    setErrorCode("")
    setPhase("connecting")
    setDnsManagementManual()
      .then(() => {
        if (!mountedRef.current) return
        setPhase("grid")
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return
        setErrorCode(codeFromError(e))
        setPhase("error")
      })
  }

  // Manual failures can be safely re-run (no credential involved). Auto failures
  // often mean a bad token, so return to the form to let the user RE-ENTER it
  // instead of blindly replaying a known-bad secret.
  const retry = () => {
    if (isManual) {
      runManual()
    } else {
      form.setFieldValue("secret", "")
      setErrorCode("")
      setPhase("form")
    }
  }

  // Poll gridStatus() once immediately on entering grid, then every 5s.
  useEffect(() => {
    if (phase !== "grid") return
    const fetchGrid = () => {
      gridStatus()
        .then((res) => {
          if (mountedRef.current) setRecords(res.records)
        })
        .catch(() => {
          // Transient resolver errors are ignored; the next tick retries.
        })
    }
    fetchGrid()
    pollRef.current = setInterval(fetchGrid, 5000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [phase])

  // Phase 'verifying' : la tâche DnsManagement est la SOURCE DE VÉRITÉ du succès
  // de publication (un token invalide passait inaperçu via le cache DNS — #62).
  // Poll 5s jusqu'à la deadline ; failed → erreur (ressaisie token), published →
  // grille, pending au timeout → grille (non bloquant).
  // Invariant (probe #62) : setDnsManagementAutomatic planifie la tâche
  // DnsManagement de façon synchrone — elle est déjà présente (Pending) au
  // premier sondage. Un classement "published" (tâche absente) ne survient donc
  // qu'APRÈS exécution+nettoyage réussis, jamais avant création. Pas de course.
  useEffect(() => {
    if (phase !== "verifying") return
    const startedAt = Date.now()
    const tick = () => {
      dnsManagementStatusRef
        .current()
        .then(({ status }) => {
          if (!mountedRef.current) return
          const next = nextVerifyPhase(
            status,
            Date.now() - startedAt,
            VERIFY_DEADLINE_MS
          )
          if (next === "error") {
            setErrorCode("SETUP-DNS-PUBLISH-FAILED")
            setPhase("error")
          } else if (next === "grid") {
            setPhase("grid")
          }
        })
        .catch(() => {
          // Erreurs transitoires ignorées ; le tick suivant réessaie. Au-delà de
          // la deadline, on avance quand même vers la grille.
          if (
            mountedRef.current &&
            Date.now() - startedAt >= VERIFY_DEADLINE_MS
          ) {
            setPhase("grid")
          }
        })
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [phase])

  // À l'entrée de la grille : découvrir l'IP du serveur une fois (écho sortant).
  useEffect(() => {
    if (phase !== "grid") return
    setIpDiscovery("loading")
    discoverServerIp()
      .then((ip) => {
        if (!mountedRef.current) return
        if (ip.ipv4 || ip.ipv6) {
          setServerIp(ip)
          setIpDiscovery("ready")
        } else {
          setIpDiscovery("failed")
        }
      })
      .catch(() => {
        if (mountedRef.current) setIpDiscovery("failed")
      })
  }, [phase])

  // Poll du statut des enregistrements d'adresse dès que la découverte d'IP est
  // RÉSOLUE (succès ou échec). Sans IP (écho échoué), on interroge quand même :
  // le handler renvoie alors les enregistrements indépendants de l'IP (CNAME
  // webmail), affichés sous le formulaire de saisie manuelle.
  useEffect(() => {
    if (phase !== "grid") return
    if (ipDiscovery !== "ready" && ipDiscovery !== "failed") return
    const ip = serverIp
      ? {
          ipv4: serverIp.ipv4 ?? undefined,
          ipv6: serverIp.ipv6 ?? undefined,
        }
      : {}
    const fetchHost = () => {
      hostAddressStatus(ip)
        .then((res) => {
          if (mountedRef.current) setHostRecords(res.records)
        })
        .catch(() => {})
    }
    fetchHost()
    const id = setInterval(fetchHost, 5000)
    return () => clearInterval(id)
  }, [phase, serverIp, ipDiscovery])

  const onManualIp = (value: string) => {
    setServerIp({
      ipv4: isIpv4(value) ? value : null,
      ipv6: isIpv6(value) ? value : null,
    })
    setIpDiscovery("ready")
  }

  const recordStatusLabels = {
    verified: t("wizard.recordStatus.verified"),
    pending: t("wizard.recordStatus.pending"),
    error: t("wizard.recordStatus.error"),
  }
  const copyLabel = t("wizard.common.copy")
  const copiedLabel = t("wizard.common.copied")

  // Task badge derivation.
  const statuses = [
    ...records.filter((r) => r.type !== "A" && r.type !== "AAAA"),
    ...hostRecords,
  ].map((r) => r.status)
  const allVerified =
    statuses.length > 0 && statuses.every((s) => s === "verified")
  const anyError = statuses.some((s) => s === "error")
  const anyPending = statuses.some((s) => s === "pending")
  const taskKey = allVerified
    ? "completed"
    : anyError
      ? "partial"
      : anyPending
        ? "inProgress"
        : "pending"
  const taskInProgress = taskKey === "inProgress"
  const taskVariant =
    taskKey === "completed"
      ? "success"
      : taskKey === "partial"
        ? "destructive"
        : "pending"

  const zoneText = zoneFileText(records)

  // -------- form phase (provider + secret collection) --------
  if (phase === "form") {
    return (
      <form
        className="step-body"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <StepHeader
          title={t("wizard.dns.title")}
          sub={t("wizard.dns.subtitle")}
        />

        <form.Field
          name="provider"
          children={(field) => (
            <Field
              label={t("wizard.dns.provider")}
              htmlFor={field.name}
              error={
                !field.state.meta.isValid ? t("wizard.dns.required") : undefined
              }
            >
              <Combobox
                id={field.name}
                value={field.state.value}
                invalid={!field.state.meta.isValid}
                options={PROVIDER_OPTIONS}
                stickyOption={{
                  value: "Manual",
                  label: t("wizard.dns.manual"),
                  hint: t("wizard.dns.manualHint"),
                }}
                placeholder={t("wizard.dns.placeholder")}
                searchPlaceholder={t("wizard.dns.search")}
                emptyText={t("wizard.dns.empty")}
                onChange={(v) => {
                  field.handleChange(v as DnsProvider)
                  form.setFieldValue("secret", "")
                }}
              />
            </Field>
          )}
        />

        <form.Subscribe
          selector={(s) => s.values.provider}
          children={(prov) =>
            prov !== "Manual" ? (
              <form.Field
                name="secret"
                children={(field) => (
                  <Field
                    label={t("wizard.dns.secret")}
                    htmlFor={field.name}
                    help={t("wizard.dns.secretHelp", { domain })}
                    error={
                      !field.state.meta.isValid
                        ? t("wizard.dns.secretRequired")
                        : undefined
                    }
                  >
                    <TextInput
                      id={field.name}
                      type="password"
                      mono
                      value={field.state.value}
                      invalid={!field.state.meta.isValid}
                      onChange={(v) => field.handleChange(v)}
                    />
                  </Field>
                )}
              />
            ) : (
              <Alert variant="info">{t("wizard.dns.manualNote")}</Alert>
            )
          }
        />

        <StepNav
          onNext={() => void form.handleSubmit()}
          nextLabel={t("wizard.common.next")}
          backLabel={t("wizard.common.back")}
        />
      </form>
    )
  }

  return (
    <div className="step-body step-body-wide">
      <StepHeader
        title={t("wizard.dns.records.title")}
        sub={
          isManual
            ? t("wizard.dns.records.subManual")
            : t("wizard.dns.records.subAuto", { provider })
        }
      />

      {phase === "connecting" ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t("wizard.dns.records.connecting", { provider })}
        </p>
      ) : null}

      {phase === "publishing" ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t("wizard.dns.records.publishing")}
        </p>
      ) : null}

      {phase === "verifying" ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t("wizard.dns.records.verifying")}
        </p>
      ) : null}

      {phase === "error" ? (
        <SetupErrorBox
          code={errorCode}
          messageKey={messageKeyForCode(errorCode)}
          onRetry={retry}
        />
      ) : null}

      {phase === "grid" ? (
        <>
          <HostAddressSection
            records={hostRecords}
            status={
              ipDiscovery === "failed"
                ? "failed"
                : ipDiscovery === "ready"
                  ? "ready"
                  : "loading"
            }
            domain={domain}
            onManualIp={onManualIp}
          />
          {isManual ? (
            <div className="dns-manual">
              <div className="dns-table-wrap">
                <table className="dns-table dns-table-manual">
                  <tbody>
                    {DNS_GROUP_DEFS.map((g) => {
                      const recs = records.filter((r) => r.type === g.type)
                      if (recs.length === 0) return null
                      return (
                        <Fragment key={g.type}>
                          <tr className="dns-sect">
                            <td colSpan={3}>
                              <span className="dns-sect-line">
                                <span className="rec-type-chip mono">
                                  {g.type}
                                </span>
                                <span className="dns-sect-title">
                                  {t(
                                    "wizard.dns.records.groups." + g.key + ".t"
                                  )}
                                </span>
                                <span className="dns-sect-desc">
                                  {t(
                                    "wizard.dns.records.groups." + g.key + ".d",
                                    {
                                      host: hostname,
                                      domain,
                                    }
                                  )}
                                </span>
                              </span>
                            </td>
                          </tr>
                          {recs.map((r, i) => {
                            return (
                              <tr
                                key={g.type + "-" + i}
                                className={
                                  r.status === "error" ? "row-error" : ""
                                }
                              >
                                <td className="rec-name-cell">
                                  <span className="cell-copy">
                                    <CopyIconBtn
                                      text={r.name}
                                      copyLabel={copyLabel}
                                      copiedLabel={copiedLabel}
                                    />
                                    <span
                                      className="mono cell-text"
                                      title={r.name}
                                    >
                                      {r.name}
                                    </span>
                                  </span>
                                </td>
                                <td className="rec-value-cell">
                                  <span className="cell-copy">
                                    <CopyIconBtn
                                      text={r.value}
                                      copyLabel={copyLabel}
                                      copiedLabel={copiedLabel}
                                    />
                                    <span
                                      className="mono cell-text"
                                      title={r.value}
                                    >
                                      {r.value}
                                    </span>
                                  </span>
                                </td>
                                <td
                                  className="rec-status-cell"
                                  style={{ textAlign: "right" }}
                                >
                                  <StatusBadge
                                    status={r.status}
                                    labels={recordStatusLabels}
                                  />
                                </td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="zonefile-head">
                <span className="help" style={{ margin: 0 }}>
                  {t("wizard.dns.records.zoneFull")}
                </span>
                <div className="zonefile-actions">
                  <CopyButton
                    text={zoneText}
                    label={copyLabel}
                    copiedLabel={copiedLabel}
                    small
                  />
                  <DownloadButton
                    content={zoneText + "\n"}
                    filename={`${domain}.zone.txt`}
                    label={t("wizard.dns.records.downloadTxt")}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="dns-auto">
              <div className="dns-sect-line">
                <span className="dns-sect-title">
                  {t("wizard.dns.records.autoTitle")}
                </span>
              </div>
              <div className="dns-table-wrap dns-table-scroll">
                <table className="dns-table">
                  <thead>
                    <tr>
                      <th>{t("wizard.dns.records.type")}</th>
                      <th>{t("wizard.dns.records.name")}</th>
                      <th>{t("wizard.dns.records.value")}</th>
                      <th style={{ textAlign: "right" }}>
                        {t("wizard.dns.records.status")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {records
                      .filter((r) => r.type !== "A" && r.type !== "AAAA")
                      .map((r, i) => (
                        <tr
                          key={r.type + "-" + i}
                          className={r.status === "error" ? "row-error" : ""}
                        >
                          <td>
                            <span className="rec-type mono">{r.type}</span>
                          </td>
                          <td className="mono rec-name" title={r.name}>
                            {r.name}
                          </td>
                          <td className="mono rec-value" title={r.value}>
                            {r.value}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <StatusBadge
                              status={r.status}
                              labels={recordStatusLabels}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="dns-foot">
            <span className="task-line">
              <span className="task-label">{t("wizard.dns.records.task")}</span>
              <Badge variant={taskVariant} pulse={taskInProgress}>
                {t("wizard.taskStatus." + taskKey)}
              </Badge>
            </span>
            <span className="dns-foot-note">
              {allVerified ? <IconCheck size={14} /> : <IconInfo size={14} />}
              {allVerified
                ? t("wizard.dns.records.allOk")
                : t("wizard.dns.records.background")}
            </span>
          </div>

          <StepNav
            onNext={() => onNext(isManual)}
            nextLabel={t("wizard.common.next")}
            backLabel={t("wizard.common.back")}
          />
        </>
      ) : null}
    </div>
  )
}
