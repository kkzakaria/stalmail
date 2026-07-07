# Transfert véritable (issue #79) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de « Transférer » un vrai transfert : action par message, bloc d'en-tête « Message transféré » (De/Date/Objet/À + Cc), pièces jointes de l'original reprises par `blobId` et retirables dans le composer.

**Architecture:** Extension du pipeline client existant (spec `docs/superpowers/specs/2026-07-06-transfert-veritable-design.md`). Une fonction pure `buildForwardContext` construit le contexte côté client depuis le `AppThreadDetail` déjà chargé ; l'état du brouillon remonte de `QuickReply` vers `Reader` via un hook `useQuickReplyDraft` ; la chaîne d'envoi (`ComposerDraft` → `sendMailSchema` → `buildSendMethodCalls`) gagne un champ `attachments` durci par Zod (contrôle autoritaire F1) et transmis en propriété de commodité RFC 8621 dans `Email/set`.

**Tech Stack:** TanStack Start (server functions BFF), React 19, Zod, DOMPurify (`isomorphic-dompurify`), vitest + @testing-library/react, JMAP (Stalwart), Bun.

## Global Constraints

- Gestionnaire de paquets : **Bun** uniquement (`bun run test`, `bun run lint`, `bun run typecheck`).
- Pre-commit = `lint && typecheck && test` — **jamais** de `--no-verify`.
- Commits conventionnels **en anglais** ; conversation et libellés UI en **français**.
- i18n : tout libellé UI via `t('...')` dans `src/i18n/resources.ts` — aucun texte en dur.
- Sécurité : contraintes Zod par champ sur `attachments` (F1 de la spec) obligatoires ; `name` filtré par `isCleanHeaderValue`, `type` en forme `type/subtype`, `blobId` alphabet `[A-Za-z0-9_-]`.
- Aucune opération JMAP générique exposée au client ; `size` client jamais transmis à JMAP.
- Fonctions pures extraites et testées isolément ; composants présentationnels (props injectées).
- Branche de travail : `feat/79-real-forward` (existante, contient la spec).

---

### Task 1: Autoriser `blockquote` dans l'allowlist DOMPurify

La spec suppose `blockquote` autorisé ; en réalité `ALLOWED_TAGS` ne le contient pas (`src/lib/compose-html.ts:4-15`), donc la citation reply actuelle **perd sa balise** à la sanitisation (bug latent). On l'ajoute — balise inerte, sans attribut, sans risque.

**Files:**

- Modify: `src/lib/compose-html.ts:4-15`
- Test: `src/lib/compose-html.test.ts`

**Interfaces:**

- Consumes: —
- Produces: `sanitizeComposeHtml` conserve désormais `<blockquote>` (utilisé par `buildReplyContext` et, en Task 2, `buildForwardContext`).

- [ ] **Step 1: Écrire le test qui échoue**

Dans `src/lib/compose-html.test.ts`, ajouter au `describe` de `sanitizeComposeHtml` :

```ts
it("conserve blockquote (citation reply/forward)", () => {
  const out = sanitizeComposeHtml("<blockquote><p>cité</p></blockquote>")
  expect(out).toContain("<blockquote>")
  expect(out).toContain("cité")
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/lib/compose-html.test.ts`
Expected: FAIL — la sortie ne contient pas `<blockquote>` (balise strippée).

- [ ] **Step 3: Implémentation minimale**

Dans `src/lib/compose-html.ts`, ajouter `"blockquote"` à la liste :

```ts
const ALLOWED_TAGS = [
  "b",
  "i",
  "strong",
  "em",
  "a",
  "ul",
  "ol",
  "li",
  "p",
  "br",
  "blockquote",
]
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `bun run test -- src/lib/compose-html.test.ts`
Expected: PASS (tous les tests du fichier).

- [ ] **Step 5: Commit**

```bash
git add src/lib/compose-html.ts src/lib/compose-html.test.ts
git commit -m "fix(compose): allow blockquote in sanitize allowlist"
```

---

### Task 2: Fonction pure `buildForwardContext`

**Files:**

- Modify: `src/server/compose-build.ts` (après `buildReplyContext`, ~l.117)
- Test: `src/server/compose-build.test.ts`

**Interfaces:**

- Consumes: `sanitizeComposeHtml` (Task 1 : `blockquote` conservé), `prefixSubject` (privé, même fichier), types `AppMessage`, `AppAttachment`, `MailAddress` de `src/server/mail-types.ts`.
- Produces:

```ts
export interface ForwardLabels {
  forwarded: string // "Message transféré"
  from: string // "De"
  date: string // "Date"
  subject: string // "Objet"
  to: string // "À"
  cc: string // "Cc"
}

export interface ForwardContext {
  subject: string
  quotedHtml: string
  attachments: AppAttachment[]
}

export function buildForwardContext(
  message: AppMessage,
  threadSubject: string,
  labels: ForwardLabels,
  locale: string
): ForwardContext
```

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/server/compose-build.test.ts` (la factory `msg()` existe déjà en tête de fichier), ajouter l'import `buildForwardContext` et un nouveau `describe` :

