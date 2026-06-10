import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner, Progress, StepHeader, Button } from './ui/primitives'

interface Props {
  poll: () => Promise<{ step: string }>
  onReady: (step: string) => void
  intervalMs?: number
  timeoutMs?: number
}

interface PollLine {
  n: number
  ready: boolean
}

export function RestartScreen({ poll, onReady, intervalMs = 2000, timeoutMs = 90_000 }: Props) {
  const { t } = useTranslation()
  const [timedOut, setTimedOut] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [lines, setLines] = useState<PollLine[]>([])
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const state = { active: true }
    const started = Date.now()
    let count = 0
    const tick = async () => {
      if (!state.active) return
      try {
        const { step } = await poll()
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!state.active) return
        const ready = step !== 'collect'
        count += 1
        const n = count
        setLines((prev) => [...prev, { n, ready }])
        if (ready) {
          onReadyRef.current(step)
          return
        }
      } catch {
        // ignore transient errors while the server is down
      }
      if (Date.now() - started >= timeoutMs) {
        setTimedOut(true)
        return
      }
      setTimeout(() => void tick(), intervalMs)
    }
    void tick()
    return () => {
      state.active = false
    }
  }, [poll, intervalMs, timeoutMs, attempt])

  const retry = () => {
    setTimedOut(false)
    setLines([])
    setAttempt((a) => a + 1)
  }

  return (
    <div className="step-body step-restart" aria-busy={!timedOut}>
      <div className="restart-spinner">
        <Spinner size={28} />
      </div>
      <StepHeader
        title={t('wizard.restart.title')}
        sub={timedOut ? t('wizard.restart.timeout') : t('wizard.restart.subtitle')}
      />
      <Progress indeterminate />
      <div className="poll-log mono" aria-live="polite">
        {lines.slice(-4).map((l) => (
          <p key={l.n} className={'poll-line' + (l.ready ? ' poll-line-ok' : '')}>
            {t('wizard.restart.poll', { n: l.n })} →{' '}
            {l.ready ? t('wizard.restart.ready') : t('wizard.restart.restarting')}
          </p>
        ))}
      </div>
      {timedOut ? (
        <Button variant="primary" onClick={retry}>
          {t('wizard.common.retry')}
        </Button>
      ) : null}
    </div>
  )
}
