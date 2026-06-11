import { jmapCall, resolveAccountId, firstResponse, JmapError } from './jmap'

// Stalwart only honours X-Forwarded-For when the Http singleton's useXForwarded is
// on. Without it, every /api/auth failure pools on the BFF's IP → auto-ban of the
// BFF for all users (authBanRate default 100/day). Must run while the recovery
// admin is still active, i.e. during the wizard, before markSetupComplete().
export async function enableXForwarded(): Promise<void> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Http/set', { accountId, update: { singleton: { useXForwarded: true } } }, '0'],
  ])
  const [name, result] = firstResponse(responses)
  const updated = (result as { updated?: Record<string, unknown> }).updated
  if (name === 'error' || !updated || !('singleton' in updated)) {
    throw new JmapError('failed to enable useXForwarded', result)
  }
}
