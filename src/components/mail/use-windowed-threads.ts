import { useEffect, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { emailListFn } from '../../server/mail-actions'
import type { AppThread, EmailListPage } from '../../server/mail-types'

export const PAGE = 50

// Pur : index visibles → plages distinctes triées.
export function pageIndexesForItems(indexes: number[], page: number): number[] {
  const set = new Set(indexes.map((i) => Math.floor(i / page)))
  return [...set].sort((a, b) => a - b)
}

// Pur : index absolu → AppThread chargé, ou undefined (skeleton).
export function threadAt(
  pages: Map<number, EmailListPage>,
  index: number,
  page: number,
): AppThread | undefined {
  const p = pages.get(Math.floor(index / page))
  return p?.threads[index % page]
}

// Débounce d'une valeur : ne propage qu'après `delay` ms de stabilité.
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  const ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    clearTimeout(ref.current)
    ref.current = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(ref.current)
  }, [value, delay])
  return debounced
}

export interface WindowedThreads {
  total: number | undefined
  isError: boolean
  threadAt: (index: number) => AppThread | undefined
}

export function useWindowedThreads(folder: string, visibleIndexes: number[]): WindowedThreads {
  const needKey = pageIndexesForItems(visibleIndexes, PAGE).join(',')
  const debouncedKey = useDebounced(needKey, 120)
  const neededPages = debouncedKey === '' ? [] : debouncedKey.split(',').map(Number)

  const results = useQueries({
    queries: neededPages.map((p) => ({
      queryKey: ['threads', folder, p] as const,
      queryFn: () => emailListFn({ data: { folder, position: p * PAGE, limit: PAGE } }),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    })),
  })

  const pages = new Map<number, EmailListPage>()
  results.forEach((r, i) => {
    if (r.data) pages.set(neededPages[i], r.data)
  })

  const total = [...pages.values()][0]?.total
  const isError = results.some((r) => r.isError)

  return {
    total,
    isError,
    threadAt: (index: number) => threadAt(pages, index, PAGE),
  }
}
