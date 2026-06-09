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
    if (!configured) throw redirect({ to: '/setup' })
    throw redirect({ to: '/mail/$folder', params: { folder: 'inbox' } })
  },
  component: () => null,
})
