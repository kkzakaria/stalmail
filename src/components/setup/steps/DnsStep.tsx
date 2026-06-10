// Stalmail wizard — step 7: DNS records (monitoring phase).
// Ports the design prototype StepDns
// (docs/design/wizard-handoff/project/wizard/steps-monitor.jsx), replacing the
// timer simulation with the real createDnsServer / setDnsManagement mutations and
// a live gridStatus() poll.
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DnsGridRecord } from '@/server/setup-actions'
import { Alert, Badge, CopyButton, Spinner, StepHeader, StepNav } from '../ui/primitives'
import { StatusBadge, CopyIconBtn, DownloadButton } from '../ui/monitor-primitives'
import { IconCheck, IconInfo } from '../ui/icons'

/* ---------- local helpers (duplicated from DomainStep on purpose) ---------- */
function isExternalHost(h: string, d: string) {
  if (!h || !d) return false
  const a = h.toLowerCase(),
    b = d.toLowerCase()
  return a !== b && !a.endsWith('.' + b)
}
function hostZone(h: string) {
  const p = (h || '').split('.')
  return p.length > 2 ? p.slice(1).join('.') : h
}
function zoneFileText(records: DnsGridRecord[]) {
  const pad = (s: string, n: number) => (s.length >= n ? s + ' ' : s.padEnd(n))
  return records
    .map((r) => pad(r.name, 34) + '3600 IN ' + pad(r.type, 6) + r.value)
    .join('\n')
}

// Groups by type for the manual sectioned view (title/desc keys: groups.<key>.t/.d).
const DNS_GROUP_DEFS = [
  { type: 'A', key: 'a' },
  { type: 'MX', key: 'mx' },
  { type: 'TXT', key: 'txt' },
  { type: 'SRV', key: 'srv' },
  { type: 'CNAME', key: 'cname' },
] as const

type Phase = 'connecting' | 'publishing' | 'grid' | 'error'

interface Props {
  provider: string
  secret: string
  hostname: string
  domain: string
  createDnsServer: (i: { provider: string; secret: string }) => Promise<{ dnsServerId: string }>
  setDnsManagement: (i: { dnsServerId: string }) => Promise<{ ok: true }>
  gridStatus: () => Promise<{ origin: string; records: DnsGridRecord[] }>
  onNext: () => void
}

