import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { sendMailFn } from "../../server/mail-actions"
import { parseAddressList  } from "../../server/compose-build"
import type {ComposeMode} from "../../server/compose-build";
import { useToast } from "./toast"

export interface ComposerDraft {
  mode: ComposeMode
  to: string
  cc: string
  bcc: string
  subject: string
  html: string
  inReplyTo?: string
  references: string[]
}

export interface UseComposer {
  sending: boolean
  send: (draft: ComposerDraft) => Promise<boolean>
}

export function useComposer(folder: string): UseComposer {
  const qc = useQueryClient()
  const notify = useToast()
  const { t } = useTranslation()
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false) // R-F : garde synchrone anti-double-soumission (avant re-render)

  async function send(draft: ComposerDraft): Promise<boolean> {
    if (inFlight.current) return false
    const to = parseAddressList(draft.to)
    const cc = parseAddressList(draft.cc)
    const bcc = parseAddressList(draft.bcc)
    if (to.invalid.length || cc.invalid.length || bcc.invalid.length) {
      notify(t("mail.compose.invalidRecipients"), "error")
      return false
    }
    if (to.valid.length + cc.valid.length + bcc.valid.length === 0) {
      notify(t("mail.compose.noRecipient"), "error")
      return false
    }
    inFlight.current = true
    setSending(true)
    try {
      await sendMailFn({
        data: {
          mode: draft.mode,
          to: to.valid,
          cc: cc.valid,
          bcc: bcc.valid,
          subject: draft.subject,
          html: draft.html,
          inReplyTo: draft.inReplyTo,
          references: draft.references,
        },
      })
      notify(t("mail.compose.sent"), "success")
      await qc.invalidateQueries({ queryKey: ["threads", folder] })
      return true
    } catch {
      notify(t("mail.compose.error"), "error")
      return false
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  return { sending, send }
}