```ts
describe("buildForwardContext", () => {
  const labels = {
    forwarded: "Message transféré",
    from: "De",
    date: "Date",
    subject: "Objet",
    to: "À",
    cc: "Cc",
  }

  it("génère l'en-tête de transfert complet (Fwd:, De, Date, Objet, À, Cc)", () => {
    const ctx = buildForwardContext(msg(), "Sujet", labels, "fr-FR")
    expect(ctx.subject).toBe("Fwd: Sujet")
    expect(ctx.quotedHtml).toContain("Message transféré")
    expect(ctx.quotedHtml).toContain("De : Alice &lt;alice@x.fr&gt;")
    expect(ctx.quotedHtml).toContain("Objet : Sujet")
    expect(ctx.quotedHtml).toContain("À : Moi &lt;me@x.fr&gt;")
    expect(ctx.quotedHtml).toContain("Cc : Bob &lt;bob@x.fr&gt;")
    expect(ctx.quotedHtml).toContain("2026") // date absolue localisée
    expect(ctx.quotedHtml).toContain("<blockquote>")
    expect(ctx.quotedHtml).toContain("corps")
  })

  it("omet la ligne Cc quand l'original n'en a pas", () => {
    const ctx = buildForwardContext(msg({ cc: [] }), "Sujet", labels, "fr-FR")
    expect(ctx.quotedHtml).not.toContain("Cc :")
  })

  it("ne double pas le préfixe Fwd: déjà présent", () => {
    const ctx = buildForwardContext(msg(), "Fwd: Sujet", labels, "fr-FR")
    expect(ctx.subject).toBe("Fwd: Sujet")
  })

  it("échappe le HTML hostile des champs du message (B1)", () => {
    const evil = msg({
      from: [{ name: '<img src=x onerror="alert(1)">', email: "e@x.fr" }],
      subject: "</p><script>x()</script>",
    })
    const ctx = buildForwardContext(evil, "Sujet", labels, "fr-FR")
    expect(ctx.quotedHtml).not.toContain("<img")
    expect(ctx.quotedHtml).not.toContain("onerror")
    expect(ctx.quotedHtml).not.toContain("<script")
  })

  it("sanitise le corps HTML original (B1)", () => {
    const evil = msg({ htmlBody: '<p>ok</p><img src=x onerror="alert(1)">' })
    const ctx = buildForwardContext(evil, "Sujet", labels, "fr-FR")
    expect(ctx.quotedHtml).not.toContain("onerror")
    expect(ctx.quotedHtml).toContain("ok")
  })

  it("repli textBody échappé quand pas de corps HTML", () => {
    const ctx = buildForwardContext(
      msg({ htmlBody: "", textBody: "ligne1\nligne2 <tag>" }),
      "Sujet",
      labels,
      "fr-FR"
    )
    expect(ctx.quotedHtml).toContain("ligne1<br>ligne2 &lt;tag&gt;")
  })

  it("transmet les pièces jointes de l'original telles quelles", () => {
    const atts = [
      { blobId: "b1", name: "rapport.pdf", type: "application/pdf", size: 5 },
    ]
    const ctx = buildForwardContext(
      msg({ attachments: atts }),
      "Sujet",
      labels,
      "fr-FR"
    )
    expect(ctx.attachments).toEqual(atts)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/server/compose-build.test.ts`
Expected: FAIL — `buildForwardContext` n'existe pas.

- [ ] **Step 3: Implémentation**

Dans `src/server/compose-build.ts`, ajouter `AppMessage`/`AppAttachment` à l'import de `./mail-types`, puis après `buildReplyContext` :

```ts
// Échappe une valeur non fiable avant interpolation dans le HTML du composer.
// Requis pour la sécurité (nom d'expéditeur hostile) ET la correction : les
// adresses "Nom <a@b>" seraient sinon avalées comme balises par DOMPurify.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export interface ForwardLabels {
  forwarded: string
  from: string
  date: string
  subject: string
  to: string
  cc: string
}

export interface ForwardContext {
  subject: string
  quotedHtml: string
  attachments: AppAttachment[]
}

// Contexte de transfert d'UN message (issue #79) : bloc d'en-tête + corps cité +
// pièces jointes de l'original. Libellés injectés (i18n en couche UI, fonction pure).
// quotedHtml passe TOUJOURS par sanitizeComposeHtml (B1) ; champs interpolés échappés.
export function buildForwardContext(
  message: AppMessage,
  threadSubject: string,
  labels: ForwardLabels,
  locale: string
): ForwardContext {
  const addr = (a: MailAddress) =>
    a.name ? `${a.name} <${a.email}>` : a.email
  const list = (as: MailAddress[]) => as.map(addr).join(", ")
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(message.receivedAt))

  const lines = [
    `---------- ${escapeHtml(labels.forwarded)} ----------`,
    `${escapeHtml(labels.from)} : ${escapeHtml(list(message.from))}`,
    `${escapeHtml(labels.date)} : ${escapeHtml(date)}`,
    `${escapeHtml(labels.subject)} : ${escapeHtml(message.subject)}`,
    `${escapeHtml(labels.to)} : ${escapeHtml(list(message.to))}`,
  ]
  if (message.cc.length > 0) {
    lines.push(`${escapeHtml(labels.cc)} : ${escapeHtml(list(message.cc))}`)
  }

  const body = message.htmlBody
    ? message.htmlBody
    : `<p>${escapeHtml(message.textBody).replace(/\n/g, "<br>")}</p>`

  const quotedHtml = sanitizeComposeHtml(
    `<p><br></p><p>${lines.join("<br>")}</p><blockquote>${body}</blockquote>`
  )

  return {
    subject: prefixSubject(threadSubject, "Fwd"),
    quotedHtml,
    attachments: message.attachments,
  }
}
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `bun run test -- src/server/compose-build.test.ts`
Expected: PASS. Si l'assertion `ligne1<br>ligne2` échoue parce que DOMPurify normalise `<br>` en `<br />`, assouplir l'assertion en deux `toContain("ligne1")` / `toContain("ligne2 &lt;tag&gt;")` — le comportement (échappement + saut de ligne) prime sur la forme exacte.

- [ ] **Step 5: Commit**

```bash
git add src/server/compose-build.ts src/server/compose-build.test.ts
git commit -m "feat(compose): add buildForwardContext with forwarded-message header"
```

---

### Task 3: Chaîne d'envoi serveur — schéma Zod durci + `attachments` dans `Email/set`

**Files:**

- Modify: `src/server/compose-build.ts:147-216` (`SendBody`, `buildSendMethodCalls`)
- Modify: `src/server/mail-actions.ts:844-940` (`attachmentSchema`, `sendMailSchema`, `sendMailFn`)
- Test: `src/server/compose-build.test.ts`, `src/server/mail-actions.test.ts:798+`

**Interfaces:**

- Consumes: `isCleanHeaderValue` (`compose-build.ts:6`), `AppAttachment` (`mail-types.ts`), fixture `base` du describe `sendMailSchema` (`mail-actions.test.ts:799-807`).
- Produces: `SendBody` gagne `attachments: AppAttachment[]` (champ **requis**) ; `sendMailSchema` gagne `attachments` (défaut `[]`) ; le draft JMAP porte `attachments[{blobId,type,name,disposition:"attachment"}]` quand non vide.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/server/mail-actions.test.ts`, à la fin du `describe("sendMailSchema")` (fixture `base` existante l.799) :

