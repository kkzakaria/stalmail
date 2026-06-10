import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  poll: () => Promise<{ step: string }>
  onReady: (step: string) => void
  intervalMs?: number
  timeoutMs?: number
}

export function RestartScreen({ poll, onReady, intervalMs = 2000, timeoutMs = 90_000 }: Props) {
  const { t } = useTranslation()
  const [timedOut, setTimedOut] = useState(false)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const state = { active: true }
    const started = Date.now()
    const tick = async () => {
      if (!state.active) return
      try {
        const { step } = await poll()
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!state.active) return
        if (step !== 'collect') {
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
  }, [poll, intervalMs, timeoutMs])

  return (
    <div className="space-y-3 py-12 text-center">
      <div className="border-primary mx-auto h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
      <h2 className="text-lg font-medium">{t('wizard.restart.title')}</h2>
      <p className="text-muted-foreground text-sm">
        {timedOut ? t('wizard.restart.timeout') : t('wizard.restart.subtitle')}
      </p>
    </div>
  )
}
