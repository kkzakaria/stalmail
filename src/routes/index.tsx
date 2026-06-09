import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

// setup-flag reaches `node:fs`; this route is client-bundled, so import it lazily
// inside the server-fn handler (stripped from the client build) to avoid binding
// `node:fs` named exports in client code.
export async function getSetupStatus(): Promise<{ configured: boolean }> {
  const { isSetupComplete } = await import('../server/setup-flag')
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