```ts
const att = {
  blobId: "G-abc_123",
  name: "rapport.pdf",
  type: "application/pdf",
  size: 1024,
}

it("attachments : accepte une pièce valide et vaut [] par défaut", () => {
  expect(() =>
    sendMailSchema.parse({ ...base, attachments: [att] })
  ).not.toThrow()
  expect(sendMailSchema.parse(base).attachments).toEqual([])
})

it("attachments : rejette un name avec CRLF (F1, injection d'en-tête MIME)", () => {
  expect(() =>
    sendMailSchema.parse({
      ...base,
      attachments: [{ ...att, name: "a.pdf\r\nX-Evil: 1" }],
    })
  ).toThrow()
})

it("attachments : rejette un type hors forme type/subtype (F1)", () => {
  for (const type of ["texthtml", "text/html\r\nX: 1", "text/html; charset=x"]) {
    expect(() =>
      sendMailSchema.parse({ ...base, attachments: [{ ...att, type }] })
    ).toThrow()
  }
})

it("attachments : rejette un blobId hors alphabet sûr (F1)", () => {
  expect(() =>
    sendMailSchema.parse({ ...base, attachments: [{ ...att, blobId: 'a"b c' }] })
  ).toThrow()
})

it("attachments : rejette plus de 50 pièces", () => {
  const many = Array.from({ length: 51 }, (_, i) => ({
    ...att,
    blobId: `b${i}`,
  }))
  expect(() =>
    sendMailSchema.parse({ ...base, attachments: many })
  ).toThrow()
})
```

Dans `src/server/compose-build.test.ts`, dans le `describe` de `buildSendMethodCalls` (repérer la fixture `SendBody` existante et lui ajouter `attachments: []`), ajouter :

```ts
it("ajoute attachments[] (disposition attachment, sans size) quand non vide", () => {
  const withAtt: SendBody = {
    ...bodyFixture, // la fixture SendBody du describe, complétée de attachments: []
    attachments: [
      { blobId: "b1", name: "f.pdf", type: "application/pdf", size: 10 },
    ],
  }
  const calls = buildSendMethodCalls("acc", withAtt, ctxFixture)
  const draft = (calls[0][1] as { create: Record<string, Record<string, unknown>> })
    .create.draft
  expect(draft.attachments).toEqual([
    { blobId: "b1", type: "application/pdf", name: "f.pdf", disposition: "attachment" },
  ])
})

it("pas de clé attachments quand la liste est vide", () => {
  const calls = buildSendMethodCalls("acc", bodyFixture, ctxFixture)
  const draft = (calls[0][1] as { create: Record<string, Record<string, unknown>> })
    .create.draft
  expect(draft.attachments).toBeUndefined()
})
```

