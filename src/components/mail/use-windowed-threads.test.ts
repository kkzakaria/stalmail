import { describe, expect, it } from 'vitest'
import { pageIndexesForItems, threadAt } from './use-windowed-threads'
import type { AppThread, EmailListPage } from '../../server/mail-types'

describe('pageIndexesForItems', () => {
  it('mappe les index visibles vers les plages distinctes', () => {
    // PAGE=50 : index 48 et 51 → plages 0 et 1
    expect(pageIndexesForItems([48, 49, 50, 51], 50)).toEqual([0, 1])
  })
  it('dédoublonne', () => {
    expect(pageIndexesForItems([0, 1, 2], 50)).toEqual([0])
  })
})

describe('threadAt', () => {
  const page0: EmailListPage = {
    total: 120, position: 0,
    threads: [{ id: 'e0' } as AppThread, { id: 'e1' } as AppThread],
  }
  const pages = new Map<number, EmailListPage>([[0, page0]])

  it('résout un index chargé vers son AppThread', () => {
    expect(threadAt(pages, 1, 50)?.id).toBe('e1')
  })
  it("renvoie undefined (skeleton) si la plage n'est pas chargée", () => {
    expect(threadAt(pages, 60, 50)).toBeUndefined()
  })
  it("renvoie undefined si l'index dépasse la plage chargée", () => {
    expect(threadAt(pages, 5, 50)).toBeUndefined()
  })
})
