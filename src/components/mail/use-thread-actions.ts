import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { setFlagsFn, moveThreadFn } from "../../server/mail-actions"
import type { EmailListPage, AppThreadDetail } from "../../server/mail-types"
import { useToast } from "./toast"

// Pur : patche l'AppThread ouvert dans une page, ou renvoie la page inchangée (même référence)
// si absent. Le handle est **AppThread.id** (id de l'email représentatif = param `?thread` /
// `selectedId`), PAS `AppThread.threadId` — les deux diffèrent côté JMAP (ex. id "eaaaaab" vs
// threadId "b"). Matcher par threadId ne touchait jamais la ligne → le point non-lu persistait.
export function patchThreadInPages(
  page: EmailListPage,
  id: string,
  patch: Partial<{ unread: boolean; starred: boolean }>
): EmailListPage {
  if (!page.threads.some((t) => t.id === id)) return page
  return {
    ...page,
    threads: page.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }
}

export type MoveTo = "archive" | "trash" | "junk" | "inbox" | "spam"

export interface ThreadActions {
  star: (value: boolean) => Promise<void>
  markRead: (value: boolean) => Promise<void>
  move: (to: MoveTo) => Promise<void>
}

// folder = dossier courant (clé de cache liste) ; emailIds/threadId = fil ouvert.
export function useThreadActions(
  folder: string,
  threadId: string,
  emailIds: string[]
): ThreadActions {
  const qc = useQueryClient()
  const router = useRouter()
  const notify = useToast()
  const { t } = useTranslation()
  const listKey = ["threads", folder] as const
  const detailKey = ["thread", threadId] as const

  // Patch optimiste en place (liste + détail) avec snapshot pour rollback.
  async function optimisticFlag(
    flag: "$seen" | "$flagged",
    value: boolean,
    patch: Partial<{ unread: boolean; starred: boolean }>,
    okMsg: string
  ) {
    if (emailIds.length === 0) return // F6 : pas d'action tant que le fil n'est pas chargé (évite un rejet Zod .min(1))
    await qc.cancelQueries({ queryKey: listKey })
    await qc.cancelQueries({ queryKey: detailKey })
    const prevList = qc.getQueriesData<EmailListPage>({ queryKey: listKey })
    const prevDetail = qc.getQueryData(detailKey)
    qc.setQueriesData<EmailListPage>({ queryKey: listKey }, (page) =>
      page ? patchThreadInPages(page, threadId, patch) : page
    )
    qc.setQueryData<AppThreadDetail>(detailKey, (d) =>
      d ? { ...d, ...patch } : d
    )
    try {
      await setFlagsFn({ data: { emailIds, flag, value } })
      notify(okMsg, "success")
    } catch {
      for (const [key, data] of prevList) qc.setQueryData(key, data)
      qc.setQueryData(detailKey, prevDetail)
      notify(t("mail.actions.error"), "error")
    }
  }

  return {
    star: (value) =>
      optimisticFlag(
        "$flagged",
        value,
        { starred: value },
        value ? t("mail.actions.starred") : t("mail.actions.unstarred")
      ),
    markRead: (value) =>
      optimisticFlag(
        "$seen",
        value,
        { unread: !value },
        value ? t("mail.actions.markedRead") : t("mail.actions.markedUnread")
      ),
    move: async (to) => {
      if (emailIds.length === 0) return // F6 : fil non chargé → no-op
      try {
        await moveThreadFn({ data: { emailIds, to } })
        await qc.invalidateQueries({ queryKey: listKey })
        await router.invalidate() // rafraîchit les compteurs sidebar (loader mailboxesFn)
        await router.navigate({
          to: "/mail/$folder",
          params: { folder },
          search: { thread: undefined },
        })
        const msg =
          to === "archive"
            ? t("mail.actions.archived")
            : to === "trash"
              ? t("mail.actions.trashed")
              : to === "spam" || to === "junk"
                ? t("mail.actions.spamReported")
                : t("mail.actions.notSpam")
        notify(msg, "success")
      } catch {
        notify(t("mail.actions.error"), "error")
      }
    },
  }
}
