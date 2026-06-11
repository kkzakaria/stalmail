import { redirect } from '@tanstack/react-router'
import { sessionStatusFn } from '@/server/auth-actions'

// Use in a route `beforeLoad`. Runs the status server fn; bounces to /login if unauthenticated.
export async function requireAuth(): Promise<{ accountName: string }> {
  const status = await sessionStatusFn()
  if (!status.authenticated) throw redirect({ to: '/login' })
  return { accountName: status.accountName }
}

// Use in a route `beforeLoad`. Bounces already-authenticated users to their inbox.
export async function redirectIfAuthenticated(): Promise<void> {
  const status = await sessionStatusFn()
  if (status.authenticated) throw redirect({ to: '/mail/$folder', params: { folder: 'inbox' } })
}
