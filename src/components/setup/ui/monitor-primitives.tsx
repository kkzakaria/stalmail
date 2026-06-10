// Stalmail wizard — monitor-step UI primitives.
// StatusBadge, CopyIconBtn, DownloadButton — used in the DNS grid and account
// steps. Ported from docs/design/wizard-handoff/project/wizard/ui.jsx to typed
// TSX. All visible text is passed in via props; i18n is resolved by callers.
import { useEffect, useRef, useState } from 'react'
import { Badge } from './primitives'
import { IconCheck, IconCopy, IconDownload } from './icons'

/* ---------- StatusBadge ---------- */
export interface StatusBadgeProps {
  status: 'verified' | 'pending' | 'error'
  labels: {
    verified: string
    pending: string
    error: string
  }
}

export function StatusBadge({ status, labels }: StatusBadgeProps) {
  if (status === 'verified') {
    return <Badge variant="success">{labels.verified}</Badge>
  }
  if (status === 'error') {
    return <Badge variant="destructive">{labels.error}</Badge>
  }
  // pending (default)
  return (
    <Badge variant="pending" pulse>
      {labels.pending}
    </Badge>
  )
}

/* ---------- CopyIconBtn ---------- */
export interface CopyIconBtnProps {
  text: string
  copyLabel: string
  copiedLabel: string
}

export function CopyIconBtn({ text, copyLabel, copiedLabel }: CopyIconBtnProps) {
  const [ok, setOk] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doCopy = () => {
    // Only flip to the "copied" state once the write actually succeeds; a rejection
    // (denied permission / unavailable clipboard) is swallowed and leaves the idle icon.
    void Promise.resolve(navigator.clipboard.writeText(text))
      .then(() => {
        setOk(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setOk(false), 1600)
      })
      .catch(() => {
        // ignore — clipboard unavailable.
      })
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <button
      type="button"
      className={'copy-icon-btn' + (ok ? ' is-ok' : '')}
      onClick={doCopy}
      aria-label={copyLabel}
      title={ok ? copiedLabel : copyLabel}
    >
      {ok ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
  )
}

/* ---------- DownloadButton ---------- */
export interface DownloadButtonProps {
  content: string
  filename: string
  label: string
}

export function DownloadButton({ content, filename, label }: DownloadButtonProps) {
  const doDownload = () => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <button
      type="button"
      className="copy-btn copy-btn-sm"
      onClick={doDownload}
      title={label}
    >
      <IconDownload size={13} />
      <span>{label}</span>
    </button>
  )
}
