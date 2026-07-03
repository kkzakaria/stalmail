import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import type { ReactNode } from "react"
import { useImageActions } from "./use-image-actions"
import type { AppThreadDetail } from "../../server/mail-types"

const showImages = vi.fn().mockResolvedValue({ ok: true })
const hideImages = vi.fn().mockResolvedValue({ ok: true })
const trust = vi.fn().mockResolvedValue({ ok: true })
const untrust = vi.fn().mockResolvedValue({ ok: true })
vi.mock("../../server/mail-actions", () => ({
  showImagesOnceFn: (a: unknown) => showImages(a),
  hideImagesFn: (a: unknown) => hideImages(a),
  trustSenderFn: (a: unknown) => trust(a),
  untrustSenderFn: (a: unknown) => untrust(a),
}))
const notifyMock = vi.fn()
vi.mock("./toast", () => ({ useToast: () => notifyMock }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

afterEach(() => vi.clearAllMocks())

const detail: AppThreadDetail = {
  threadId: "t1",
  subject: "s",
  emailIds: ["e1"],
  starred: false,
  unread: false,
  messages: [
    {
      id: "e1",
      messageId: null,
      from: [{ name: "Bob", email: "bob@x.io" }],
      to: [],
      cc: [],
      subject: "s",
      receivedAt: "2026-06-10T00:00:00Z",
      unread: false,
      hasAttachment: false,
      textBody: null,
      htmlBody: null,
      attachments: [],
      imageDecision: "blocked",
      authVerdict: "pass",
    },
  ],
}

function setup() {
  const qc = new QueryClient()
  qc.setQueryData(["thread", "t1"], detail)
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useImageActions("t1"), { wrapper })
  return { qc, result }
}

describe("useImageActions", () => {
  it("showOnce : patch optimiste message-allowed + appelle le serveur", async () => {
    const { qc, result } = setup()
    await result.current.showOnce("e1")
    expect(showImages).toHaveBeenCalledWith({ data: { emailIds: ["e1"] } })
    const d = qc.getQueryData<AppThreadDetail>(["thread", "t1"])
    expect(d?.messages[0].imageDecision).toBe("message-allowed")
  })

  it("trustSender : patch optimiste UNIQUEMENT des messages pass + invalidation au succès", async () => {
    const { qc, result } = setup()
    const spy = vi.spyOn(qc, "invalidateQueries")
    await result.current.trustSender("Bob@x.io")
    expect(trust).toHaveBeenCalledWith({ data: { sender: "Bob@x.io" } })
    const d = qc.getQueryData<AppThreadDetail>(["thread", "t1"])
    expect(d?.messages[0].imageDecision).toBe("sender-allowed") // authVerdict: "pass"
    expect(spy).toHaveBeenCalledWith({ queryKey: ["thread", "t1"] })
  })

  it("trustSender : message fail/none NON patché optimistiquement (gating #126)", async () => {
    const { qc, result } = setup()
    qc.setQueryData<AppThreadDetail>(["thread", "t1"], {
      ...detail,
      messages: [{ ...detail.messages[0], authVerdict: "fail" }],
    })
    await result.current.trustSender("bob@x.io")
    const d = qc.getQueryData<AppThreadDetail>(["thread", "t1"])
    expect(d?.messages[0].imageDecision).toBe("blocked")
  })

  it("hideImages : patch optimiste blocked + appelle le serveur (révocation par-message)", async () => {
    const { qc, result } = setup()
    qc.setQueryData<AppThreadDetail>(["thread", "t1"], {
      ...detail,
      messages: [{ ...detail.messages[0], imageDecision: "message-allowed" }],
    })
    await result.current.hideImages("e1")
    expect(hideImages).toHaveBeenCalledWith({ data: { emailIds: ["e1"] } })
    const d = qc.getQueryData<AppThreadDetail>(["thread", "t1"])
    expect(d?.messages[0].imageDecision).toBe("blocked")
  })

  it("untrustSender : invalide le détail (re-résolution serveur)", async () => {
    const { qc, result } = setup()
    const spy = vi.spyOn(qc, "invalidateQueries")
    await result.current.untrustSender("bob@x.io")
    expect(untrust).toHaveBeenCalledWith({ data: { sender: "bob@x.io" } })
    expect(spy).toHaveBeenCalledWith({ queryKey: ["thread", "t1"] })
  })

  it("showOnce : échec serveur → invalidation + toast d'erreur (pas de restore snapshot)", async () => {
    const { qc, result } = setup()
    const spy = vi.spyOn(qc, "invalidateQueries")
    showImages.mockRejectedValueOnce(new Error("boom"))
    await result.current.showOnce("e1")
    expect(notifyMock).toHaveBeenCalledWith("mail.actions.error", "error")
    expect(spy).toHaveBeenCalledWith({ queryKey: ["thread", "t1"] })
  })

  it("trustSender : échec serveur → invalidation + toast d'erreur (pas de restore snapshot)", async () => {
    const { qc, result } = setup()
    const spy = vi.spyOn(qc, "invalidateQueries")
    trust.mockRejectedValueOnce(new Error("boom"))
    await result.current.trustSender("bob@x.io")
    expect(notifyMock).toHaveBeenCalledWith("mail.actions.error", "error")
    expect(spy).toHaveBeenCalledWith({ queryKey: ["thread", "t1"] })
  })
})