(Adapter `bodyFixture`/`ctxFixture` aux noms réels de la fixture du describe existant.)

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/server/compose-build.test.ts src/server/mail-actions.test.ts`
Expected: FAIL — `attachments` inconnu de `SendBody` (erreur TS) et absent du schéma.

- [ ] **Step 3: Implémentation**

`src/server/compose-build.ts` — étendre `SendBody` et le builder :

```ts
export interface SendBody {
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  html: string
  text: string
  inReplyTo?: string
  references: string[]
  attachments: AppAttachment[]
}
```

Dans `buildSendMethodCalls`, après le bloc `if (body.references.length > 0) …` :

```ts
// Transfert (#79) : blobs existants du compte référencés tels quels (RFC 8621,
// propriété de commodité). size jamais transmis — Stalwart le recalcule (F1/F2).
if (body.attachments.length > 0) {
  draft.attachments = body.attachments.map((a) => ({
    blobId: a.blobId,
    type: a.type,
    name: a.name,
    disposition: "attachment",
  }))
}
```

`src/server/mail-actions.ts` — après `messageId` (l.~857) :

```ts
// F1 (spec transfert) : name/type finissent dans les en-têtes MIME de la part.
// Sans re-traitement serveur en aval, CE schéma est le contrôle autoritaire
// anti-CRLF, au même titre que headerLine pour le sujet.
const attachmentSchema = z.object({
  blobId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().max(255).refine(isCleanHeaderValue, "name: caractère interdit"),
  type: z
    .string()
    .max(127)
    .regex(/^[\w.+-]+\/[\w.+-]+$/),
  size: z.number().int().nonnegative(),
})
```

Dans `sendMailSchema`, après `references` :

```ts
attachments: z.array(attachmentSchema).max(50).default([]),
```

Dans le handler de `sendMailFn`, compléter le `SendBody` :

```ts
const body: SendBody = {
  to: data.to,
  cc: data.cc,
  bcc: data.bcc,
  subject: data.subject,
  html,
  text,
  inReplyTo: data.inReplyTo,
  references: data.references,
  attachments: data.attachments,
}
```

Mettre à jour **toutes** les fixtures `SendBody` existantes de `compose-build.test.ts` avec `attachments: []` (le champ est requis — `bun run typecheck` les liste).

- [ ] **Step 4: Vérifier que tout passe**

Run: `bun run test -- src/server/compose-build.test.ts src/server/mail-actions.test.ts && bun run typecheck`
Expected: PASS, typecheck propre.

- [ ] **Step 5: Commit**

```bash
git add src/server/compose-build.ts src/server/compose-build.test.ts src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(send): carry forwarded attachments by blobId with hardened Zod schema"
```

---

### Task 4: `ComposerDraft.attachments` + transmission par `useComposer`

**Files:**

- Modify: `src/components/mail/use-composer.ts`
- Modify: `src/routes/mail/$folder.tsx:~123` (littéral `initial` du `Composer`)
- Test: `src/components/mail/use-composer.test.tsx` (+ fixtures `ComposerDraft` dans `composer.test.tsx` et `quick-reply.test.tsx` si typecheck l'exige)

**Interfaces:**

- Consumes: `AppAttachment` (`src/server/mail-types.ts`), `sendMailFn` (Task 3 : accepte `attachments`).
- Produces: `ComposerDraft` gagne `attachments: AppAttachment[]` (requis) ; `useComposer.send` transmet `draft.attachments` à `sendMailFn`.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `src/components/mail/use-composer.test.tsx`, repérer le test existant qui vérifie l'appel `sendMailFn` (mock) et ajouter :

```ts
it("transmet les attachments du brouillon à sendMailFn", async () => {
  const atts = [
    { blobId: "b1", name: "f.pdf", type: "application/pdf", size: 10 },
  ]
  // draftFixture : reprendre le brouillon valide du test d'envoi existant
  await act(() => result.current.send({ ...draftFixture, attachments: atts }))
  expect(sendMailFn).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ attachments: atts }),
    })
  )
})
```

(Reprendre le harnais `renderHook`/mocks du fichier — les tests d'envoi existants montrent le pattern exact.)

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/components/mail/use-composer.test.tsx`
Expected: FAIL — `attachments` absent de l'appel.

- [ ] **Step 3: Implémentation**

`src/components/mail/use-composer.ts` :

```ts
import type { AppAttachment } from "../../server/mail-types"

export interface ComposerDraft {
  mode: ComposeMode
  to: string
  cc: string
  bcc: string
  subject: string
  html: string
  inReplyTo?: string
  references: string[]
  attachments: AppAttachment[]
}
```

Dans `send`, ajouter au payload `sendMailFn` :

```ts
attachments: draft.attachments,
```

`src/routes/mail/$folder.tsx` — compléter le littéral `initial` du `Composer` :

```ts
initial={{
  mode: "compose",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  html: "",
  references: [],
  attachments: [],
}}
```

Compléter avec `attachments: []` tout littéral `ComposerDraft` que `bun run typecheck` signale (fixtures de `composer.test.tsx`, `use-composer.test.tsx`, `quick-reply.tsx` provisoirement — ce dernier est réécrit en Task 6).

- [ ] **Step 4: Vérifier que tout passe**

Run: `bun run typecheck && bun run test -- src/components/mail/use-composer.test.tsx src/components/mail/composer.test.tsx src/components/mail/quick-reply.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/use-composer.ts src/components/mail/use-composer.test.tsx src/routes/mail/\$folder.tsx src/components/mail/composer.test.tsx src/components/mail/quick-reply.tsx src/components/mail/quick-reply.test.tsx
git commit -m "feat(composer): add attachments to ComposerDraft and send payload"
```

---

### Task 5: Clés i18n + hook `useQuickReplyDraft`

**Files:**

- Modify: `src/i18n/resources.ts:282-310` (bloc `compose`)
- Create: `src/components/mail/use-quick-reply-draft.ts`
- Test: `src/components/mail/use-quick-reply-draft.test.tsx`

**Interfaces:**

- Consumes: `buildReplyContext`, `buildForwardContext`, `ForwardLabels` (Task 2), `ComposerDraft` (Task 4), `AppThreadDetail`, `AppMessage`, `MailAddress`.
- Produces:

```ts
export interface UseQuickReplyDraft {
  draft: ComposerDraft | null
  openReply: (mode: "reply" | "replyAll") => void
  openForward: (message: AppMessage) => void
  patch: (p: Partial<ComposerDraft>) => void
  close: () => void
}

export function useQuickReplyDraft(
  detail: AppThreadDetail | undefined,
  selfEmail: string
): UseQuickReplyDraft
```

- [ ] **Step 1: Ajouter les clés i18n**

Dans `src/i18n/resources.ts`, bloc `mail.compose` (après `noRecipient`) :

```ts
fwdForwarded: "Message transféré",
fwdFrom: "De",
fwdDate: "Date",
fwdSubject: "Objet",
fwdTo: "À",
fwdCc: "Cc",
removeAttachment: "Retirer la pièce jointe {{name}}",
```

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `src/components/mail/use-quick-reply-draft.test.tsx` :

