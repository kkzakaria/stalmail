import { existsSync, writeFileSync } from 'node:fs'

function flagPath(): string {
  return process.env.STALMAIL_DATA_DIR
    ? `${process.env.STALMAIL_DATA_DIR}/.stalmail-configured`
    : '/var/lib/stalwart/.stalmail-configured'
}

export function isSetupComplete(): boolean {
  return existsSync(flagPath())
}

export function markSetupComplete(): void {
  writeFileSync(flagPath(), new Date().toISOString(), 'utf-8')
}
