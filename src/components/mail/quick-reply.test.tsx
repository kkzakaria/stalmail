import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QuickReply } from "./quick-reply"
import { useQuickReplyDraft } from "./use-quick-reply-draft"
import type { AppThreadDetail } from "../../server/mail-types"
import type { ComposerDraft } from "./use-composer"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "fr-FR" },
  }),
}))

const detail: AppThreadDetail = {
  threadId: "t1",
  subject: "Sujet",
  messages: [
    {
      id: "m1",
      messageId: null,
      from: [{ name: "Alice", email: "alice@x.fr" }],
      to: [{ name: "Moi", email: "me@x.fr" }],
      cc: [],
      subject: "Sujet",
      receivedAt: "2026-06-10T00:00:00Z",
      unread: false,
      hasAttachment: false,
      textBody: "corps",
      htmlBody: "<p>corps</p>",
      attachments: [],
    },
  ],
  emailIds: ["m1"],
  starred: false,
  unread: false,
}

// Fil avec messageId pour tester le threading RFC
const detailWithMessageId: AppThreadDetail = {
  ...detail,
  messages: [
    {
      ...detail.messages[0],
      messageId: "<m1@host>",
    },
  ],
}

// Fil avec Cc pour tester l'auto-exclusion replyAll
const detailWithCc: AppThreadDetail = {
  ...detail,
  messages: [
    {
      ...detail.messages[0],
      messageId: "<m1@host>",
      to: [{ name: "Alice", email: "alice@x.fr" }],
      cc: [
        { name: "Moi", email: "me@x.fr" },
        { name: "Bob", email: "bob@x.fr" },
      ],
    },
  ],
}

// Harnais : QuickReply est présentationnel, l'état du brouillon vit dans le hook.
function Harness({
  detail: thread,
  onSend,
  sending = false,
}: {
  detail: AppThreadDetail
  onSend: (d: ComposerDraft) => boolean | void | Promise<boolean | void>
  sending?: boolean
}) {
  const qr = useQuickReplyDraft(thread, "me@x.fr")
  return (
    <QuickReply
      draft={qr.draft}
      draftKey={qr.draftKey}
      sending={sending}
      onOpenReply={qr.openReply}
      onPatch={qr.patch}
      onClose={qr.close}
      onSend={onSend}
    />
  )
}