```tsx
import { describe, expect, it, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useQuickReplyDraft } from "./use-quick-reply-draft"
import type { AppThreadDetail } from "../../server/mail-types"

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
      messageId: "<m1@host>",
      from: [{ name: "Alice", email: "alice@x.fr" }],
      to: [{ name: "Moi", email: "me@x.fr" }],
      cc: [],
      subject: "Sujet",
      receivedAt: "2026-06-10T00:00:00Z",
      unread: false,
      hasAttachment: true,
      textBody: "corps",
      htmlBody: "<p>corps</p>",
      attachments: [
        { blobId: "b1", name: "f.pdf", type: "application/pdf", size: 10 },
      ],
    },
  ],
  emailIds: ["m1"],
  starred: false,
  unread: false,
}

describe("useQuickReplyDraft", () => {
  it("openReply : brouillon reply pré-rempli (Re:, destinataire, threading)", () => {
    const { result } = renderHook(() => useQuickReplyDraft(detail, "me@x.fr"))
    act(() => result.current.openReply("reply"))
    expect(result.current.draft).toMatchObject({
      mode: "reply",
      to: "Alice <alice@x.fr>",
      subject: "Re: Sujet",
      inReplyTo: "<m1@host>",
      attachments: [],
    })
  })

  it("openForward : brouillon forward (Fwd:, À vide, en-tête cité, PJ reprises)", () => {
    const { result } = renderHook(() => useQuickReplyDraft(detail, "me@x.fr"))
    act(() => result.current.openForward(detail.messages[0]))
    expect(result.current.draft).toMatchObject({
      mode: "forward",
      to: "",
      subject: "Fwd: Sujet",
      references: [],
      attachments: detail.messages[0].attachments,
    })
    // Libellés = clés i18n (t mocké en identité)
    expect(result.current.draft?.html).toContain("mail.compose.fwdForwarded")
    expect(result.current.draft?.html).toContain("alice@x.fr")
    expect(result.current.draft?.inReplyTo).toBeUndefined()
  })

  it("patch : retire une pièce jointe du brouillon", () => {
    const { result } = renderHook(() => useQuickReplyDraft(detail, "me@x.fr"))
    act(() => result.current.openForward(detail.messages[0]))
    act(() => result.current.patch({ attachments: [] }))
    expect(result.current.draft?.attachments).toEqual([])
  })

  it("close : réinitialise le brouillon ; openReply sans detail = no-op", () => {
    const { result } = renderHook(() => useQuickReplyDraft(detail, "me@x.fr"))
    act(() => result.current.openReply("reply"))
    act(() => result.current.close())
    expect(result.current.draft).toBeNull()
    const empty = renderHook(() => useQuickReplyDraft(undefined, "me@x.fr"))
    act(() => empty.result.current.openReply("reply"))
    expect(empty.result.current.draft).toBeNull()
  })
})
```

- [ ] **Step 3: Vérifier l'échec**

Run: `bun run test -- src/components/mail/use-quick-reply-draft.test.tsx`
Expected: FAIL — le module n'existe pas.

- [ ] **Step 4: Implémentation**

Créer `src/components/mail/use-quick-reply-draft.ts` :

```ts
import { useState } from "react"
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

  function openReply(mode: "reply" | "replyAll"): void {
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
  }

  function openForward(message: AppMessage): void {
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
  }

  const patch = (p: Partial<ComposerDraft>) =>
    setDraft((d) => (d ? { ...d, ...p } : d))

  return { draft, openReply, openForward, patch, close: () => setDraft(null) }
}
```

Note : en Task 5, `buildReplyContext` accepte encore `ComposeMode` large — l'appel avec `"reply" | "replyAll"` est déjà compatible ; le rétrécissement du paramètre arrive en Task 8.

- [ ] **Step 5: Vérifier que tout passe**

Run: `bun run test -- src/components/mail/use-quick-reply-draft.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/resources.ts src/components/mail/use-quick-reply-draft.ts src/components/mail/use-quick-reply-draft.test.tsx
git commit -m "feat(reader): add useQuickReplyDraft hook and forward i18n labels"
```

---

### Task 6: `QuickReply` présentationnel (puces PJ, sans bouton Transférer) + câblage `Reader` + CSS

`QuickReply` perd son état interne (props `draft` + callbacks), gagne la rangée de puces retirables, perd le bouton « Transférer » de la barre. `Reader` héberge le hook. Une seule tâche : séparer casserait le typecheck du pre-commit (les props de `QuickReply` changent).

**Files:**

- Modify: `src/components/mail/quick-reply.tsx` (réécriture)
- Modify: `src/components/mail/reader.tsx:1-45` (imports/props) et `:174-194` (câblage)
- Modify: `src/components/mail/mail.css` (~l.744-781, styles puces)
- Test: `src/components/mail/quick-reply.test.tsx` (réécriture avec harnais hook)

**Interfaces:**

- Consumes: `useQuickReplyDraft` (Task 5), `ComposerDraft` (Task 4), clé `mail.compose.removeAttachment` (Task 5), classes CSS `.attach-row`/`.attach` (`mail.css:744-752`).
- Produces:

```ts
export interface QuickReplyProps {
  draft: ComposerDraft | null
  sending: boolean
  onOpenReply: (mode: "reply" | "replyAll") => void
  onPatch: (patch: Partial<ComposerDraft>) => void
  onClose: () => void
  onSend: (draft: ComposerDraft) => boolean | void | Promise<boolean | void>
}
```

- [ ] **Step 1: Réécrire les tests (harnais = hook + composant)**

Remplacer le contenu de `src/components/mail/quick-reply.test.tsx` : conserver le mock `react-i18next` (le compléter avec `i18n: { language: "fr-FR" }`) et les fixtures `detail`/`detailWithMessageId`/`detailWithCc` ; remplacer chaque rendu direct de `<QuickReply detail=… selfEmail=… />` par le harnais :

