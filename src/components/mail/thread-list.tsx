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

  // Sonde : charge la plage 0 pour obtenir le total (react-query déduplique avec windowed).
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

  // jsdom : le virtualizer mesure une hauteur 0 → aucun item ; fallback non-virtualisé
  // sur les premières lignes (plafonné) pour rester rendu/testable.
  const rows = items.length
    ? items
    : Array.from({ length: Math.min(count, 50) }, (_, i) => ({
        key: i,
        index: i,
        size: ROW_HEIGHT,
        start: i * ROW_HEIGHT,
      }))

  return (
    <div className="list-rows" ref={scrollRef}>
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {rows.map((item) => (
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
