import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./jmap', () => ({
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'acc'),
  firstResponse: (responses: [string, Record<string, unknown>, string][], index = 0) => responses[index],
  JmapError: class JmapError extends Error {
    constructor(message: string, readonly detail?: unknown) {
      super(message)
      this.name = 'JmapError'
    }
  },
}))

// eslint-disable-next-line import/first
import { jmapCall } from './jmap'
// eslint-disable-next-line import/first
import { enableXForwarded } from './stalwart-hardening'

beforeEach(() => vi.clearAllMocks())

describe('enableXForwarded', () => {
  it('sets useXForwarded:true on the Http singleton', async () => {
    vi.mocked(jmapCall).mockResolvedValue([
      ['x:Http/set', { updated: { singleton: {} } }, '0'],
    ])
    await enableXForwarded()
    const [calls] = vi.mocked(jmapCall).mock.calls[0]
    expect(calls[0][0]).toBe('x:Http/set')
    expect(calls[0][1]).toMatchObject({ update: { singleton: { useXForwarded: true } } })
  })

  it('throws when the update is rejected', async () => {
    vi.mocked(jmapCall).mockResolvedValue([['error', { type: 'forbidden' }, '0']])
    await expect(enableXForwarded()).rejects.toThrow()
  })
})