```tsx
import { useQuickReplyDraft } from "./use-quick-reply-draft"
import type { AppThreadDetail } from "../../server/mail-types"
import type { ComposerDraft } from "./use-composer"

function Harness({
  detail,
  onSend,
  sending = false,
}: {
  detail: AppThreadDetail
  onSend: (d: ComposerDraft) => boolean | void | Promise<boolean | void>
  sending?: boolean
}) {
  const qr = useQuickReplyDraft(detail, "me@x.fr")
  return (
    <QuickReply
      draft={qr.draft}
      sending={sending}
      onOpenReply={qr.openReply}
      onPatch={qr.patch}
      onClose={qr.close}
      onSend={onSend}
    />
  )
}
```

Les tests reply/replyAll existants gardent leurs assertions (mêmes clics, mêmes brouillons attendus — avec `attachments: []` en plus dans les `expect.objectContaining`). Remplacer le test forward existant par :

```tsx
it("n'affiche plus de bouton Transférer dans la barre", () => {
  render(<Harness detail={detail} onSend={() => {}} />)
  expect(
    screen.queryByRole("button", { name: "mail.compose.forward" })
  ).not.toBeInTheDocument()
})
```

Ajouter les tests des puces (le harnais expose le forward via le hook) :

```tsx
function ForwardHarness({ detail }: { detail: AppThreadDetail }) {
  const qr = useQuickReplyDraft(detail, "me@x.fr")
  return (
    <>
      <button onClick={() => qr.openForward(detail.messages[0])}>fwd</button>
      <QuickReply
        draft={qr.draft}
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

it("forward : affiche les puces de pièces jointes reprises", () => {
  render(<ForwardHarness detail={detailWithAttachment} />)
  fireEvent.click(screen.getByText("fwd"))
  expect(screen.getByText("f.pdf")).toBeInTheDocument()
})

it("forward : retire une pièce jointe via son bouton ×", () => {
  render(<ForwardHarness detail={detailWithAttachment} />)
  fireEvent.click(screen.getByText("fwd"))
  fireEvent.click(
    screen.getByRole("button", { name: "mail.compose.removeAttachment" })
  )
  expect(screen.queryByText("f.pdf")).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/components/mail/quick-reply.test.tsx`
Expected: FAIL — props inexistantes.

- [ ] **Step 3: Réécrire `QuickReply`**

Remplacer `src/components/mail/quick-reply.tsx` :

```tsx
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { RteEditor } from "./rte-editor"
import type { ComposerDraft } from "./use-composer"

export interface QuickReplyProps {
  draft: ComposerDraft | null
  sending: boolean
  onOpenReply: (mode: "reply" | "replyAll") => void
  onPatch: (patch: Partial<ComposerDraft>) => void
  onClose: () => void
  onSend: (draft: ComposerDraft) => boolean | void | Promise<boolean | void>
}

// Présentationnel : l'état du brouillon vit dans useQuickReplyDraft (Reader).
// Le transfert n'a plus de bouton ici — il est par-message (MessageItem, #79).
export function QuickReply({
  draft,
  sending,
  onOpenReply,
  onPatch,
  onClose,
  onSend,
}: QuickReplyProps) {
  const { t } = useTranslation()
  const [showFormat, setShowFormat] = useState(false)

  if (!draft) {
    return (
      <div className="reply-bar">
        <button
          type="button"
          className="reply-bar-main"
          aria-label={t("mail.compose.reply")}
          title={t("mail.compose.reply")}
          onClick={() => onOpenReply("reply")}
        >
          <Icon name="reply" size={16} /> {t("mail.compose.reply")}
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.replyAll")}
          title={t("mail.compose.replyAll")}
          onClick={() => onOpenReply("replyAll")}
        >
          <Icon name="replyAll" size={17} />
        </button>
      </div>
    )
  }

  const modeIcon =
    draft.mode === "forward"
      ? "forward"
      : draft.mode === "replyAll"
        ? "replyAll"
        : "reply"
  const modeLabel =
    draft.mode === "forward"
      ? t("mail.compose.forward")
      : draft.mode === "replyAll"
        ? t("mail.compose.replyAll")
        : t("mail.compose.reply")

  return (
    <div className="quick-reply">
      <div className="qr-head">
        <Icon name={modeIcon} size={15} />
        <span>{modeLabel}</span>
        <input
          className="qr-to"
          aria-label={t("mail.compose.to")}
          value={draft.to}
          onChange={(e) => onPatch({ to: e.target.value })}
        />
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.close")}
          title={t("mail.compose.close")}
          onClick={onClose}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      {draft.attachments.length > 0 && (
        <div className="attach-row">
          {draft.attachments.map((a) => (
            <div key={a.blobId} className="attach">
              <div className="fi">
                {(a.type.split("/")[1] ?? t("mail.reader.file")).slice(0, 4)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="fn">{a.name}</div>
                <div className="fs">
                  {Math.ceil(a.size / 1024)} {t("mail.reader.sizeKB")}
                </div>
              </div>
              <button
                type="button"
                className="attach-x"
                aria-label={t("mail.compose.removeAttachment", {
                  name: a.name,
                })}
                title={t("mail.compose.removeAttachment", { name: a.name })}
                onClick={() =>
                  onPatch({
                    attachments: draft.attachments.filter(
                      (x) => x.blobId !== a.blobId
                    ),
                  })
                }
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <RteEditor
        value={draft.html}
        onChange={(html) => onPatch({ html })}
        ariaLabel={t("mail.compose.body")}
        showToolbar={showFormat}
      />
      <div className="composer-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={sending}
          aria-label={t("mail.compose.send")}
          onClick={async () => {
            const ok = await onSend(draft)
            if (ok) onClose()
          }}
        >
          <Icon name="send" size={16} /> {t("mail.compose.send")}
        </button>
        <button
          type="button"
          className={showFormat ? "icon-btn on" : "icon-btn"}
          aria-label={t("mail.compose.formatting")}
          title={t("mail.compose.formatting")}
          aria-pressed={showFormat}
          onClick={() => setShowFormat((v) => !v)}
        >
          <span className="aa-glyph">Aa</span>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Câbler `Reader`**

Dans `src/components/mail/reader.tsx` : importer `useQuickReplyDraft`, instancier après les hooks existants du composant :

```ts
const quickReply = useQuickReplyDraft(detail, selfEmail ?? "")
```

Remplacer le bloc `<QuickReply …>` (l.186-192) :

```tsx
{onSend && (
  <QuickReply
    draft={quickReply.draft}
    sending={sending ?? false}
    onOpenReply={quickReply.openReply}
    onPatch={quickReply.patch}
    onClose={quickReply.close}
    onSend={onSend}
  />
)}
```

- [ ] **Step 5: Styles des puces**

Dans `src/components/mail/mail.css`, à côté des styles `.quick-reply` (~l.777) :

```css
.quick-reply .attach-row { padding: 10px 14px 0; }
.attach-x { border: none; background: none; color: var(--muted); cursor: pointer; padding: 4px; border-radius: 6px; flex: none; display: grid; place-items: center; }
.attach-x:hover { background: var(--hover); color: var(--ink); }
```

- [ ] **Step 6: Vérifier que tout passe**

Run: `bun run test -- src/components/mail/quick-reply.test.tsx && bun run typecheck`
Expected: PASS (le typecheck valide aussi le câblage Reader).

- [ ] **Step 7: Commit**

```bash
git add src/components/mail/quick-reply.tsx src/components/mail/quick-reply.test.tsx src/components/mail/reader.tsx src/components/mail/mail.css
git commit -m "refactor(reader): lift quick-reply draft state, add removable attachment chips, drop thread-level forward button"
```

---

### Task 7: Bouton ↪ « Transférer » par message dans `MessageItem`

**Files:**

- Modify: `src/components/mail/message-item.tsx:53-111`
- Modify: `src/components/mail/reader.tsx:175-183` (prop `onForward`)
- Test: `src/components/mail/message-item.test.tsx`

**Interfaces:**

- Consumes: `openForward` du hook (Task 5, via Reader), icône `forward` (`mail-icons`, déjà utilisée), clé `mail.compose.forward` (existante).
- Produces: `MessageItem` accepte `onForward?: (message: AppMessage) => void`.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/components/mail/message-item.test.tsx` (mock i18n et factory `msg()` existants) :

