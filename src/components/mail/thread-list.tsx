import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { ThreadRow } from './thread-row'
import { useWindowedThreads } from './use-windowed-threads'
import type { WindowedThreads } from './use-windowed-threads'

type ThreadsHook = (folder: string, visibleIndexes: number[]) => WindowedThreads

const ROW_HEIGHT = 64
const PROVISIONAL_COUNT = 30

export function ThreadList({
  folder,
  provisionalCount,
  useThreadsHook = useWindowedThreads,
}: {
  folder: string
  provisionalCount?: number // = mailbox.totalEmails passé par le parent (R2)
  useThreadsHook?: ThreadsHook
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  // probe + windowed convergent vers la même query-key (réseau dédupliqué par react-query) ; le virtualizer a besoin de `count` avant de connaître les index visibles → double abonnement inévitable par construction.
  const probe = useThreadsHook(folder, [0])
  const count = probe.total ?? provisionalCount ?? PROVISIONAL_COUNT

  const virt = useVirtualizer({
    count,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getScrollElement: () => scrollRef.current,
  })

  const items = virt.getVirtualItems()
  const visible = items.map((v) => v.index)
  const windowed = useThreadsHook(folder, visible.length ? visible : [0])

  // (toutes les hooks sont appelées avant tout return — pas de hook conditionnel)
  if (probe.isError || windowed.isError) {
    return (
      <div className="list-error" role="alert">
        {t('mail.error')}
      </div>
    )
  }
  if (probe.total === 0) {
    return <div className="list-empty">{t('mail.empty')}</div>
  }

  return (
    <div className="list-rows" ref={scrollRef}>
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {items.map((item) => (
          <div
            key={item.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: item.size,
              transform: `translateY(${item.start}px)`,
            }}
          >
            <ThreadRow thread={windowed.threadAt(item.index)} folder={folder} />
          </div>
        ))}
      </div>
    </div>
  )
}
