import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((opts: unknown) => ({ __redirect: opts })),
}))

vi.mock('@tanstack/react-router', () => ({ redirect: mockRedirect }))
vi.mock('@/server/auth-actions', () => ({ sessionStatusFn: vi.fn() }))

// eslint-disable-next-line import/first
import { sessionStatusFn } from '@/server/auth-actions'
// eslint-disable-next-line import/first
import { requireAuth } from './auth-guard'

beforeEach(() => vi.clearAllMocks())

describe('requireAuth', () => {
  it('returns the account name when authenticated', async () => {
    vi.mocked(sessionStatusFn).mockResolvedValue({ authenticated: true, accountName: 'a@x' })
    expect(await requireAuth()).toEqual({ accountName: 'a@x' })
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(vi.mocked(sessionStatusFn)).toHaveBeenCalledOnce()
  })

  it('throws a redirect to /login when unauthenticated', async () => {
    vi.mocked(sessionStatusFn).mockResolvedValue({ authenticated: false })
    await expect(requireAuth()).rejects.toMatchObject({ __redirect: { to: '/login' } })
    expect(vi.mocked(sessionStatusFn)).toHaveBeenCalledOnce()
  })
})
