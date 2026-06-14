import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { requireAuth } from '@/lib/auth-guard'
import { mailboxesFn } from '@/server/mail-actions'
import { MailLayout, AppSidebar, ThreadList } from '@/components/mail'
import type { AppMailbox } from '@/server/mail-types'
import '@/components/mail/mail.css'

export const Route = createFileRoute('/mail/$folder')({
  beforeLoad: () => requireAuth(),
  loader: async () => {
    const mailboxes = await mailboxesFn()
    return { mailboxes }
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { folder } = Route.useParams()
  const { mailboxes } = Route.useLoaderData()
  const { accountName } = Route.useRouteContext()
  return <MailPage folder={folder} mailboxes={mailboxes} accountName={accountName} />
}

// Composant présentationnel testable (props injectées, pas de hooks de route).
export function MailPage({
  folder,
  mailboxes,
  accountName = '',
}: {
  folder: string
  mailboxes: AppMailbox[]
  accountName?: string
}) {
  const { t } = useTranslation()
  const activeMailbox = mailboxes.find((m) => m.role === folder)
  return (
    <MailLayout
      sidebar={<AppSidebar mailboxes={mailboxes} activeFolder={folder} accountName={accountName} />}
      list={
        // 'snoozed' n'a pas de mailbox JMAP → resolveFilter lèverait. On ne monte donc PAS
        // la liste : placeholder « Disponible prochainement » (spec §2.2, Plan 4d).
        folder === 'snoozed' ? (
          <div className="list-empty">{t('mail.snoozedUnavailable')}</div>
        ) : (
          <ThreadList folder={folder} provisionalCount={activeMailbox?.totalEmails} />
        )
      }
    />
  )
}
