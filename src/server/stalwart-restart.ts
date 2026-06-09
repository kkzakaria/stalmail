import { mkdirSync, writeFileSync } from 'node:fs'

function runDir(): string {
  return process.env.STALMAIL_RUN_DIR ?? '/run/stalmail'
}

// Snapshot of the path at import time. requestStalwartRestart() recomputes it
// per call so STALMAIL_RUN_DIR can be overridden (e.g. in tests).
export const RESTART_SENTINEL = `${process.env.STALMAIL_RUN_DIR ?? '/run/stalmail'}/restart-stalwart`

export function requestStalwartRestart(): void {
  const dir = runDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/restart-stalwart`, String(Date.now()), 'utf-8')
}
