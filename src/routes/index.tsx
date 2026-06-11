import { createFileRoute, redirect } from '@tanstack/react-router'
import { setupStatusFn } from '@/server/setup-actions'

export const Route = createFileRoute('/')({
  loader: async () => {
    const { configured } = await setupStatusFn()
    if (!configured) throw redirect({ to: '/setup' })
    throw redirect({ to: '/mail/$folder', params: { folder: 'inbox' } })
  },
  component: () => null,
})
