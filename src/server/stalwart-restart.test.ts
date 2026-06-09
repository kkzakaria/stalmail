import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const writeFileSync = vi.fn()
const mkdirSync = vi.fn()
vi.mock('node:fs', () => ({
  writeFileSync: (...a: unknown[]) => writeFileSync(...a),
  mkdirSync: (...a: unknown[]) => mkdirSync(...a),
}))

// eslint-disable-next-line import/first
import { requestStalwartRestart, RESTART_SENTINEL } from './stalwart-restart'

const ORIGINAL_RUN_DIR = process.env.STALMAIL_RUN_DIR

beforeEach(() => vi.clearAllMocks())

afterEach(() => {
  if (ORIGINAL_RUN_DIR === undefined) delete process.env.STALMAIL_RUN_DIR
  else process.env.STALMAIL_RUN_DIR = ORIGINAL_RUN_DIR
})

describe('requestStalwartRestart', () => {
  it('writes the restart sentinel file at the default path', () => {
    delete process.env.STALMAIL_RUN_DIR
    requestStalwartRestart()
    expect(writeFileSync).toHaveBeenCalledWith('/run/stalmail/restart-stalwart', expect.any(String), 'utf-8')
  })

  it('exposes a sentinel path ending in /restart-stalwart', () => {
    expect(RESTART_SENTINEL).toMatch(/\/restart-stalwart$/)
  })

  it('honours STALMAIL_RUN_DIR override', () => {
    process.env.STALMAIL_RUN_DIR = '/tmp/run'
    requestStalwartRestart()
    expect(writeFileSync).toHaveBeenCalledWith('/tmp/run/restart-stalwart', expect.any(String), 'utf-8')
  })

  it('creates the run dir before writing the sentinel', () => {
    delete process.env.STALMAIL_RUN_DIR
    requestStalwartRestart()
    expect(mkdirSync).toHaveBeenCalledWith('/run/stalmail', { recursive: true })
  })
})