describe("QuickReply", () => {
  it("affiche la barre de réponse et passe en mode édition au clic", () => {
    render(<Harness detail={detail} onSend={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    expect(screen.getByLabelText("mail.compose.body")).toBeInTheDocument()
  })

  it("envoie un brouillon de réponse pré-rempli (mode reply, objet Re:)", () => {
    const onSend = vi.fn()
    render(<Harness detail={detail} onSend={onSend} />)
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "reply",
        to: "Alice <alice@x.fr>",
        subject: "Re: Sujet",
        attachments: [],
      })
    )
  })

  it("réinitialise la réponse rapide après un envoi réussi (onSend → true)", async () => {
    // Contrat async réel : onSend renvoie une Promise<boolean> (comme composer.send).
    const onSend = vi.fn().mockResolvedValue(true)
    render(<Harness detail={detail} onSend={onSend} />)
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    expect(screen.getByLabelText("mail.compose.body")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    // Succès (après résolution de la promesse) → l'éditeur disparaît, la barre revient.
    await waitFor(() =>
      expect(
        screen.queryByLabelText("mail.compose.body")
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("button", { name: "mail.compose.reply" })
    ).toBeInTheDocument()
  })

  it("garde la réponse rapide ouverte ET préserve le contenu si l'envoi échoue (onSend résout false)", async () => {
    const onSend = vi.fn().mockResolvedValue(false)
    render(<Harness detail={detail} onSend={onSend} />)
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    // La citation pré-remplie ("corps" du dernier message) est dans l'éditeur.
    expect(screen.getByLabelText("mail.compose.body")).toHaveTextContent(
      "corps"
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    await waitFor(() => expect(onSend).toHaveBeenCalled())
    // Échec → l'éditeur reste affiché AVEC son contenu (pour réessayer sans tout reperdre).
    expect(screen.getByLabelText("mail.compose.body")).toHaveTextContent(
      "corps"
    )
  })

  it("threading reply : inReplyTo et references reprennent le Message-ID du dernier message", () => {
    const onSend = vi.fn()
    render(<Harness detail={detailWithMessageId} onSend={onSend} />)
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        inReplyTo: "<m1@host>",
        references: ["<m1@host>"],
      })
    )
  })

  it("replyAll : selfEmail est exclu du Cc du brouillon émis", () => {
    const onSend = vi.fn()
    render(<Harness detail={detailWithCc} onSend={onSend} />)
    fireEvent.click(
      screen.getByRole("button", { name: "mail.compose.replyAll" })
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    const draft = onSend.mock.calls[0][0]
    // me@x.fr ne doit pas apparaître dans le Cc
    expect(draft.cc).not.toMatch(/me@x\.fr/)
    // Bob doit être présent
    expect(draft.cc).toMatch(/bob@x\.fr/)
  })

  it("n'affiche plus de bouton Transférer dans la barre", () => {
    render(<Harness detail={detail} onSend={() => {}} />)
    expect(
      screen.queryByRole("button", { name: "mail.compose.forward" })
    ).not.toBeInTheDocument()
  })

  it("le champ À porte un label visible relié (trois modes)", () => {
    render(<Harness detail={detail} onSend={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    const input = screen.getByLabelText("mail.compose.to")
    expect(input).toBeInstanceOf(HTMLInputElement)
    // le label est un élément <label> rendu (pas un aria-label invisible)
    expect(document.querySelector('label[for="qr-to"]')?.textContent).toBe(
      "mail.compose.to"
    )
  })
})

// Harnais dédié : expose openForward (déclenché par MessageItem en T7, simulé ici).
// Deux boutons "fwd A"/"fwd B" (messages[0]/messages[1] si présents) pour
// simuler le changement de cible de transfert sans fermer l'éditeur (#142).
function ForwardHarness({ detail: thread }: { detail: AppThreadDetail }) {
  const qr = useQuickReplyDraft(thread, "me@x.fr")
  return (
    <>
      <button onClick={() => qr.openForward(thread.messages[0])}>fwd A</button>
      {thread.messages[1] && (
        <button onClick={() => qr.openForward(thread.messages[1])}>
          fwd B
        </button>
      )}
      <QuickReply
        draft={qr.draft}
        draftKey={qr.draftKey}
        sending={false}
        onOpenReply={qr.openReply}
        onPatch={qr.patch}
        onClose={qr.close}
        onSend={() => {}}
      />
    </>
  )
}

const detailWithAttachment: AppThreadDetail = {
  ...detail,
  messages: [
    {
      ...detail.messages[0],
      attachments: [
        { blobId: "b1", name: "f.pdf", type: "application/pdf", size: 2048 },
      ],
    },
  ],
}

// Fil à deux messages : pour simuler le transfert de A puis B sans fermeture
// intermédiaire de l'éditeur (revue PR #142).
const detailTwoMessages: AppThreadDetail = {
  ...detail,
  messages: [
    detail.messages[0],
    {
      ...detail.messages[0],
      id: "m2",
      from: [{ name: "Charlie", email: "charlie@x.fr" }],
    },
  ],
  emailIds: ["m1", "m2"],
}

describe("QuickReply — pièces jointes du transfert", () => {
  it("forward : affiche les puces de pièces jointes reprises", () => {
    render(<ForwardHarness detail={detailWithAttachment} />)
    fireEvent.click(screen.getByText("fwd A"))
    expect(screen.getByText("f.pdf")).toBeInTheDocument()
  })

  it("forward : retire une pièce jointe via son bouton ×", () => {
    render(<ForwardHarness detail={detailWithAttachment} />)
    fireEvent.click(screen.getByText("fwd A"))
    fireEvent.click(
      screen.getByRole("button", { name: "mail.compose.removeAttachment" })
    )
    expect(screen.queryByText("f.pdf")).not.toBeInTheDocument()
  })
})

describe("QuickReply — bascules Cc/Cci (transfert uniquement)", () => {
  it("forward : la bascule Cc révèle une rangée reliée et la saisie patch draft.cc", () => {
    render(<ForwardHarness detail={detail} />)
    fireEvent.click(screen.getByText("fwd A"))
    // bascules visibles, rangées absentes
    expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    // la rangée apparaît, le bouton bascule disparaît
    const cc = screen.getByLabelText("mail.compose.cc")
    expect(
      screen.queryByRole("button", { name: "mail.compose.cc" })
    ).not.toBeInTheDocument()
    fireEvent.change(cc, { target: { value: "bob@x.fr" } })
    // Paramètre générique plutôt qu'un "as" : évite le conflit avec
    // no-unnecessary-type-assertion (eslint --fix retire l'assertion).
    expect(
      screen.getByLabelText<HTMLInputElement>("mail.compose.cc").value
    ).toBe("bob@x.fr")
  })

  it("forward : la bascule Cci révèle sa rangée (indépendante de Cc)", () => {
    render(<ForwardHarness detail={detail} />)
    fireEvent.click(screen.getByText("fwd A"))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
    expect(screen.getByLabelText("mail.compose.bcc")).toBeInTheDocument()
    expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
  })

  it("reply et replyAll : aucune bascule Cc/Cci", () => {
    render(<Harness detail={detailWithCc} onSend={() => {}} />)
    fireEvent.click(
      screen.getByRole("button", { name: "mail.compose.replyAll" })
    )
    expect(
      screen.queryByRole("button", { name: "mail.compose.cc" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "mail.compose.bcc" })
    ).not.toBeInTheDocument()
  })

  it("fermer puis rouvrir : les rangées Cc/Cci sont refermées", () => {
    render(<ForwardHarness detail={detail} />)
    fireEvent.click(screen.getByText("fwd A"))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    expect(screen.getByLabelText("mail.compose.cc")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.close" }))
    fireEvent.click(screen.getByText("fwd A"))
    expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })

  it("transférer A, ouvrir Cc, transférer B SANS fermer → la rangée Cc se referme (revue PR #142)", () => {
    // Fil à deux messages : transférer B remplace le brouillon (non-null →
    // non-null) sans passer par la fermeture — c'est le cas manqué par
    // l'ancien useEffect (reset uniquement sur !draft).
    render(<ForwardHarness detail={detailTwoMessages} />)
    fireEvent.click(screen.getByText("fwd A"))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    expect(screen.getByLabelText("mail.compose.cc")).toBeInTheDocument()
    fireEvent.click(screen.getByText("fwd B"))
    expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })
})
