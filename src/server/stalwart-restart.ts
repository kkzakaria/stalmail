import { writeFileSync } from 'node:fs'

function runDir(): string {
  return process.env.STALMAIL_RUN_DIR ?? '/run/stalmail'
}

export const RESTART_SENTINEL = `${process.env.STALMAIL_RUN_DIR ?? '/run/stalmail'}/restart-stalwart`

export function requestStalwartRestart(): void {
  writeFileSync(`${runDir()}/restart-stalwart`, String(Date.now()), 'utf-8')
}
