import { describe, expect, it, vi } from "vitest"
import { patchThreadInPages } from "./use-thread-actions"
import type { EmailListPage, AppThread } from "../../server/mail-types"

// Mock des server functions
const setFlags = vi.fn().mockResolvedValue({ ok: true })
const move = vi.fn().mockResolvedValue({ ok: true })
vi.mock("../../server/mail-actions", () => ({
  setFlagsFn: (args: unknown) => setFlags(args),
  moveThreadFn: (args: unknown) => move(args),
}))

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
  it("patch l'AppThread par threadId dans toutes les pages", () => {
    const page: EmailListPage = { threads: [thread()], total: 1, position: 0 }
    const out = patchThreadInPages(page, "t1", { unread: false })
    expect(out.threads[0].unread).toBe(false)
  })
  it("laisse la page inchangée si threadId absent", () => {
    const page: EmailListPage = { threads: [thread()], total: 1, position: 0 }
    expect(patchThreadInPages(page, "tX", { unread: false })).toBe(page)
  })
})
