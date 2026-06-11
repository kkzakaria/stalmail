import { existsSync, writeFileSync } from 'node:fs'

// The setup-complete flag is a CROSS-CONTAINER coordination artifact (like the restart
// sentinel): the Stalwart supervisor reads it to drop the recovery admin after setup,
// so it must live on the shared volume both containers mount. It therefore shares
// STALMAIL_RUN_DIR with the sentinel (compose points both at /shared) — NOT the app's
// data dir, which is not mounted into the Stalwart container.
function flagPath(): string {
  return `${process.env.STALMAIL_RUN_DIR ?? '/run/stalmail'}/.stalmail-configured`
}

export function isSetupComplete(): boolean {
  return existsSync(flagPath())
}

export function markSetupComplete(): void {
  writeFileSync(flagPath(), new Date().toISOString(), 'utf-8')
}