```tsx
it("affiche le bouton Transférer quand le message est ouvert et notifie onForward", () => {
  const onForward = vi.fn()
  const message = msg()
  wrap(<MessageItem message={message} defaultOpen onForward={onForward} />)
  fireEvent.click(
    screen.getByRole("button", { name: "mail.compose.forward" })
  )
  expect(onForward).toHaveBeenCalledWith(message)
})

it("le clic sur Transférer ne replie pas le message", () => {
  wrap(<MessageItem message={msg()} defaultOpen onForward={() => {}} />)
  fireEvent.click(
    screen.getByRole("button", { name: "mail.compose.forward" })
  )
  // le corps reste visible → le toggle du header n'a pas été déclenché
  expect(screen.getByLabelText("mail.compose.forward")).toBeInTheDocument()
  expect(document.querySelector(".msg.collapsed")).toBeNull()
})

it("pas de bouton Transférer quand le message est replié ou sans onForward", () => {
  const { rerender } = wrap(
    <MessageItem message={msg()} onForward={() => {}} />
  )
  expect(
    screen.queryByRole("button", { name: "mail.compose.forward" })
  ).not.toBeInTheDocument()
  rerender(<MessageItem message={msg()} defaultOpen />)
  expect(
    screen.queryByRole("button", { name: "mail.compose.forward" })
  ).not.toBeInTheDocument()
})
```