export function DnsStep({
  provider,
  secret,
  hostname,
  domain,
  createDnsServer,
  setDnsManagement,
  gridStatus,
  onNext,
}: Props) {
  const { t } = useTranslation()
  const isManual = provider === 'Manual'
  const [phase, setPhase] = useState<Phase>(isManual ? 'grid' : 'connecting')
  const [records, setRecords] = useState<DnsGridRecord[]>([])
  const [errorMsg, setErrorMsg] = useState('')

  const mountedRef = useRef(true)
  const ranRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Auto path: createDnsServer -> setDnsManagement -> grid. Re-runnable on retry.
  const runAuto = () => {
    setErrorMsg('')
    setPhase('connecting')
    createDnsServer({ provider, secret })
      .then(({ dnsServerId }) => {
        if (!mountedRef.current) return null
        setPhase('publishing')
        return setDnsManagement({ dnsServerId })
      })
      .then((res) => {
        if (!mountedRef.current || res === null) return
        setPhase('grid')
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return
        setErrorMsg(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
  }

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    if (!isManual) runAuto()
    // Run-once mount effect; runAuto uses stable props/setters only.
  }, [])

  // Poll gridStatus() once immediately on entering grid, then every 5s.
  useEffect(() => {
    if (phase !== 'grid') return
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

  const recordStatusLabels = {
    verified: t('wizard.recordStatus.verified'),
    pending: t('wizard.recordStatus.pending'),
    error: t('wizard.recordStatus.error'),
  }
  const copyLabel = t('wizard.common.copy')
  const copiedLabel = t('wizard.common.copied')

  // Task badge derivation.
  const statuses = records.map((r) => r.status)
  const allVerified = statuses.length > 0 && statuses.every((s) => s === 'verified')
  const anyError = statuses.some((s) => s === 'error')
  const anyPending = statuses.some((s) => s === 'pending')
  const taskKey = allVerified
    ? 'completed'
    : anyError
      ? 'partial'
      : anyPending
        ? 'inProgress'
        : 'pending'
  const taskInProgress = taskKey === 'inProgress'
  const taskVariant =
    taskKey === 'completed'
      ? 'success'
      : taskKey === 'partial'
        ? 'destructive'
        : 'pending'

  const hasExternalA = records.some(
    (r) => r.type === 'A' && isExternalHost(hostname, domain),
  )

  const zoneText = zoneFileText(records)

  return (
    <div className="step-body step-body-wide">
      <StepHeader
        title={t('wizard.dns.records.title')}
        sub={
          isManual
            ? t('wizard.dns.records.subManual')
            : t('wizard.dns.records.subAuto', { provider })
        }
      />

      {phase === 'connecting' ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t('wizard.dns.records.connecting', { provider })}
        </p>
      ) : null}

      {phase === 'publishing' ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t('wizard.dns.records.publishing')}
        </p>
      ) : null}

      {phase === 'error' ? (
        <>
          <Alert variant="destructive" title={t('wizard.error.title')}>
            {errorMsg}
          </Alert>
          <StepNav
            onNext={runAuto}
            nextLabel={t('wizard.error.retry')}
            backLabel={t('wizard.common.back')}
          />
        </>
      ) : null}

      {phase === 'grid' ? (
        <>
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
                                <span className="rec-type-chip mono">{g.type}</span>
                                <span className="dns-sect-title">
                                  {t('wizard.dns.records.groups.' + g.key + '.t')}
                                </span>
                                <span className="dns-sect-desc">
                                  {t('wizard.dns.records.groups.' + g.key + '.d', {
                                    host: hostname,
                                    domain,
                                  })}
                                </span>
                              </span>
                            </td>
                          </tr>
                          {recs.map((r, i) => {
                            const ext =
                              r.type === 'A' && isExternalHost(hostname, domain)
                            return (
                              <tr
                                key={g.type + '-' + i}
                                className={r.status === 'error' ? 'row-error' : ''}
                              >
                                <td className="rec-name-cell">
                                  <span className="cell-copy">
                                    <CopyIconBtn
                                      text={r.name}
                                      copyLabel={copyLabel}
                                      copiedLabel={copiedLabel}
                                    />
                                    <span className="mono cell-text" title={r.name}>
                                      {r.name}
                                    </span>
                                    {ext ? (
                                      <span className="rec-tag">
                                        {t('wizard.dns.records.extTag')}
                                      </span>
                                    ) : null}
                                  </span>
                                </td>
                                <td className="rec-value-cell">
                                  <span className="cell-copy">
                                    <CopyIconBtn
                                      text={r.value}
                                      copyLabel={copyLabel}
                                      copiedLabel={copiedLabel}
                                    />
                                    <span className="mono cell-text" title={r.value}>
                                      {r.value}
                                    </span>
                                  </span>
                                </td>
                                <td
                                  className="rec-status-cell"
                                  style={{ textAlign: 'right' }}
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
                  {t('wizard.dns.records.zoneFull')}
                </span>
                <div className="zonefile-actions">
                  <CopyButton
                    text={zoneText}
                    label={copyLabel}
                    copiedLabel={copiedLabel}
                    small
                  />
                  <DownloadButton
                    content={zoneText + '\n'}
                    filename={`${domain}.zone.txt`}
                    label={t('wizard.dns.records.downloadTxt')}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="dns-table-wrap">
              <table className="dns-table">
                <thead>
                  <tr>
                    <th>{t('wizard.dns.records.type')}</th>
                    <th>{t('wizard.dns.records.name')}</th>
                    <th>{t('wizard.dns.records.value')}</th>
                    <th style={{ textAlign: 'right' }}>
                      {t('wizard.dns.records.status')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => {
                    const ext =
                      r.type === 'A' && isExternalHost(hostname, domain)
                    return (
                      <tr
                        key={r.type + '-' + i}
                        className={r.status === 'error' ? 'row-error' : ''}
                      >
                        <td>
                          <span className="rec-type mono">{r.type}</span>
                        </td>
                        <td className="mono rec-name" title={r.name}>
                          {r.name}
                          {ext ? (
                            <span className="rec-tag">
                              {t('wizard.dns.records.extTag')}
                            </span>
                          ) : null}
                        </td>
                        <td className="mono rec-value" title={r.value}>
                          {r.value}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <StatusBadge
                            status={r.status}
                            labels={recordStatusLabels}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isManual && hasExternalA ? (
            <Alert variant="warning" title={'A · ' + hostname}>
              {t('wizard.dns.records.extNote', {
                zone: hostZone(hostname),
                domain,
                provider,
              })}
            </Alert>
          ) : null}

          <div className="task-line">
            <span className="task-label">{t('wizard.dns.records.task')}</span>
            <Badge variant={taskVariant} pulse={taskInProgress}>
              {t('wizard.taskStatus.' + taskKey)}
            </Badge>
          </div>

          <p
            className="help"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {allVerified ? <IconCheck size={14} /> : <IconInfo size={14} />}
            {allVerified
              ? t('wizard.dns.records.allOk')
              : t('wizard.dns.records.background')}
          </p>

          <StepNav
            onNext={onNext}
            nextLabel={t('wizard.common.next')}
            backLabel={t('wizard.common.back')}
          />
        </>
      ) : null}
    </div>
  )
}
