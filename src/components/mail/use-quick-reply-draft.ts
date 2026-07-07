import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  buildReplyContext,
  buildForwardContext,
} from "../../server/compose-build"
import type {
  AppThreadDetail,
  AppMessage,
  MailAddress,
} from "../../server/mail-types"
import type { ComposerDraft } from "./use-composer"

function formatAddrs(addrs: MailAddress[]): string {
  return addrs
    .map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))
    .join(", ")
}

export interface UseQuickReplyDraft {
  draft: ComposerDraft | null
  openReply: (mode: "reply" | "replyAll") => void
  openForward: (message: AppMessage) => void
  patch: (p: Partial<ComposerDraft>) => void
  close: () => void
}

// État du brouillon de réponse rapide, remonté au Reader : le déclencheur du
// transfert vit dans MessageItem (par-message, #79) tandis que l'éditeur vit
// dans QuickReply — le hook est leur source de vérité commune.
export function useQuickReplyDraft(
  detail: AppThreadDetail | undefined,
  selfEmail: string
): UseQuickReplyDraft {
  const { t, i18n } = useTranslation()
  const [draft, setDraft] = useState<ComposerDraft | null>(null)

  // Identités stables (useCallback) : la liste de messages ne doit pas se
  // re-rendre à chaque frappe dans l'éditeur (CodeRabbit #138).
  const openReply = useCallback(
    (mode: "reply" | "replyAll"): void => {
      if (!detail) return
      const last = detail.messages.at(-1)
      const ctx = buildReplyContext(
        detail,
        mode,
        selfEmail,
        last?.messageId ?? undefined
      )
      setDraft({
        mode,
        to: formatAddrs(ctx.to),
        cc: formatAddrs(ctx.cc),
        bcc: "",
        subject: ctx.subject,
        html: ctx.quotedHtml,
        inReplyTo: ctx.inReplyTo,
        references: ctx.references,
        attachments: [],
      })
    },
    [detail, selfEmail]
  )

  const openForward = useCallback(
    (message: AppMessage): void => {
      if (!detail) return
      const ctx = buildForwardContext(
        message,
        detail.subject,
        {
          forwarded: t("mail.compose.fwdForwarded"),
          from: t("mail.compose.fwdFrom"),
          date: t("mail.compose.fwdDate"),
          subject: t("mail.compose.fwdSubject"),
          to: t("mail.compose.fwdTo"),
          cc: t("mail.compose.fwdCc"),
        },
        i18n.language
      )
      setDraft({
        mode: "forward",
        to: "",
        cc: "",
        bcc: "",
        subject: ctx.subject,
        html: ctx.quotedHtml,
        references: [],
        attachments: ctx.attachments,
      })
    },
    [detail, t, i18n.language]
  )

  const patch = useCallback(
    (p: Partial<ComposerDraft>) => setDraft((d) => (d ? { ...d, ...p } : d)),
    []
  )

  const close = useCallback(() => setDraft(null), [])

  return { draft, openReply, openForward, patch, close }
}
