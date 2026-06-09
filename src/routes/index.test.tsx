import { describe, it, expect, vi } from 'vitest'
import { isSetupComplete } from '../server/setup-flag'
import { getSetupStatus } from './index'

vi.mock('../server/setup-flag', () => ({
  isSetupComplete: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: unknown) => fn,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  redirect: vi.fn(),
}))

describe('getSetupStatus', () => {
  it('returns configured: false when setup not complete', async () => {
    vi.mocked(isSetupComplete).mockReturnValue(false)
    expect(await getSetupStatus()).toEqual({ configured: false })
  })

  it('returns configured: true when setup is complete', async () => {
    vi.mocked(isSetupComplete).mockReturnValue(true)
    expect(await getSetupStatus()).toEqual({ configured: true })
  })
})
