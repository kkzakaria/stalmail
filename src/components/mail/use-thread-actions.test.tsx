import { afterEach, describe, expect, it, vi } from "vitest"
import { patchThreadInPages } from "./use-thread-actions"
import type { EmailListPage, AppThread } from "../../server/mail-types"

// Mock des server functions
const setFlags = vi.fn().mockResolvedValue({ ok: true })
const move = vi.fn().mockResolvedValue({ ok: true })
vi.mock("../../server/mail-actions", () => ({
  setFlagsFn: (args: unknown) => setFlags(args),
  moveThreadFn: (args: unknown) => move(args),
}))

afterEach(() => {
  vi.clearAllMocks()
})

const thread = (over: Partial<AppThread> = {}): AppThread => ({
  id: "e1",
  threadId: "t1",
  subject: "s",
  preview: "p",
  from: [],
  to: [],
  messageCount: 1,
  receivedAt: "2026-06-10T00:00:00Z",
  unread: true,
  starred: false,
  hasAttachment: false,
  mailboxIds: ["mi"],
  ...over,
})

describe("patchThreadInPages (pur)", () => {
  it("patche l'AppThread par id (handle = email représentatif)", () => {
    const page: EmailListPage = {
      threads: [thread({ id: "e1", threadId: "t1" })],
      total: 1,
      position: 0,
    }
    const out = patchThreadInPages(page, "e1", { unread: false })
    expect(out.threads[0].unread).toBe(false)
  })
  it("matche par id et PAS par threadId (régression : point non-lu persistant)", () => {
    // Handle = AppThread.id ('e1'), threadId distinct ('t1') — cas réel JMAP (id ≠ threadId).
    const page: EmailListPage = {
      threads: [thread({ id: "e1", threadId: "t1", unread: true })],
      total: 1,
      position: 0,
    }
    // Patcher par l'id (le vrai handle ?thread/selectedId) doit marcher…
    expect(
      patchThreadInPages(page, "e1", { unread: false }).threads[0].unread
    ).toBe(false)
    // …et patcher par le threadId ne doit RIEN toucher (no-op, même référence).
    expect(patchThreadInPages(page, "t1", { unread: false })).toBe(page)
  })
  it("laisse la page inchangée (même réf) si id absent", () => {
    const page: EmailListPage = {
      threads: [thread({ id: "e1" })],
      total: 1,
      position: 0,
    }
    expect(patchThreadInPages(page, "eX", { unread: false })).toBe(page)
  })
  it("ne patche que la cible, laisse les autres intactes", () => {
    const page: EmailListPage = {
      threads: [
        thread({ id: "e1", threadId: "t1", unread: true }),
        thread({ id: "e2", threadId: "t2", unread: true }),
      ],
      total: 2,
      position: 0,
    }
    const out = patchThreadInPages(page, "e1", { unread: false })
    expect(out.threads[0].unread).toBe(false)
    expect(out.threads[1].unread).toBe(true)
    expect(out).not.toBe(page)
  })
  it("préserve les champs non patchés", () => {
    const page: EmailListPage = {
      threads: [thread({ id: "e1", unread: true, starred: false })],
      total: 1,
      position: 0,
    }
    const out = patchThreadInPages(page, "e1", { starred: true })
    expect(out.threads[0].starred).toBe(true)
    expect(out.threads[0].unread).toBe(true)
  })
})
