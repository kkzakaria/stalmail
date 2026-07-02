import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  showImagesOnceFn,
  trustSenderFn,
  untrustSenderFn,
} from "../../server/mail-actions"
import { normalizeSender } from "../../server/image-prefs"
import type { AppThreadDetail, ImageDecision } from "../../server/mail-types"
import { useToast } from "./toast"

export interface ImageActions {
  showOnce: (emailId: string) => Promise<void>
  trustSender: (sender: string) => Promise<void>
  untrustSender: (sender: string) => Promise<void>
}

// Mutations de persistance des images (#70), scopées au fil ouvert (detailKey).
// showOnce/trustSender : patch optimiste (relâchent toujours → le serveur confirmera).
// untrustSender : invalidation (re-résolution serveur autoritaire — un message peut aussi
// porter le keyword, donc le nouvel état n'est pas devinable sans refetch).
export function useImageActions(threadId: string): ImageActions {
  const qc = useQueryClient()
  const notify = useToast()
  const { t } = useTranslation()
  const detailKey = ["thread", threadId] as const

  function patch(
    pred: (m: AppThreadDetail["messages"][number]) => boolean,
    to: ImageDecision
  ) {
    qc.setQueryData<AppThreadDetail>(detailKey, (d) =>
      d
        ? {
            ...d,
            messages: d.messages.map((m) =>
              pred(m) ? { ...m, imageDecision: to } : m
            ),
          }
        : d
    )
  }

  return {
    showOnce: async (emailId) => {
      await qc.cancelQueries({ queryKey: detailKey })
      patch((m) => m.id === emailId, "message-allowed")
      try {
        await showImagesOnceFn({ data: { emailIds: [emailId] } })
      } catch {
        await qc.invalidateQueries({ queryKey: detailKey })
        notify(t("mail.actions.error"), "error")
      }
    },
    trustSender: async (sender) => {
      const norm = normalizeSender(sender)
      await qc.cancelQueries({ queryKey: detailKey })
      patch(
        (m) => normalizeSender(m.from.at(0)?.email ?? "") === norm,
        "sender-allowed"
      )
      try {
        await trustSenderFn({ data: { sender } })
      } catch {
        await qc.invalidateQueries({ queryKey: detailKey })
        notify(t("mail.actions.error"), "error")
      }
    },
    untrustSender: async (sender) => {
      try {
        await untrustSenderFn({ data: { sender } })
        await qc.invalidateQueries({ queryKey: detailKey })
      } catch {
        await qc.invalidateQueries({ queryKey: detailKey })
        notify(t("mail.actions.error"), "error")
      }
    },
  }
}
