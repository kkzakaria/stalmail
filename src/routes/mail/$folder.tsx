// src/routes/mail/$folder.tsx
import { createFileRoute } from '@tanstack/react-router'
import { requireAuth } from '@/lib/auth-guard'

export const Route = createFileRoute('/mail/$folder')({
  beforeLoad: () => requireAuth(),
  component: MailPage,
})

function MailPage() {
  const { folder } = Route.useParams()
  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground text-sm">Mailbox: {folder} — Plan 4</p>
    </div>
  )
}
