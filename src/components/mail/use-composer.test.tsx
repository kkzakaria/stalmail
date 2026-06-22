import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import type { ReactNode } from "react"
import { useComposer } from "./use-composer"

const sendMail = vi.fn()
vi.mock("../../server/mail-actions", () => ({
  sendMailFn: (a: unknown) => sendMail(a),
}))
const notify = vi.fn()
vi.mock("./toast", () => ({ useToast: () => notify }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

afterEach(() => vi.clearAllMocks())

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient()
  return createElement(QueryClientProvider, { client: qc }, children)
}

const draft = {
  mode: "compose" as const,
  to: "alice@x.fr",
  cc: "",
  bcc: "",
  subject: "Bonjour",
  html: "<p>Salut</p>",
  references: [] as string[],
}

describe("useComposer", () => {
  it("envoie : parse les adresses, appelle sendMailFn, toast succès, retourne true", async () => {
    sendMail.mockResolvedValue({ ok: true, emailId: "e1" })
    const { result } = renderHook(() => useComposer("inbox"), { wrapper })
    let ok = false
    await act(async () => {
      ok = await result.current.send(draft)
    })
    expect(ok).toBe(true)
    expect(sendMail).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mode: "compose",
        to: [{ name: "", email: "alice@x.fr" }],
        subject: "Bonjour",
      }),
    })
    expect(notify).toHaveBeenCalledWith("mail.compose.sent", "success")
  })

  it("adresse invalide : pas d'appel serveur, toast erreur, retourne false", async () => {
    const { result } = renderHook(() => useComposer("inbox"), { wrapper })
    let ok = true
    await act(async () => {
      ok = await result.current.send({ ...draft, to: "pas-valide" })
    })
    expect(ok).toBe(false)
    expect(sendMail).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      "mail.compose.invalidRecipients",
      "error"
    )
  })

  it("échec serveur : toast erreur, retourne false (contenu conservé)", async () => {
    sendMail.mockRejectedValue(new Error("réseau"))
    const { result } = renderHook(() => useComposer("inbox"), { wrapper })
    let ok = true
    await act(async () => {
      ok = await result.current.send(draft)
    })
    expect(ok).toBe(false)
    expect(notify).toHaveBeenCalledWith("mail.compose.error", "error")
  })
})
