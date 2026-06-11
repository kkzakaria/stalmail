import { describe, it, expect, vi } from 'vitest'
import { isSetupComplete } from '../server/setup-flag'
import { setupStatusHandler } from '../server/setup-actions'

vi.mock('../server/setup-flag', () => ({
  isSetupComplete: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: () => ({ handler: (fn: unknown) => fn }),
    handler: (fn: unknown) => fn,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  redirect: vi.fn(),
}))

describe('setupStatusHandler', () => {
  it('returns configured: false when setup not complete', async () => {
    vi.mocked(isSetupComplete).mockReturnValue(false)
    expect(await setupStatusHandler()).toEqual({ configured: false })
  })

  it('returns configured: true when setup is complete', async () => {
    vi.mocked(isSetupComplete).mockReturnValue(true)
    expect(await setupStatusHandler()).toEqual({ configured: true })
  })
})
