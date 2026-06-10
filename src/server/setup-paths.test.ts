import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// In the compose deployment the app (BFF) and the stalwart service share a volume:
// the BFF writes the restart sentinel under STALMAIL_RUN_DIR and the setup-complete
// flag under STALMAIL_DATA_DIR; the Stalwart supervisor watches the sentinel. These
// tests pin that the modules honour those env vars (default /run/stalmail and
// /var/lib/stalwart) so compose can repoint them at the shared volume (/shared).
describe('cross-container coordination paths', () => {
  const saved = { ...process.env }
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stalmail-paths-'))
  })
  afterEach(() => {
    process.env = { ...saved }
    rmSync(dir, { recursive: true, force: true })
  })

  it('requestStalwartRestart writes the sentinel under STALMAIL_RUN_DIR', async () => {
    process.env.STALMAIL_RUN_DIR = dir
    const { requestStalwartRestart } = await import('./stalwart-restart')
    requestStalwartRestart()
    expect(existsSync(join(dir, 'restart-stalwart'))).toBe(true)
  })

  it('markSetupComplete writes the flag under STALMAIL_DATA_DIR; isSetupComplete reads it', async () => {
    process.env.STALMAIL_DATA_DIR = dir
    const { markSetupComplete, isSetupComplete } = await import('./setup-flag')
    expect(isSetupComplete()).toBe(false)
    markSetupComplete()
    expect(existsSync(join(dir, '.stalmail-configured'))).toBe(true)
    expect(isSetupComplete()).toBe(true)
  })
})
