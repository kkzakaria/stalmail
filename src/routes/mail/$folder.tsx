import { useEffect, useRef } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { requireAuth } from "@/lib/auth-guard"
import { mailboxesFn, readThreadFn } from "@/server/mail-actions"
import {
  MailLayout,
  AppSidebar,
  ThreadList,
  Reader,
  ToastProvider,
  ToastViewport,
  useThreadActions,
} from "@/components/mail"
import type { AppMailbox } from "@/server/mail-types"
import "@/components/mail/mail.css"

export const Route = createFileRoute("/mail/$folder")({
  beforeLoad: () => requireAuth(),
  validateSearch: (search: Record<string, unknown>): { thread?: string } => ({
    // F7 : borne la longueur (défense en profondeur ; le serveur re-valide via readThreadSchema.max(64)).
    thread:
      typeof search.thread === "string" &&
      search.thread.length > 0 &&
      search.thread.length <= 64
        ? search.thread
        : undefined,
  }),
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
  const { thread: threadId } = Route.useSearch()
  return (
    <MailPage
      folder={folder}
      mailboxes={mailboxes}
      accountName={accountName}
      threadId={threadId}
    />
  )
}

// Composant présentationnel testable (props injectées, pas de hooks de route).
export function MailPage({
  folder,
  mailboxes,
  accountName = "",
  threadId,
}: {
  folder: string
  mailboxes: AppMailbox[]
  accountName?: string
  threadId?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const activeMailbox = mailboxes.find((m) => m.role === folder)

  return (
    <ToastProvider>
      <MailLayout
        sidebar={
          <AppSidebar
            mailboxes={mailboxes}
            activeFolder={folder}
            accountName={accountName}
          />
        }
        list={
          // 'snoozed' n'a pas de mailbox JMAP → resolveFilter lèverait. On ne monte donc PAS
          // la liste : placeholder « Disponible prochainement » (spec §2.2, Plan 4d).
          folder === "snoozed" ? (
            <div className="list-empty">{t("mail.snoozedUnavailable")}</div>
          ) : (
            <ThreadList
              folder={folder}
              provisionalCount={activeMailbox?.totalEmails}
              selectedId={threadId}
              onOpen={(id) =>
                void navigate({
                  to: "/mail/$folder",
                  params: { folder },
                  search: { thread: id },
                })
              }
            />
          )
        }
        reader={
          threadId ? (
            <ReaderPane folder={folder} threadId={threadId} />
          ) : undefined
        }
        // Toast rendu DANS `.app` (tokens/thème maquette + container queries y sont scopés).
        overlay={<ToastViewport />}
      />
    </ToastProvider>
  )
}

// Sous-composant : fetch du fil + actions + auto-marquage lu.
function ReaderPane({
  folder,
  threadId,
}: {
  folder: string
  threadId: string
}) {
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => readThreadFn({ data: { threadId } }),
    staleTime: 30_000,
  })
  const detail = query.data
  const actions = useThreadActions(folder, threadId, detail?.emailIds ?? [])

  // Ref stable vers markRead pour que l'useEffect n'ait pas à dépendre de `actions` (nouvel objet à chaque render).
  const markReadRef = useRef(actions.markRead)
  markReadRef.current = actions.markRead

  // Garde : mémorise le dernier threadId auto-lu pour éviter le double-appel StrictMode/re-render.
  const autoReadRef = useRef<string | null>(null)

  // Auto-marquage lu à l'ouverture d'un fil non lu (design §2.1) — via setFlags (POST), pas dans readThreadFn.
  useEffect(() => {
    if (
      detail &&
      detail.unread &&
      detail.emailIds.length > 0 &&
      autoReadRef.current !== detail.threadId
    ) {
      autoReadRef.current = detail.threadId
      void markReadRef.current(true)
    }
  }, [detail?.threadId, detail?.unread, detail?.emailIds.length])

  return (
    <Reader
      folder={folder}
      detail={detail}
      isLoading={query.isLoading}
      isError={query.isError}
      star={(v) => void actions.star(v)}
      markRead={(v) => void actions.markRead(v)}
      move={(to) => void actions.move(to)}
      onBack={() =>
        void navigate({
          to: "/mail/$folder",
          params: { folder },
          search: { thread: undefined },
        })
      }
    />
  )
}