(Adapter `wrap`/`rerender` au harnais du fichier.)

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/components/mail/message-item.test.tsx`
Expected: FAIL — bouton absent.

- [ ] **Step 3: Implémentation**

Dans `src/components/mail/message-item.tsx` : ajouter la prop et le bouton dans `.msg-head`, après `<div className="when">…</div>` :

```tsx
export function MessageItem({
  message,
  defaultOpen = false,
  onShowOnce,
  onHideImages,
  onTrustSender,
  onUntrustSender,
  onForward,
}: {
  message: AppMessage
  defaultOpen?: boolean
  onShowOnce?: (emailId: string) => void
  onHideImages?: (emailId: string) => void
  onTrustSender?: (sender: string) => void
  onUntrustSender?: (sender: string) => void
  onForward?: (message: AppMessage) => void
}) {
```

```tsx
        <div className="when">{formatThreadDate(message.receivedAt)}</div>
        {open && onForward && (
          <button
            type="button"
            className="icon-btn sm"
            aria-label={t("mail.compose.forward")}
            title={t("mail.compose.forward")}
            onClick={(e) => {
              // Le header parent est cliquable (toggle repli) : on isole le bouton.
              e.stopPropagation()
              onForward(message)
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Icon name="forward" size={16} />
          </button>
        )}
```

Dans `src/components/mail/reader.tsx`, compléter le `<MessageItem …>` (l.175-183) :

```tsx
onForward={onSend ? quickReply.openForward : undefined}
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `bun run test -- src/components/mail/message-item.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/message-item.tsx src/components/mail/message-item.test.tsx src/components/mail/reader.tsx
git commit -m "feat(reader): per-message forward button in message header"
```

---

### Task 8: Rétrécir `buildReplyContext` à `"reply" | "replyAll"`

Plus aucun appelant ne passe `"forward"` (le hook appelle `buildForwardContext`). Le type garantit qu'on ne repasse plus par l'ancien chemin.

**Files:**

- Modify: `src/server/compose-build.ts:75-117`
- Test: `src/server/compose-build.test.ts`

**Interfaces:**

- Consumes: appels existants du hook (Task 5) — déjà typés `"reply" | "replyAll"`.
- Produces: `buildReplyContext(detail, mode: "reply" | "replyAll", selfEmail, lastMessageId?)`. `ComposeMode` reste inchangé (utilisé par `ComposerDraft.mode`).

- [ ] **Step 1: Adapter les tests**

Dans `src/server/compose-build.test.ts`, supprimer les deux tests forward de `buildReplyContext` (« forward : to et cc vides… » et « ne double pas le préfixe Fwd:… ») — leur couverture vit désormais dans le describe `buildForwardContext` (Task 2).

- [ ] **Step 2: Implémentation**

Dans `src/server/compose-build.ts` : signature et suppression de la branche :

```ts
// Construit le contexte de réponse depuis le dernier message du fil. Le transfert
// a son propre chemin (buildForwardContext, par-message — #79).
// quotedHtml passe TOUJOURS par sanitizeComposeHtml : le htmlBody d'origine est non fiable (B1).
export function buildReplyContext(
  detail: AppThreadDetail,
  mode: "reply" | "replyAll",
  selfEmail: string,
  lastMessageId?: string
): ReplyContext {
```

Supprimer intégralement le bloc :

```ts
if (mode === "forward") {
  return { ... }
}
```

- [ ] **Step 3: Vérifier que tout passe**

Run: `bun run test -- src/server/compose-build.test.ts && bun run typecheck`
Expected: PASS — le typecheck confirme qu'aucun appelant ne passe encore `"forward"`.

- [ ] **Step 4: Commit**

```bash
git add src/server/compose-build.ts src/server/compose-build.test.ts
git commit -m "refactor(compose): narrow buildReplyContext to reply modes only"
```

---

### Task 9: Vérification finale + note de spec

**Files:**

- Modify: `docs/superpowers/specs/2026-07-06-transfert-veritable-design.md` (note blockquote)

**Interfaces:**

- Consumes: l'ensemble des tâches précédentes.
- Produces: branche prête pour revue (code review + second passage security-reviewer).

- [ ] **Step 1: Suite complète**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS intégral (866 tests existants + nouveaux).

- [ ] **Step 2: Mettre la spec à jour (écart découvert en plan)**

Dans la section « Architecture › 1. Fonction pure » de la spec, remplacer la parenthèse « uniquement des balises déjà autorisées par `sanitizeComposeHtml` (`p`, `br`, `blockquote` servent déjà à la citation reply) » par :

```markdown
  (`p`, `br`, plus `blockquote` **ajouté à l'allowlist** au cours de
  l'implémentation — il n'y figurait pas et la citation reply perdait
  silencieusement sa balise ; balise inerte, sans attribut)
```

- [ ] **Step 3: Vérification manuelle (checklist)**

Avec `bun run dev` (nécessite le Stalwart de dev joignable) :

1. Ouvrir un fil avec pièces jointes → chaque message ouvert affiche ↪ dans son en-tête ; la barre du bas n'a plus « Transférer ».
2. Cliquer ↪ → éditeur inline : À vide, sujet `Fwd:`, bloc « ---------- Message transféré ---------- » avec De/Date/Objet/À, corps cité, puces PJ.
3. Retirer une puce → elle disparaît ; envoyer vers une adresse du serveur de dev → le destinataire reçoit l'en-tête de transfert et les PJ restantes.
4. Vérifier un message texte-seul (sans HTML) → corps repris en texte échappé.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-06-transfert-veritable-design.md
git commit -m "docs(specs): note blockquote allowlist addition discovered during planning"
```

- [ ] **Step 5: Revues de fin de branche**

Lancer le sous-agent `code-reviewer` (conventions + couverture) puis le sous-agent `security-reviewer` (second passage exigé par la spec : F1 en place, échappement, scoping blob). Traiter leurs retours avant d'ouvrir la PR (`superpowers:finishing-a-development-branch`).

---

## Auto-revue du plan

- **Couverture de la spec** : fonction pure (Task 2), UI par-message (Task 7), retrait bouton barre (Task 6), puces retirables (Task 6), chaîne d'envoi + Zod F1 (Task 3), `ComposerDraft` (Task 4), i18n (Task 5), hook remonté (Task 5/6), rétrécissement `buildReplyContext` (Task 8), tests sécurité schéma (Task 3), note F2/F3 : documentées dans la spec, pas de code requis. Test de non-régression « blobId étranger » : couvert au niveau contractuel par le mapping d'erreur existant (`parseSendResult` → `failed`, déjà testé) — le test d'intégration réel contre Stalwart est hors périmètre vitest, laissé à la checklist manuelle (Task 9).
- **Écart spec assumé** : ajout de `blockquote` à l'allowlist (Task 1) — la spec le croyait déjà autorisé ; Task 9 la met à jour.
- **Cohérence des types** : `ForwardLabels`/`ForwardContext` (Task 2) consommés tels quels en Task 5 ; `ComposerDraft.attachments` (Task 4) consommé en Tasks 5-6 ; `QuickReplyProps` (Task 6) aligné sur le harnais de test ; `onForward` (Task 7) aligné sur `openForward` (Task 5).
- **Ordre anti-casse typecheck** : le rétrécissement de `buildReplyContext` (Task 8) vient APRÈS la réécriture de `QuickReply` (Task 6) ; le changement de props `QuickReply` et le câblage `Reader` sont dans la même tâche (Task 6).
