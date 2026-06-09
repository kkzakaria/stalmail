import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { isSetupComplete } from '../server/setup-flag'

export async function getSetupStatus(): Promise<{ configured: boolean }> {
  return { configured: isSetupComplete() }
}

const checkSetup = createServerFn({ method: 'GET' }).handler(getSetupStatus)

export const Route = createFileRoute('/')({
  loader: async () => {
    const { configured } = await checkSetup()
    // Routes /setup and /mail/inbox are created in Task 5; cast until then
    if (!configured) throw redirect({ to: '/setup' as any })
    throw redirect({ to: '/mail/inbox' as any })
  },
  component: () => null,
})
