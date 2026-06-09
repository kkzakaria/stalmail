import { describe, it, expect, vi, beforeEach } from 'vitest'

const writeFileSync = vi.fn()
vi.mock('node:fs', () => ({ writeFileSync: (...a: unknown[]) => writeFileSync(...a) }))

// eslint-disable-next-line import/first
import { requestStalwartRestart, RESTART_SENTINEL } from './stalwart-restart'

beforeEach(() => vi.clearAllMocks())

describe('requestStalwartRestart', () => {
  it('writes the restart sentinel file at the default path', () => {
    delete process.env.STALMAIL_RUN_DIR
    requestStalwartRestart()
    expect(writeFileSync).toHaveBeenCalledWith('/run/stalmail/restart-stalwart', expect.any(String), 'utf-8')
  })

  it('exposes the default sentinel path as RESTART_SENTINEL', () => {
    expect(RESTART_SENTINEL).toBe('/run/stalmail/restart-stalwart')
  })

  it('honours STALMAIL_RUN_DIR override', () => {
    process.env.STALMAIL_RUN_DIR = '/tmp/run'
    requestStalwartRestart()
    expect(writeFileSync).toHaveBeenCalledWith('/tmp/run/restart-stalwart', expect.any(String), 'utf-8')
    delete process.env.STALMAIL_RUN_DIR
  })
})
