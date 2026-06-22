# Plan 4c — Composer (rédaction & envoi) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'utilisateur de composer un nouveau message et de répondre / répondre à tous / transférer depuis un fil, avec envoi réel via JMAP `EmailSubmission`.

**Architecture:** Fonctions pures isolées (`compose-html.ts`, `compose-build.ts`) testées unitairement ; une server function `sendMailFn` (BFF) orchestre lecture (`Mailbox/get` + `Identity/get`) → sanitisation → construction du batch `Email/set` + `EmailSubmission/set` → parsing. Côté UI, un éditeur HTML minimal partagé (`RteEditor`) est embarqué dans un `Composer` flottant et dans une barre quick-reply du Reader, pilotés par un hook `useComposer` (mutation TanStack Query).

**Tech Stack:** TanStack Start (server functions), Zod (validation), `isomorphic-dompurify` (sanitisation HTML server+client), TanStack Query, react-i18next, Vitest + Testing Library.

## Global Constraints

- **Gestionnaire de paquets : Bun** uniquement (`bun install`, `bun run test`, `bun run lint`, `bun run typecheck`). Ne jamais éditer `bun.lock` à la main.
- **Aucun secret/token côté client** ; le navigateur ne parle jamais à Stalwart directement (tout via server functions).
- **Validation Zod** sur toute entrée de server function ; enums fermés résolus côté serveur. Aucune opération JMAP générique exposée.
- **i18n** : libellés en français via clés `t('...')`, jamais de texte en dur ; chaque clé `fr` a son miroir `en` (`DeepRecord<typeof fr>`).
- **Fonctions pures extraites et testées isolément** ; composants présentationnels (props injectées, pas de hooks de route dans le composant testé).
- **Sécurité (audit 4c, voir `docs/superpowers/reviews/2026-06-21-plan-4c-security-review.md`)** :
  - **B1** : tout HTML entrant dans le `RteEditor` (citation reply/forward, collage) est sanitisé avant injection ; le corps est re-sanitisé côté serveur à l'envoi (double barrière).
  - **B2** : sanitiseur = parseur DOM à allowlist (`isomorphic-dompurify`), **pas** de regex. Éléments : `b,i,strong,em,a,ul,ol,li,p,br`. Attributs : `href` sur `a` uniquement. URL : `^(https?|mailto):` après décodage ; query `mailto:` retirée.
  - **B3** : `subject` et display-names rejettent CR/LF/NUL ; `subject` ≤ 998 octets ; `references` ≤ 50 ; `inReplyTo`/`references` = Message-ID validés, passés via `header:In-Reply-To:asMessageIds` / `header:References:asMessageIds`.
  - **B4** : `to+cc+bcc` ≤ 100 ; `html` ≤ 256 Ko ; rate-limit d'envoi par compte.
  - **R1** : `from`/`mailFrom` dérivés exclusivement de `Identity/get` sur l'`accountId` de session ; le client ne transmet ni `from` ni `identityId`.
  - **R2** : `bcc` placé **uniquement** dans `envelope.rcptTo`, jamais dans les propriétés de l'`Email`.
  - **R5** : capability `urn:ietf:params:jmap:submission` ajoutée **uniquement** pour `sendMailFn`.
  - **R6** : erreurs JMAP/SMTP mappées en libellés i18n fixes ; détails en logs serveur (`console.error`), jamais propagés au client.

---

## File Structure

**Créés :**
- `src/lib/compose-html.ts` — `sanitizeComposeHtml`, `htmlToPlainText` (purs, isomorphes). **Hors `src/server/`** (P1) : importé à la fois par le serveur (`mail-actions`, `compose-build`) et le client (`rte-editor`) sans franchir la frontière BFF.
- `src/lib/compose-html.test.ts`
- `src/server/compose-build.ts` — `parseAddressList`, `buildReplyContext`, `pickSendIdentity`, `buildSendMethodCalls`, `parseSendResult` + types `ComposeMode`, `SendInput`, `SendResult`, `ReplyContext`, `SendIdentity` (purs, isomorphes)
- `src/server/compose-build.test.ts`
- `src/server/send-rate-limit.ts` — throttle d'envoi par compte (miroir de `login-rate-limit.ts`)
- `src/server/send-rate-limit.test.ts`
- `src/components/mail/rte-editor.tsx` — éditeur HTML minimal partagé
- `src/components/mail/rte-editor.test.tsx`
- `src/components/mail/use-composer.ts` — hook + mutation `sendMailFn`
- `src/components/mail/use-composer.test.tsx`
- `src/components/mail/composer.tsx` — Composer flottant présentationnel
- `src/components/mail/composer.test.tsx`
- `src/components/mail/quick-reply.tsx` — barre quick-reply du Reader
- `src/components/mail/quick-reply.test.tsx`

**Modifiés :**
- `src/server/jmap-user.ts` — paramètre `capabilities?` optionnel + `SUBMISSION_CAPABILITIES`
- `src/server/mail-actions.ts` — ajout `sendMailFn` + schéma Zod `sendMailSchema`
- `src/components/mail/reader.tsx` — intègre `quick-reply` (props reply)
- `src/components/mail/sidebar.tsx` — active le bouton « Nouveau message » (`onCompose`)
- `src/components/mail/index.ts` — exports des nouveaux composants/hook
- `src/routes/mail/$folder.tsx` — monte le `Composer`, câble `onCompose` + ouverture depuis le Reader
- `src/i18n/resources.ts` — clés `mail.compose.*` (fr + en)

---

## Task 1: Sanitiseur HTML (`sanitizeComposeHtml`, `htmlToPlainText`)

**Files:**
- Create: `src/lib/compose-html.ts` (hors `src/server/` — P1)
- Test: `src/lib/compose-html.test.ts`
- Modify: `package.json` (ajout `isomorphic-dompurify` via `bun add`)

**Interfaces:**
- Produces:
  - `sanitizeComposeHtml(html: string): string` — allowlist stricte (B2), isomorphe.
  - `htmlToPlainText(html: string): string` — alternative `text/plain`.

- [ ] **Step 1: Ajouter la dépendance**

```bash
bun add isomorphic-dompurify
bun audit   # R3 : la dépendance de sanitisation est soumise au scan
```

Expected : `isomorphic-dompurify` ajouté à `dependencies` dans `package.json`, `bun.lock` régénéré, `bun audit` sans vulnérabilité bloquante.

- [ ] **Step 2: Write the failing test**

`src/lib/compose-html.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { sanitizeComposeHtml, htmlToPlainText } from "./compose-html"

describe("sanitizeComposeHtml", () => {
  it("garde les éléments de l'allowlist", () => {
    const html = "<p>Bonjour <b>Marie</b> et <em>merci</em></p><ul><li>un</li></ul>"
    expect(sanitizeComposeHtml(html)).toBe(html)
  })

  it("retire les balises hors allowlist (script, style, div)", () => {
    expect(sanitizeComposeHtml("<div>x<script>alert(1)</script></div>")).toBe("x")
    expect(sanitizeComposeHtml("<style>body{}</style><p>ok</p>")).toBe("<p>ok</p>")
  })

  it("retire les attributs hors allowlist (onerror, style, class, id)", () => {
    expect(sanitizeComposeHtml('<img src=x onerror="alert(1)">')).toBe("")
    expect(sanitizeComposeHtml('<p style="x" class="y" id="z">t</p>')).toBe("<p>t</p>")
  })

  it("garde href http(s) et mailto sur a, retire le reste", () => {
    expect(sanitizeComposeHtml('<a href="https://x.fr">l</a>')).toBe('<a href="https://x.fr">l</a>')
    expect(sanitizeComposeHtml('<a href="mailto:a@b.fr">l</a>')).toBe('<a href="mailto:a@b.fr">l</a>')
  })

  it("neutralise les schémas javascript: et data:", () => {
    expect(sanitizeComposeHtml('<a href="javascript:alert(1)">l</a>')).toBe("<a>l</a>")
    expect(sanitizeComposeHtml('<a href="data:text/html,x">l</a>')).toBe("<a>l</a>")
  })

  it("retire la query d'un mailto: (anti-injection d'en-têtes)", () => {
    expect(sanitizeComposeHtml('<a href="mailto:a@b.fr?bcc=evil@x.fr&body=spam">l</a>')).toBe(
      '<a href="mailto:a@b.fr">l</a>'
    )
  })

  it("retire la query mailto: même avec un seul paramètre (R-C)", () => {
    expect(sanitizeComposeHtml('<a href="mailto:a@b.fr?bcc=x@y.fr">l</a>')).toBe(
      '<a href="mailto:a@b.fr">l</a>'
    )
  })
})

describe("htmlToPlainText", () => {
  it("convertit les balises de bloc en sauts de ligne et strippe le reste", () => {
    expect(htmlToPlainText("<p>Bonjour</p><p>Merci</p>")).toBe("Bonjour\n\nMerci")
    expect(htmlToPlainText("ligne1<br>ligne2")).toBe("ligne1\nligne2")
  })

  it("décode les entités HTML", () => {
    expect(htmlToPlainText("<p>a &amp; b &lt; c</p>")).toBe("a & b < c")
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test src/lib/compose-html.test.ts`
Expected: FAIL (`Cannot find module './compose-html'`).

- [ ] **Step 4: Write minimal implementation**

> Note hook global (R-C) : `DOMPurify.addHook` est **global au process**. Le strip de
> query `mailto:` s'applique donc à toute sanitisation DOMPurify. C'est inoffensif
> (aucun autre code n'utilise `isomorphic-dompurify` aujourd'hui — `email-body.ts` est
> en regex best-effort). Si un futur appelant DOMPurify dépend d'un `mailto:?…`, scoper
> le hook. Le drapeau `hookInstalled` garantit une seule installation.

`src/lib/compose-html.ts` :

```ts
import DOMPurify from "isomorphic-dompurify"

// Allowlist HTML minimale du composer (audit 4c B2). Parseur DOM, pas de regex.
const ALLOWED_TAGS = ["b", "i", "strong", "em", "a", "ul", "ol", "li", "p", "br"]
const ALLOWED_ATTR = ["href"]

// Schémas d'URL autorisés sur href après décodage (B2). DOMPurify gère déjà le
// décodage/normalisation et bloque javascript:/data: hors de cette liste.
const ALLOWED_URI_REGEXP = /^(?:https?|mailto):/i

// Retire la query-string des mailto: (anti-injection d'en-têtes : mailto:x?bcc=…).
function stripMailtoQuery(node: Element): void {
  const href = node.getAttribute("href")
  if (href && /^mailto:/i.test(href)) {
    const q = href.indexOf("?")
    if (q !== -1) node.setAttribute("href", href.slice(0, q))
  }
}

let hookInstalled = false
function ensureHook(): void {
  if (hookInstalled) return
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") stripMailtoQuery(node as Element)
  })
  hookInstalled = true
}

// Sanitise le HTML produit/affiché par le RteEditor. Barrière autoritaire côté serveur
// (sendMailFn) et défense en profondeur côté client (injection de citation, B1).
export function sanitizeComposeHtml(html: string): string {
  ensureHook()
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
  })
}

// Alternative text/plain : bloc → saut de ligne, <br> → \n, entités décodées, balises retirées.
// R-A : sert UNIQUEMENT de corps text/plain (bodyValues.plain), jamais de valeur d'en-tête —
// aucun vecteur d'injection (Stalwart encode le corps). Décodage d'entités volontairement partiel.
// IMPORTANT (ordre) : sanitiser D'ABORD, car DOMPurify normalise les balises (ex. ajoute le
// </p> fermant manquant) ; remplacer les balises avant détruirait cette normalisation. Balises
// ouvrantes ET fermantes de bloc → \n (chaque <p>…</p> donne \n\n, réduit par \n{3,}→\n\n).
export function htmlToPlainText(html: string): string {
  const sanitized = sanitizeComposeHtml(html)
  const withBreaks = sanitized
    .replace(/<(p|div|li|ul|ol)[^>]*>/gi, "\n") // ouverture bloc → \n
    .replace(/<\/(p|div|li|ul|ol)>/gi, "\n") //    fermeture bloc → \n
    .replace(/<br\s*\/?>/gi, "\n")
  const stripped = withBreaks.replace(/<[^>]+>/g, "")
  const decoded = stripped
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
  return decoded.replace(/\n{3,}/g, "\n\n").trim()
}
```

> Note : si DOMPurify normalise différemment un cas du test (ex. sérialisation des
> attributs), ajuster l'assertion à la sortie réelle observée — l'invariant à tenir
> est : aucun élément/attribut/href hors allowlist ne survit.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test src/lib/compose-html.test.ts`
Expected: PASS (6 + 2 assertions).

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/lib/compose-html.ts src/lib/compose-html.test.ts
git commit -m "feat(4c): sanitizeComposeHtml + htmlToPlainText (allowlist DOMPurify)"
```

---

## Task 2: Parsing d'adresses (`parseAddressList`)

**Files:**
- Create: `src/server/compose-build.ts`
- Test: `src/server/compose-build.test.ts`

**Interfaces:**
- Consumes: `MailAddress` depuis `./mail-types`.
- Produces:
  - `parseAddressList(raw: string): { valid: MailAddress[]; invalid: string[] }`
  - `isCleanHeaderValue(s: string): boolean` — rejette CR/LF/NUL (B3), réutilisé par le schéma Zod.

- [ ] **Step 1: Write the failing test**

`src/server/compose-build.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { parseAddressList, isCleanHeaderValue } from "./compose-build"

describe("parseAddressList", () => {
  it("parse une adresse simple", () => {
    expect(parseAddressList("a@b.fr")).toEqual({
      valid: [{ name: "", email: "a@b.fr" }],
      invalid: [],
    })
  })

  it('parse "Nom <email>" séparés par des virgules', () => {
    expect(parseAddressList("Marie L <marie@x.fr>, paul@y.fr")).toEqual({
      valid: [
        { name: "Marie L", email: "marie@x.fr" },
        { name: "", email: "paul@y.fr" },
      ],
      invalid: [],
    })
  })

  it("sépare les adresses valides des invalides", () => {
    expect(parseAddressList("ok@x.fr, pas-une-adresse")).toEqual({
      valid: [{ name: "", email: "ok@x.fr" }],
      invalid: ["pas-une-adresse"],
    })
  })

  it("ignore les segments vides et espaces", () => {
    expect(parseAddressList("  a@b.fr , , ")).toEqual({
      valid: [{ name: "", email: "a@b.fr" }],
      invalid: [],
    })
  })

  it("rejette un display-name contenant un CR/LF comme invalide (B3)", () => {
    const out = parseAddressList("Evil\r\nBcc: x <a@b.fr>")
    expect(out.valid).toEqual([])
    expect(out.invalid).toHaveLength(1)
  })

  it("rejette une adresse malformée à doubles chevrons (R-B)", () => {
    const out = parseAddressList("X <a@b.fr> <c@d.fr>")
    expect(out.valid).toEqual([])
    expect(out.invalid).toEqual(["X <a@b.fr> <c@d.fr>"])
  })
})

describe("isCleanHeaderValue", () => {
  it("accepte une chaîne sans caractère de contrôle", () => {
    expect(isCleanHeaderValue("Objet normal")).toBe(true)
  })
  it("rejette CR, LF, NUL", () => {
    expect(isCleanHeaderValue("a\r\nb")).toBe(false)
    expect(isCleanHeaderValue("a\x00b")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/compose-build.test.ts`
Expected: FAIL (`Cannot find module './compose-build'`).

- [ ] **Step 3: Write minimal implementation**

`src/server/compose-build.ts` (début du fichier) :

```ts
import type { MailAddress } from "./mail-types"

// Rejette les caractères de contrôle interdits dans une valeur d'en-tête (B3 anti-CRLF).
export function isCleanHeaderValue(s: string): boolean {
  return !/[\r\n\x00]/.test(s)
}

// Validation email volontairement simple et stricte (pas de display-name autorisé ici).
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

// Parse une saisie "Nom <a@b>, c@d" en adresses structurées. Tout segment dont l'email
// est invalide OU dont le name contient un caractère de contrôle est classé "invalid".
export function parseAddressList(raw: string): {
  valid: MailAddress[]
  invalid: string[]
} {
  const valid: MailAddress[] = []
  const invalid: string[] = []
  for (const segment of raw.split(",")) {
    const seg = segment.trim()
    if (seg === "") continue
    // R-B : name sans <>, email sans <>@espace — refuse "X <a@b> <c@d>" plutôt que de l'absorber.
    const m = /^([^<>]*)<([^<>\s]+@[^<>\s]+)>$/.exec(seg)
    const name = m ? m[1].trim() : ""
    const email = (m ? m[2] : seg).trim()
    if (EMAIL_RE.test(email) && isCleanHeaderValue(name)) {
      valid.push({ name, email })
    } else {
      invalid.push(seg)
    }
  }
  return { valid, invalid }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/compose-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/compose-build.ts src/server/compose-build.test.ts
git commit -m "feat(4c): parseAddressList + isCleanHeaderValue (anti-CRLF)"
```

---

## Task 3: Contexte de réponse (`buildReplyContext`)

**Files:**
- Modify: `src/server/compose-build.ts`
- Test: `src/server/compose-build.test.ts`

**Interfaces:**
- Consumes: `AppThreadDetail`, `AppMessage`, `MailAddress` depuis `./mail-types` ; `sanitizeComposeHtml` depuis `./compose-html`.
- Produces:
  - `type ComposeMode = "compose" | "reply" | "replyAll" | "forward"`
  - `interface ReplyContext { to: MailAddress[]; cc: MailAddress[]; subject: string; inReplyTo?: string; references: string[]; quotedHtml: string }`
  - `buildReplyContext(detail: AppThreadDetail, mode: ComposeMode, selfEmail: string): ReplyContext`

> Note threading : `AppMessage` n'expose pas aujourd'hui le `Message-Id` ni les
> `references`. En 4c on dérive `inReplyTo`/`references` du champ `AppMessage.id`
> seulement si disponible ; sinon on laisse `references: []` et `inReplyTo` undefined
> (le fil reste correct côté UI). L'enrichissement de `AppMessage` avec les
> Message-ID réels est traité en Task 5 (lecture JMAP) — ici la fonction prend un
> `messageId?` optionnel sur le dernier message via un champ dédié du detail.
> **Décision** : on ajoute un paramètre `lastMessageId?: string` à `buildReplyContext`
> plutôt que d'élargir `AppMessage` maintenant.

Signature finale : `buildReplyContext(detail, mode, selfEmail, lastMessageId?)`.

- [ ] **Step 1: Write the failing test** (ajouter à `compose-build.test.ts`)

```ts
import { buildReplyContext } from "./compose-build"
import type { AppThreadDetail, AppMessage } from "./mail-types"

const msg = (over: Partial<AppMessage> = {}): AppMessage => ({
  id: "m1",
  from: [{ name: "Alice", email: "alice@x.fr" }],
  to: [{ name: "Moi", email: "me@x.fr" }],
  cc: [{ name: "Bob", email: "bob@x.fr" }],
  subject: "Sujet",
  receivedAt: "2026-06-10T00:00:00Z",
  unread: false,
  hasAttachment: false,
  textBody: "corps",
  htmlBody: "<p>corps</p>",
  attachments: [],
  ...over,
})

const detail = (messages: AppMessage[]): AppThreadDetail => ({
  threadId: "t1",
  subject: messages[messages.length - 1].subject,
  messages,
  emailIds: messages.map((m) => m.id),
  starred: false,
  unread: false,
})

describe("buildReplyContext", () => {
  it("reply : destinataire = expéditeur, objet préfixé Re:, citation sanitisée", () => {
    const ctx = buildReplyContext(detail([msg()]), "reply", "me@x.fr")
    expect(ctx.to).toEqual([{ name: "Alice", email: "alice@x.fr" }])
    expect(ctx.cc).toEqual([])
    expect(ctx.subject).toBe("Re: Sujet")
    expect(ctx.quotedHtml).toContain("corps")
  })

  it("ne double pas le préfixe Re: déjà présent", () => {
    const ctx = buildReplyContext(detail([msg({ subject: "Re: Sujet" })]), "reply", "me@x.fr")
    expect(ctx.subject).toBe("Re: Sujet")
  })

  it("replyAll : cc = to+cc d'origine moins soi-même", () => {
    const ctx = buildReplyContext(detail([msg()]), "replyAll", "me@x.fr")
    expect(ctx.to).toEqual([{ name: "Alice", email: "alice@x.fr" }])
    expect(ctx.cc).toEqual([{ name: "Bob", email: "bob@x.fr" }])
  })

  it("forward : pas de destinataire, objet Fwd:, pas d'inReplyTo", () => {
    const ctx = buildReplyContext(detail([msg()]), "forward", "me@x.fr")
    expect(ctx.to).toEqual([])
    expect(ctx.subject).toBe("Fwd: Sujet")
    expect(ctx.inReplyTo).toBeUndefined()
  })

  it("reply : inReplyTo/references depuis lastMessageId fourni", () => {
    const ctx = buildReplyContext(detail([msg()]), "reply", "me@x.fr", "<mid@x.fr>")
    expect(ctx.inReplyTo).toBe("<mid@x.fr>")
    expect(ctx.references).toEqual(["<mid@x.fr>"])
  })

  it("citation : neutralise le HTML hostile du message d'origine (B1)", () => {
    const evil = msg({ htmlBody: '<p>ok</p><img src=x onerror="alert(1)">' })
    const ctx = buildReplyContext(detail([evil]), "reply", "me@x.fr")
    expect(ctx.quotedHtml).not.toContain("onerror")
    expect(ctx.quotedHtml).not.toContain("<img")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/compose-build.test.ts`
Expected: FAIL (`buildReplyContext is not a function`).

- [ ] **Step 3: Write minimal implementation** (ajouter à `compose-build.ts`)

```ts
import type { AppThreadDetail } from "./mail-types"
import { sanitizeComposeHtml } from "../lib/compose-html" // P1 : module neutre hors src/server

export type ComposeMode = "compose" | "reply" | "replyAll" | "forward"

export interface ReplyContext {
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  inReplyTo?: string
  references: string[]
  quotedHtml: string
}

function prefixSubject(subject: string, prefix: "Re" | "Fwd"): string {
  const re = new RegExp(`^${prefix}:\\s*`, "i")
  return re.test(subject) ? subject : `${prefix}: ${subject}`
}

function dedupeByEmail(addrs: MailAddress[], excludeEmail: string): MailAddress[] {
  const seen = new Set<string>([excludeEmail.toLowerCase()])
  const out: MailAddress[] = []
  for (const a of addrs) {
    const key = a.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

// Construit le contexte de réponse/transfert depuis le dernier message du fil.
// quotedHtml passe TOUJOURS par sanitizeComposeHtml : le htmlBody d'origine est non fiable (B1).
export function buildReplyContext(
  detail: AppThreadDetail,
  mode: ComposeMode,
  selfEmail: string,
  lastMessageId?: string
): ReplyContext {
  const last = detail.messages[detail.messages.length - 1]
  const quotedHtml = last?.htmlBody
    ? sanitizeComposeHtml(`<p><br></p><blockquote>${last.htmlBody}</blockquote>`)
    : ""
  const references = lastMessageId ? [lastMessageId] : []

  if (mode === "forward") {
    return {
      to: [],
      cc: [],
      subject: prefixSubject(detail.subject, "Fwd"),
      references: [],
      quotedHtml,
    }
  }

  const to = last ? last.from : []
  const cc =
    mode === "replyAll" && last
      ? dedupeByEmail([...last.to, ...last.cc], selfEmail).filter(
          (a) => a.email.toLowerCase() !== to[0]?.email.toLowerCase()
        )
      : []

  return {
    to,
    cc,
    subject: prefixSubject(detail.subject, "Re"),
    inReplyTo: lastMessageId,
    references,
    quotedHtml,
  }
}
```

> Note : `blockquote` n'est pas dans l'allowlist B2 → `sanitizeComposeHtml` le
> retirera, ne gardant que le contenu cité (acceptable en 4c : la citation reste
> lisible, sans style de citation natif). Si l'on veut conserver le `<blockquote>`,
> l'ajouter explicitement à `ALLOWED_TAGS` dans Task 1 **et** mettre à jour le test
> Task 1 en conséquence. **Décision 4c** : ne PAS l'ajouter (allowlist minimale) ;
> ajuster l'assertion `quotedHtml` du test pour ne vérifier que la présence du texte.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/compose-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/compose-build.ts src/server/compose-build.test.ts
git commit -m "feat(4c): buildReplyContext (reply/replyAll/forward, citation sanitisée)"
```

---

## Task 4: Sélection d'identité (`pickSendIdentity`)

**Files:**
- Modify: `src/server/compose-build.ts`
- Test: `src/server/compose-build.test.ts`

**Interfaces:**
- Consumes: `JmapMethodResponse` depuis `./jmap`.
- Produces:
  - `interface SendIdentity { id: string; name: string; email: string }`
  - `pickSendIdentity(responses: JmapMethodResponse[], accountEmail: string): SendIdentity | null`

- [ ] **Step 1: Write the failing test** (ajouter à `compose-build.test.ts`)

```ts
import { pickSendIdentity } from "./compose-build"
import type { JmapMethodResponse } from "./jmap"

const identityGet = (list: unknown[]): JmapMethodResponse[] => [
  ["Identity/get", { list }, "0"],
]

describe("pickSendIdentity", () => {
  it("retient l'identité dont l'email correspond au compte", () => {
    const r = identityGet([
      { id: "i1", name: "Pro", email: "other@x.fr" },
      { id: "i2", name: "Moi", email: "me@x.fr" },
    ])
    expect(pickSendIdentity(r, "me@x.fr")).toEqual({ id: "i2", name: "Moi", email: "me@x.fr" })
  })

  it("retombe sur la première identité si aucune ne correspond", () => {
    const r = identityGet([{ id: "i1", name: "A", email: "a@x.fr" }])
    expect(pickSendIdentity(r, "me@x.fr")).toEqual({ id: "i1", name: "A", email: "a@x.fr" })
  })

  it("renvoie null si aucune identité", () => {
    expect(pickSendIdentity(identityGet([]), "me@x.fr")).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/compose-build.test.ts`
Expected: FAIL (`pickSendIdentity is not a function`).

- [ ] **Step 3: Write minimal implementation** (ajouter à `compose-build.ts`)

```ts
import type { JmapMethodResponse } from "./jmap"

export interface SendIdentity {
  id: string
  name: string
  email: string
}

interface RawIdentity {
  id: string
  name?: string | null
  email: string
}

// Choisit l'identité d'expédition (R1 : jamais fournie par le client). Priorité à
// celle dont l'email == compte de session ; sinon la première.
export function pickSendIdentity(
  responses: JmapMethodResponse[],
  accountEmail: string
): SendIdentity | null {
  const get = responses.find(([name]) => name === "Identity/get")
  const raw = get?.[1].list
  const list: RawIdentity[] = Array.isArray(raw) ? (raw as RawIdentity[]) : []
  if (list.length === 0) return null
  const match =
    list.find((i) => i.email.toLowerCase() === accountEmail.toLowerCase()) ?? list[0]
  return { id: match.id, name: match.name ?? "", email: match.email }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/compose-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/compose-build.ts src/server/compose-build.test.ts
git commit -m "feat(4c): pickSendIdentity (identité d'expédition côté serveur)"
```

---

## Task 5: Construction du batch d'envoi (`buildSendMethodCalls`)

**Files:**
- Modify: `src/server/compose-build.ts`
- Test: `src/server/compose-build.test.ts`

**Interfaces:**
- Consumes: `JmapMethodCall` depuis `./jmap` ; `MailAddress` ; `SendIdentity`.
- Produces:
  - `interface SendBody { to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[]; subject: string; html: string; text: string; inReplyTo?: string; references: string[] }`
  - `buildSendMethodCalls(accountId, body: SendBody, ctx: { draftsId: string; sentId: string; identity: SendIdentity }): JmapMethodCall[]`

- [ ] **Step 1: Write the failing test** (ajouter à `compose-build.test.ts`)

```ts
import { buildSendMethodCalls } from "./compose-build"
import type { SendBody } from "./compose-build"

const body = (over: Partial<SendBody> = {}): SendBody => ({
  to: [{ name: "Alice", email: "alice@x.fr" }],
  cc: [],
  bcc: [{ name: "", email: "secret@x.fr" }],
  subject: "Bonjour",
  html: "<p>Salut</p>",
  text: "Salut",
  references: [],
  ...over,
})

const ctx = {
  draftsId: "mb-drafts",
  sentId: "mb-sent",
  identity: { id: "i1", name: "Moi", email: "me@x.fr" },
}

describe("buildSendMethodCalls", () => {
  const calls = buildSendMethodCalls("acc1", body(), ctx)
  const emailSet = calls.find((c) => c[0] === "Email/set")!
  const submissionSet = calls.find((c) => c[0] === "EmailSubmission/set")!
  const created = (emailSet[1].create as Record<string, Record<string, unknown>>)
  const draft = Object.values(created)[0]

  it("crée l'Email dans Drafts avec keywords \$draft/\$seen", () => {
    expect(draft.mailboxIds).toEqual({ "mb-drafts": true })
    expect(draft.keywords).toEqual({ $draft: true, $seen: true })
  })

  it("from = identité serveur (R1)", () => {
    expect(draft.from).toEqual([{ name: "Moi", email: "me@x.fr" }])
  })

  it("bcc absent des propriétés de l'Email stocké (R2)", () => {
    expect(draft.bcc).toBeUndefined()
    expect(JSON.stringify(draft)).not.toContain("secret@x.fr")
  })

  it("EmailSubmission référence l'Email créé et inclut bcc dans rcptTo (R2)", () => {
    const subCreate = Object.values(
      submissionSet[1].create as Record<string, Record<string, unknown>>
    )[0]
    expect(subCreate.identityId).toBe("i1")
    const env = subCreate.envelope as { rcptTo: { email: string }[] }
    expect(env.rcptTo.map((r) => r.email)).toContain("secret@x.fr")
  })

  it("onSuccessUpdateEmail : retire \$draft, déplace Drafts→Sent", () => {
    const upd = submissionSet[1].onSuccessUpdateEmail as Record<
      string,
      Record<string, unknown>
    >
    const patch = Object.values(upd)[0]
    expect(patch["keywords/$draft"]).toBeNull()
    expect(patch["mailboxIds/mb-drafts"]).toBeNull()
    expect(patch["mailboxIds/mb-sent"]).toBe(true)
  })

  it("threading : Message-ID via header:*:asMessageIds (B3)", () => {
    const withRef = buildSendMethodCalls(
      "acc1",
      body({ inReplyTo: "<mid@x.fr>", references: ["<mid@x.fr>"] }),
      ctx
    )
    const d = Object.values(
      (withRef.find((c) => c[0] === "Email/set")![1].create as Record<
        string,
        Record<string, unknown>
      >)
    )[0]
    expect(d["header:In-Reply-To:asMessageIds"]).toEqual(["<mid@x.fr>"])
    expect(d["header:References:asMessageIds"]).toEqual(["<mid@x.fr>"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/compose-build.test.ts`
Expected: FAIL (`buildSendMethodCalls is not a function`).

- [ ] **Step 3: Write minimal implementation** (ajouter à `compose-build.ts`)

```ts
import type { JmapMethodCall } from "./jmap"

export interface SendBody {
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  html: string
  text: string
  inReplyTo?: string
  references: string[]
}

const EMAIL_CREATE_ID = "draft"
const SUBMISSION_CREATE_ID = "sub"

// Construit le batch Email/set (brouillon) + EmailSubmission/set (envoi). bcc UNIQUEMENT
// dans l'enveloppe (R2). from depuis l'identité serveur (R1). Threading via headers (B3).
export function buildSendMethodCalls(
  accountId: string,
  body: SendBody,
  ctx: { draftsId: string; sentId: string; identity: SendIdentity }
): JmapMethodCall[] {
  const draft: Record<string, unknown> = {
    mailboxIds: { [ctx.draftsId]: true },
    keywords: { $draft: true, $seen: true },
    from: [{ name: ctx.identity.name, email: ctx.identity.email }],
    to: body.to,
    subject: body.subject,
    bodyValues: {
      html: { value: body.html },
      plain: { value: body.text },
    },
    htmlBody: [{ partId: "html", type: "text/html" }],
    textBody: [{ partId: "plain", type: "text/plain" }],
  }
  if (body.cc.length > 0) draft.cc = body.cc
  if (body.inReplyTo) draft["header:In-Reply-To:asMessageIds"] = [body.inReplyTo]
  if (body.references.length > 0)
    draft["header:References:asMessageIds"] = body.references

  // Enveloppe SMTP : tous les destinataires, bcc compris (mais jamais en en-tête).
  const rcptTo = [...body.to, ...body.cc, ...body.bcc].map((a) => ({ email: a.email }))

  return [
    ["Email/set", { accountId, create: { [EMAIL_CREATE_ID]: draft } }, "0"],
    [
      "EmailSubmission/set",
      {
        accountId,
        create: {
          [SUBMISSION_CREATE_ID]: {
            emailId: `#${EMAIL_CREATE_ID}`,
            identityId: ctx.identity.id,
            envelope: { mailFrom: { email: ctx.identity.email }, rcptTo },
          },
        },
        onSuccessUpdateEmail: {
          [`#${SUBMISSION_CREATE_ID}`]: {
            "keywords/$draft": null,
            [`mailboxIds/${ctx.draftsId}`]: null,
            [`mailboxIds/${ctx.sentId}`]: true,
          },
        },
      },
      "1",
    ],
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/compose-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/compose-build.ts src/server/compose-build.test.ts
git commit -m "feat(4c): buildSendMethodCalls (Email/set + EmailSubmission/set)"
```

---

## Task 6: Parsing du résultat d'envoi (`parseSendResult`)

**Files:**
- Modify: `src/server/compose-build.ts`
- Test: `src/server/compose-build.test.ts`

**Interfaces:**
- Consumes: `JmapMethodResponse` depuis `./jmap`.
- Produces:
  - `type SendErrorCode = "rejected" | "quota" | "failed"`
  - `type SendResult = { ok: true; emailId: string } | { ok: false; code: SendErrorCode }`
  - `parseSendResult(responses: JmapMethodResponse[]): SendResult`

- [ ] **Step 1: Write the failing test** (ajouter à `compose-build.test.ts`)

```ts
import { parseSendResult } from "./compose-build"

describe("parseSendResult", () => {
  it("succès : renvoie l'id de l'email soumis", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", { created: { draft: { id: "e-9" } } }, "0"],
      ["EmailSubmission/set", { created: { sub: { id: "s-1" } } }, "1"],
    ]
    expect(parseSendResult(r)).toEqual({ ok: true, emailId: "e-9" })
  })

  it("notCreated sur EmailSubmission → code mappé (sans détail JMAP, R6)", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", { created: { draft: { id: "e-9" } } }, "0"],
      [
        "EmailSubmission/set",
        { notCreated: { sub: { type: "forbiddenFrom", description: "relay info interne" } } },
        "1",
      ],
    ]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "rejected" })
  })

  it("notCreated overQuota → code quota", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", { created: { draft: { id: "e-9" } } }, "0"],
      ["EmailSubmission/set", { notCreated: { sub: { type: "overQuota" } } }, "1"],
    ]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "quota" })
  })

  it("échec Email/set → code failed", () => {
    const r: JmapMethodResponse[] = [
      ["Email/set", { notCreated: { draft: { type: "invalidProperties" } } }, "0"],
    ]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "failed" })
  })

  it("erreur JMAP niveau méthode (['error',…]) → failed, jamais faux succès (R-E)", () => {
    const r: JmapMethodResponse[] = [["error", { type: "unknownMethod" }, "1"]]
    expect(parseSendResult(r)).toEqual({ ok: false, code: "failed" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/compose-build.test.ts`
Expected: FAIL (`parseSendResult is not a function`).

- [ ] **Step 3: Write minimal implementation** (ajouter à `compose-build.ts`)

```ts
export type SendErrorCode = "rejected" | "quota" | "failed"
export type SendResult = { ok: true; emailId: string } | { ok: false; code: SendErrorCode }

function firstSetError(args: Record<string, unknown>): string | null {
  const nc = args.notCreated as Record<string, { type?: string }> | undefined
  if (!nc) return null
  const first = Object.values(nc)[0]
  return first?.type ?? "unknown"
}

// Mappe les SetError JMAP/SMTP vers un code i18n fixe (R6 : aucun détail propagé).
export function parseSendResult(responses: JmapMethodResponse[]): SendResult {
  const emailSet = responses.find(([n]) => n === "Email/set")
  const submission = responses.find(([n]) => n === "EmailSubmission/set")

  const emailErr = emailSet ? firstSetError(emailSet[1]) : "unknown"
  if (emailErr) return { ok: false, code: "failed" }

  const subErr = submission ? firstSetError(submission[1]) : "unknown"
  if (subErr) {
    if (subErr === "overQuota") return { ok: false, code: "quota" }
    if (subErr === "forbiddenFrom" || subErr === "forbiddenToSend")
      return { ok: false, code: "rejected" }
    return { ok: false, code: "failed" }
  }

  const created = emailSet![1].created as Record<string, { id: string }>
  const emailId = Object.values(created)[0]?.id ?? ""
  return { ok: true, emailId }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/compose-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/compose-build.ts src/server/compose-build.test.ts
git commit -m "feat(4c): parseSendResult (codes d'erreur i18n sans fuite)"
```

---

## Task 7: Capability submission sur `jmapUserCall`

**Files:**
- Modify: `src/server/jmap-user.ts:17-30`
- Test: `src/server/jmap-user.test.ts`

**Interfaces:**
- Produces (modifié) : `jmapUserCall(sid, methodCalls, capabilities?: string[])` ; export `SUBMISSION_CAPABILITIES`.

- [ ] **Step 1: Write the failing test** (ajouter à `jmap-user.test.ts`)

Vérifie que le `using` envoyé contient submission **uniquement** quand on passe `SUBMISSION_CAPABILITIES`. Adapter au mock `stalwartUserFetch` existant du fichier ; squelette :

```ts
import { SUBMISSION_CAPABILITIES } from "./jmap-user"

it("inclut la capability submission quand demandé", async () => {
  // ...mock stalwartUserFetch pour capturer le body...
  await jmapUserCall("sid", [["X/get", {}, "0"]], SUBMISSION_CAPABILITIES)
  const sent = JSON.parse(capturedBody) as { using: string[] }
  expect(sent.using).toContain("urn:ietf:params:jmap:submission")
})

it("n'inclut PAS submission par défaut (R5)", async () => {
  await jmapUserCall("sid", [["X/get", {}, "0"]])
  const sent = JSON.parse(capturedBody) as { using: string[] }
  expect(sent.using).not.toContain("urn:ietf:params:jmap:submission")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/jmap-user.test.ts`
Expected: FAIL (`SUBMISSION_CAPABILITIES` non exporté).

- [ ] **Step 3: Write minimal implementation**

`src/server/jmap-user.ts` — remplacer la constante et la signature :

```ts
const MAIL_CAPABILITIES = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail']

// Capabilities pour l'envoi (R5) : submission ajouté UNIQUEMENT pour sendMailFn.
export const SUBMISSION_CAPABILITIES = [
  ...MAIL_CAPABILITIES,
  'urn:ietf:params:jmap:submission',
]

export async function jmapUserCall(
  sid: string,
  methodCalls: JmapMethodCall[],
  capabilities: string[] = MAIL_CAPABILITIES,
): Promise<JmapMethodResponse[]> {
  const accessToken = await withFreshAccessToken(sid)
  if (accessToken === null) throw redirect({ to: '/login' })

  const res = await stalwartUserFetch('/jmap/', accessToken, {
    method: 'POST',
    body: JSON.stringify({ using: capabilities, methodCalls }),
  })
  // ...reste inchangé...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/jmap-user.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/jmap-user.ts src/server/jmap-user.test.ts
git commit -m "feat(4c): jmapUserCall capabilities optionnelles + SUBMISSION_CAPABILITIES"
```

---

## Task 8: Rate-limit d'envoi (`send-rate-limit.ts`)

**Files:**
- Create: `src/server/send-rate-limit.ts`
- Test: `src/server/send-rate-limit.test.ts`

**Interfaces:**
- Produces:
  - `isSendRateLimited(account: string, now?: number): boolean`
  - `recordSend(account: string, now?: number): void`
  - `__resetForTest()`

- [ ] **Step 1: Write the failing test**

`src/server/send-rate-limit.test.ts` :

```ts
import { afterEach, describe, expect, it } from "vitest"
import { isSendRateLimited, recordSend, __resetForTest } from "./send-rate-limit"

afterEach(() => __resetForTest())

describe("send-rate-limit", () => {
  it("autorise sous le seuil", () => {
    const now = 1_000_000
    for (let i = 0; i < 5; i++) recordSend("me@x.fr", now)
    expect(isSendRateLimited("me@x.fr", now)).toBe(false)
  })

  it("bloque au-delà du seuil (30/heure)", () => {
    const now = 1_000_000
    for (let i = 0; i < 30; i++) recordSend("me@x.fr", now)
    expect(isSendRateLimited("me@x.fr", now)).toBe(true)
  })

  it("compte par compte, insensible à la casse", () => {
    const now = 1_000_000
    for (let i = 0; i < 30; i++) recordSend("ME@x.fr", now)
    expect(isSendRateLimited("me@x.fr", now)).toBe(true)
    expect(isSendRateLimited("autre@x.fr", now)).toBe(false)
  })

  it("oublie les envois hors fenêtre", () => {
    const now = 1_000_000
    for (let i = 0; i < 30; i++) recordSend("me@x.fr", now)
    expect(isSendRateLimited("me@x.fr", now + 61 * 60 * 1000)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/send-rate-limit.test.ts`
Expected: FAIL (`Cannot find module './send-rate-limit'`).

- [ ] **Step 3: Write minimal implementation**

`src/server/send-rate-limit.ts` (miroir simplifié de `login-rate-limit.ts`, clé par compte) :

```ts
// Throttle d'envoi par compte (in-memory, BFF mono-process). Borne le spam sortant
// avant EmailSubmission/set (audit 4c B4). La clé `account` est l'accountId de session
// fourni par sendMailFn (P2) — jamais une chaîne vide (sinon throttle global).
// Limite assumée (R-H) : mono-process, remis à zéro au redémarrage (comme login-rate-limit).
const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_ACCOUNT = 30

const sends = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const list = (sends.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length === 0) sends.delete(key)
  else sends.set(key, list)
  return list
}

export function isSendRateLimited(account: string, now = Date.now()): boolean {
  return recent(`a:${account.toLowerCase()}`, now).length >= MAX_PER_ACCOUNT
}

export function recordSend(account: string, now = Date.now()): void {
  const key = `a:${account.toLowerCase()}`
  const list = recent(key, now)
  list.push(now)
  sends.set(key, list)
}

export function __resetForTest(): void {
  sends.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/send-rate-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/send-rate-limit.ts src/server/send-rate-limit.test.ts
git commit -m "feat(4c): rate-limit d'envoi par compte (anti-spam sortant)"
```

---

## Task 9: Server function `sendMailFn`

**Files:**
- Modify: `src/server/mail-actions.ts` (ajout en fin de fichier)
- Test: `src/server/mail-actions.test.ts` (ajout)

**Interfaces:**
- Consumes : `sanitizeComposeHtml`, `htmlToPlainText` (`../lib/compose-html`) ; `buildSendMethodCalls`, `parseSendResult`, `pickSendIdentity`, `isCleanHeaderValue`, types (`./compose-build`) ; `mailboxRefs` (déjà présent) ; `SUBMISSION_CAPABILITIES`, `jmapUserCall` (`./jmap-user`) ; `isSendRateLimited`, `recordSend` (`./send-rate-limit`).
- Produces : `sendMailFn` (server fn POST) ; `sendMailSchema` (Zod) ; `mailboxIdByRole` est déjà défini dans le fichier (réutilisé).

> Le schéma valide une saisie **déjà parsée** côté client (le client transmet des
> `MailAddress[]`, voir Task 11). Le serveur revalide : email + name propre (B3),
> bornes (B4).

- [ ] **Step 1: Write the failing test** (ajouter à `mail-actions.test.ts`)

```ts
// En tête du fichier de test, mocker compose deps si besoin. Test du schéma (pur) :
import { sendMailSchema } from "./mail-actions"

describe("sendMailSchema", () => {
  const base = {
    mode: "compose",
    to: [{ name: "Alice", email: "alice@x.fr" }],
    cc: [],
    bcc: [],
    subject: "Bonjour",
    html: "<p>Salut</p>",
    references: [],
  }

  it("accepte une entrée valide", () => {
    expect(() => sendMailSchema.parse(base)).not.toThrow()
  })

  it("rejette un subject avec CRLF (B3)", () => {
    expect(() => sendMailSchema.parse({ ...base, subject: "a\r\nBcc: x" })).toThrow()
  })

  it("rejette > 100 destinataires cumulés (B4)", () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ name: "", email: `u${i}@x.fr` }))
    expect(() => sendMailSchema.parse({ ...base, to: many })).toThrow()
  })

  it("rejette un html > 256 Ko (B4)", () => {
    expect(() => sendMailSchema.parse({ ...base, html: "a".repeat(256 * 1024 + 1) })).toThrow()
  })

  it("rejette un email invalide", () => {
    expect(() => sendMailSchema.parse({ ...base, to: [{ name: "", email: "x" }] })).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/mail-actions.test.ts`
Expected: FAIL (`sendMailSchema` non exporté).

- [ ] **Step 3: Write minimal implementation** (ajouter à `mail-actions.ts`)

```ts
import { sanitizeComposeHtml, htmlToPlainText } from "../lib/compose-html"
import {
  buildSendMethodCalls,
  parseSendResult,
  pickSendIdentity,
  isCleanHeaderValue,
  type ComposeMode,
  type SendBody,
} from "./compose-build"

const addressSchema = z.object({
  name: z.string().max(255).refine(isCleanHeaderValue, "name: caractère interdit"),
  email: z.string().email().max(320),
})

const headerLine = z
  .string()
  .max(998)
  .refine(isCleanHeaderValue, "en-tête: caractère interdit")

const messageId = z.string().min(3).max(998).refine(isCleanHeaderValue)

export const sendMailSchema = z
  .object({
    mode: z.enum(["compose", "reply", "replyAll", "forward"]),
    to: z.array(addressSchema).max(100),
    cc: z.array(addressSchema).max(100),
    bcc: z.array(addressSchema).max(100),
    subject: headerLine,
    html: z.string().max(256 * 1024),
    inReplyTo: messageId.optional(),
    references: z.array(messageId).max(50),
  })
  .refine((d) => d.to.length + d.cc.length + d.bcc.length <= 100, {
    message: "trop de destinataires",
  })
  .refine((d) => d.to.length + d.cc.length + d.bcc.length >= 1, {
    message: "au moins un destinataire",
  })

type SendMailInput = z.infer<typeof sendMailSchema>

export const sendMailFn = createServerFn({ method: "POST" })
  .validator((d: SendMailInput) => sendMailSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; emailId: string }> => {
    try {
      const { jmapUserCall, SUBMISSION_CAPABILITIES } = await import("./jmap-user")
      const { isSendRateLimited, recordSend } = await import("./send-rate-limit")
      const { sid, accountId } = await requireSession()

      // P2 : currentSession n'expose PAS d'email (uniquement { accountId, accountName }).
      // La clé de rate-limit anti-spam est donc l'accountId (stable, par compte) — surtout
      // pas une chaîne vide partagée par tous les comptes (ce serait un rate-limit global).
      if (isSendRateLimited(accountId)) {
        throw new Error("send rate limited") // mappé en toast générique côté client
      }

      // Lecture : dossiers drafts/sent + identités (R1).
      const readResponses = await jmapUserCall(sid, [
        [
          "Mailbox/get",
          { accountId, ids: null, properties: ["id", "role"] },
          "0",
        ],
        ["Identity/get", { accountId, ids: null }, "1"],
      ])
      const mailboxes = mailboxRefs(readResponses)
      const draftsId = mailboxIdByRole(mailboxes, "drafts")
      const sentId = mailboxIdByRole(mailboxes, "sent")
      // accountEmail inconnu côté session → "" : pickSendIdentity retombe sur la première
      // identité du compte (toujours scopée à l'accountId de session par Identity/get, R1).
      const identity = pickSendIdentity(readResponses, "")
      if (!draftsId || !sentId || !identity) {
        throw new Error("send: mailbox/identity unavailable")
      }

      // Sanitisation autoritaire serveur (B2) + alternative texte.
      const html = sanitizeComposeHtml(data.html)
      const text = htmlToPlainText(html)
      const body: SendBody = {
        to: data.to,
        cc: data.cc,
        bcc: data.bcc,
        subject: data.subject,
        html,
        text,
        inReplyTo: data.inReplyTo,
        references: data.references,
      }

      const responses = await jmapUserCall(
        sid,
        buildSendMethodCalls(accountId, body, { draftsId, sentId, identity }),
        SUBMISSION_CAPABILITIES
      )
      const result = parseSendResult(responses)
      if (!result.ok) throw new Error(`send failed: ${result.code}`)
      recordSend(accountId)
      return { ok: true, emailId: result.emailId }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("send mail failed", e) // R6 : détail en logs serveur uniquement
      throw new Error("send mail failed")
    }
  })
```

> Fait établi (vérifié) : `currentSession(sid)` renvoie `{ accountId, accountName }`,
> **sans email**. Le code ci-dessus utilise donc `accountId` comme clé de rate-limit et
> `pickSendIdentity(readResponses, "")`. Ne pas réintroduire de lecture de
> `session.email` (inexistant).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/server/mail-actions.test.ts`
Expected: PASS (tests de schéma ; le handler est couvert en intégration Task 11).

- [ ] **Step 5: Commit**

```bash
git add src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(4c): sendMailFn (server function d'envoi + schéma Zod durci)"
```

---

## Task 10: Éditeur HTML minimal partagé (`RteEditor`)

**Files:**
- Create: `src/components/mail/rte-editor.tsx`
- Test: `src/components/mail/rte-editor.test.tsx`

**Interfaces:**
- Consumes : `sanitizeComposeHtml` (`../../lib/compose-html` — P1, module neutre).
- Produces :
  - `interface RteEditorProps { value: string; onChange: (html: string) => void; placeholder?: string; ariaLabel: string }`
  - `RteEditor(props): JSX.Element` — `contentEditable` + toolbar (gras/italique/lien/listes).

> **Sanitisation découplée (P1).** Ne PAS sanitiser à chaque frappe : DOMPurify
> re-sérialise le DOM, et réinjecter le résultat dans `el.innerHTML` à chaque `onInput`
> fait sauter le curseur (UX cassée → tentation de désactiver la barrière). Règle :
> - `onInput` → `onChange(el.innerHTML)` **brut** (le serveur reste la barrière
>   autoritaire B2 ; le contenu vient de l'utilisateur lui-même).
> - `onPaste` → on **sanitise le presse-papier** avant insertion (défense B1 : contenu
>   collé depuis un email hostile).
> - Injection de `value` (citation pré-remplie) → sanitisée **une seule fois** à
>   l'initialisation / quand `value` change réellement (drapeau `initialized`), jamais
>   en boucle de rendu.
> Le `RteEditor` utilise `document.execCommand` (`bold`, `italic`,
> `insertUnorderedList`, `insertOrderedList`, `createLink`).

- [ ] **Step 1: Write the failing test**

`src/components/mail/rte-editor.test.tsx` :

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { RteEditor } from "./rte-editor"

describe("RteEditor", () => {
  it("rend une zone éditable avec aria-label et toolbar", () => {
    render(<RteEditor value="" onChange={() => {}} ariaLabel="Corps du message" />)
    expect(screen.getByLabelText("Corps du message")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /gras/i })).toBeInTheDocument()
  })

  it("émet le HTML brut à la frappe (P1 : pas de sanitize à chaque onInput)", () => {
    const onChange = vi.fn()
    render(<RteEditor value="" onChange={onChange} ariaLabel="Corps" />)
    const editable = screen.getByLabelText("Corps")
    editable.innerHTML = "<p>bonjour</p>"
    fireEvent.input(editable)
    expect(onChange).toHaveBeenLastCalledWith("<p>bonjour</p>")
  })

  it("injecte une value (citation) sanitisée — barrière B1 à l'injection", () => {
    render(
      <RteEditor
        value='<p>cite</p><script>alert(1)</script><img src=x onerror="alert(1)">'
        onChange={() => {}}
        ariaLabel="Corps"
      />
    )
    const editable = screen.getByLabelText("Corps")
    expect(editable.innerHTML).toContain("cite")
    expect(editable.innerHTML).not.toContain("script")
    expect(editable.innerHTML).not.toContain("onerror")
    expect(editable.innerHTML).not.toContain("<img")
  })
})

// Note : le `onPaste` sanitise via document.execCommand('insertHTML'), no-op sous jsdom —
// la défense B1 au collage est donc couverte par revue de code + la barrière serveur
// autoritaire (Task 1 + Task 9), pas par ce test composant.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/mail/rte-editor.test.tsx`
Expected: FAIL (`Cannot find module './rte-editor'`).

- [ ] **Step 3: Write minimal implementation**

`src/components/mail/rte-editor.tsx` :

```tsx
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { sanitizeComposeHtml } from "../../lib/compose-html"

export interface RteEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  ariaLabel: string
}

export function RteEditor({ value, onChange, placeholder, ariaLabel }: RteEditorProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const lastInjected = useRef<string | null>(null)

  // Injecte la value externe (citation pré-remplie) — sanitisée (B1) — UNIQUEMENT quand
  // elle change réellement (P1 : pas à chaque rendu, sinon le curseur saute pendant la frappe).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (value === lastInjected.current) return
    lastInjected.current = value
    el.innerHTML = sanitizeComposeHtml(value)
  }, [value])

  // Frappe : on émet le HTML brut (le serveur sanitise à l'envoi, barrière autoritaire B2).
  function emit() {
    const el = ref.current
    if (!el) return
    onChange(el.innerHTML)
  }

  // Collage : sanitise le presse-papier avant insertion (défense B1 : contenu hostile collé).
  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const raw = e.clipboardData.getData("text/html") || e.clipboardData.getData("text/plain")
    document.execCommand("insertHTML", false, sanitizeComposeHtml(raw))
    emit()
  }

  function exec(cmd: string, arg?: string) {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
  }

  function addLink() {
    const url = window.prompt(t("mail.compose.linkPrompt"), "https://")
    if (url) exec("createLink", url)
  }

  return (
    <div className="rte">
      <div className="rte-toolbar" role="toolbar">
        <button type="button" aria-label={t("mail.compose.bold")} onClick={() => exec("bold")}>
          <Icon name="bold" size={15} />
        </button>
        <button type="button" aria-label={t("mail.compose.italic")} onClick={() => exec("italic")}>
          <Icon name="italic" size={15} />
        </button>
        <button type="button" aria-label={t("mail.compose.link")} onClick={addLink}>
          <Icon name="link" size={15} />
        </button>
        <button
          type="button"
          aria-label={t("mail.compose.bulletList")}
          onClick={() => exec("insertUnorderedList")}
        >
          <Icon name="list" size={15} />
        </button>
        <button
          type="button"
          aria-label={t("mail.compose.numberList")}
          onClick={() => exec("insertOrderedList")}
        >
          <Icon name="listOrdered" size={15} />
        </button>
      </div>
      <div
        ref={ref}
        className="rte-body"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={onPaste}
      />
    </div>
  )
}
```

> Prérequis icônes : vérifier les noms d'icônes dans `mail-icons.tsx`. Si `bold`,
> `italic`, `link`, `list`, `listOrdered` n'existent pas, soit les ajouter au registre
> d'icônes, soit réutiliser des noms existants. **Décision** : ajouter les icônes
> manquantes à `mail-icons.tsx` dans cette tâche (étape supplémentaire avant le test).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/mail/rte-editor.test.tsx`
Expected: PASS.

> Note jsdom : `document.execCommand` est un no-op sous jsdom — les tests ne vérifient
> donc PAS le résultat du formatage, seulement la présence des contrôles et le flux
> `onChange`/sanitisation. C'est volontaire (le formatage réel est testé manuellement).

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/rte-editor.tsx src/components/mail/rte-editor.test.tsx src/components/mail/mail-icons.tsx
git commit -m "feat(4c): RteEditor (éditeur HTML minimal partagé, sanitisé)"
```

---

## Task 11: Hook `useComposer` (mutation `sendMailFn`)

**Files:**
- Create: `src/components/mail/use-composer.ts`
- Test: `src/components/mail/use-composer.test.tsx`

**Interfaces:**
- Consumes : `sendMailFn` (`../../server/mail-actions`) ; `parseAddressList` (`../../server/compose-build`) ; `useToast` ; `useQueryClient`.
- Produces :
  - `interface ComposerDraft { mode: ComposeMode; to: string; cc: string; bcc: string; subject: string; html: string; inReplyTo?: string; references: string[] }`
  - `interface UseComposer { sending: boolean; send: (draft: ComposerDraft) => Promise<boolean> }`
  - `useComposer(folder: string): UseComposer` — parse les adresses, appelle `sendMailFn`, toast succès/erreur, invalide les queries. Retourne `false` sur erreur (le composant garde le contenu).

- [ ] **Step 1: Write the failing test**

`src/components/mail/use-composer.test.tsx` :

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import type { ReactNode } from "react"
import { useComposer } from "./use-composer"

const sendMail = vi.fn()
vi.mock("../../server/mail-actions", () => ({ sendMailFn: (a: unknown) => sendMail(a) }))
const notify = vi.fn()
vi.mock("./toast", () => ({ useToast: () => notify }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

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
    expect(notify).toHaveBeenCalledWith("mail.compose.invalidRecipients", "error")
  })

  it("échec serveur : toast erreur, retourne false (contenu conservé)", async () => {
    sendMail.mockRejectedValue(new Error("send mail failed"))
    const { result } = renderHook(() => useComposer("inbox"), { wrapper })
    let ok = true
    await act(async () => {
      ok = await result.current.send(draft)
    })
    expect(ok).toBe(false)
    expect(notify).toHaveBeenCalledWith("mail.compose.error", "error")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/mail/use-composer.test.tsx`
Expected: FAIL (`Cannot find module './use-composer'`).

- [ ] **Step 3: Write minimal implementation**

`src/components/mail/use-composer.ts` :

```ts
import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { sendMailFn } from "../../server/mail-actions"
import { parseAddressList, type ComposeMode } from "../../server/compose-build"
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/mail/use-composer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/use-composer.ts src/components/mail/use-composer.test.tsx
git commit -m "feat(4c): useComposer (parse adresses + mutation sendMailFn)"
```

---

## Task 12: Composer flottant (`Composer`)

**Files:**
- Create: `src/components/mail/composer.tsx`
- Test: `src/components/mail/composer.test.tsx`

**Interfaces:**
- Consumes : `RteEditor` ; `Icon` ; `ComposerDraft` (`./use-composer`).
- Produces :
  - `interface ComposerProps { initial: ComposerDraft; sending: boolean; onSend: (draft: ComposerDraft) => void; onClose: () => void }`
  - `Composer(props): JSX.Element` — champs À/Cc/Cci/Objet + `RteEditor` + Envoyer/Fermer + modes min/normal/max. **Présentationnel** : aucun hook de route/query ; état local de formulaire seulement.

- [ ] **Step 1: Write the failing test**

`src/components/mail/composer.test.tsx` :

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Composer } from "./composer"
import type { ComposerDraft } from "./use-composer"

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

const initial: ComposerDraft = {
  mode: "compose",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  html: "",
  references: [],
}

describe("Composer", () => {
  it("rend les champs et le bouton Envoyer", () => {
    render(<Composer initial={initial} sending={false} onSend={() => {}} onClose={() => {}} />)
    expect(screen.getByLabelText("mail.compose.to")).toBeInTheDocument()
    expect(screen.getByLabelText("mail.compose.subject")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "mail.compose.send" })).toBeInTheDocument()
  })

  it("envoie le brouillon saisi", () => {
    const onSend = vi.fn()
    render(<Composer initial={initial} sending={false} onSend={onSend} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText("mail.compose.to"), {
      target: { value: "a@b.fr" },
    })
    fireEvent.change(screen.getByLabelText("mail.compose.subject"), {
      target: { value: "Hello" },
    })
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@b.fr", subject: "Hello", mode: "compose" })
    )
  })

  it("désactive Envoyer pendant l'envoi", () => {
    render(<Composer initial={initial} sending={true} onSend={() => {}} onClose={() => {}} />)
    expect(screen.getByRole("button", { name: "mail.compose.send" })).toBeDisabled()
  })

  it("ferme via le bouton fermer", () => {
    const onClose = vi.fn()
    render(<Composer initial={initial} sending={false} onSend={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.close" }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/mail/composer.test.tsx`
Expected: FAIL (`Cannot find module './composer'`).

- [ ] **Step 3: Write minimal implementation**

`src/components/mail/composer.tsx` :

```tsx
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { RteEditor } from "./rte-editor"
import type { ComposerDraft } from "./use-composer"

type Mode = "min" | "normal" | "max"

export interface ComposerProps {
  initial: ComposerDraft
  sending: boolean
  onSend: (draft: ComposerDraft) => void
  onClose: () => void
}

export function Composer({ initial, sending, onSend, onClose }: ComposerProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ComposerDraft>(initial)
  const [showCc, setShowCc] = useState(initial.cc !== "" || initial.bcc !== "")
  const [mode, setMode] = useState<Mode>("normal")
  const set = (patch: Partial<ComposerDraft>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <div className={`composer composer--${mode}`}>
      <div className="composer-head">
        <b>{draft.subject.trim() || t("mail.compose.newMessage")}</b>
        <button
          type="button"
          className="icon-btn sm"
          style={{ marginLeft: "auto" }}
          aria-label={t("mail.compose.minimize")}
          onClick={() => setMode(mode === "min" ? "normal" : "min")}
        >
          <Icon name={mode === "min" ? "expand" : "minimize"} size={16} />
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.maximize")}
          onClick={() => setMode(mode === "max" ? "normal" : "max")}
        >
          <Icon name={mode === "max" ? "shrink" : "expand"} size={15} />
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.close")}
          onClick={onClose}
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      {mode !== "min" && (
        <div className="composer-body-wrap">
          <div className="composer-field">
            <label htmlFor="cmp-to">{t("mail.compose.to")}</label>
            <input
              id="cmp-to"
              aria-label={t("mail.compose.to")}
              value={draft.to}
              onChange={(e) => set({ to: e.target.value })}
            />
            {!showCc && (
              <button type="button" className="icon-btn sm" onClick={() => setShowCc(true)}>
                {t("mail.compose.ccToggle")}
              </button>
            )}
          </div>

          {showCc && (
            <>
              <div className="composer-field">
                <label htmlFor="cmp-cc">{t("mail.compose.cc")}</label>
                <input
                  id="cmp-cc"
                  aria-label={t("mail.compose.cc")}
                  value={draft.cc}
                  onChange={(e) => set({ cc: e.target.value })}
                />
              </div>
              <div className="composer-field">
                <label htmlFor="cmp-bcc">{t("mail.compose.bcc")}</label>
                <input
                  id="cmp-bcc"
                  aria-label={t("mail.compose.bcc")}
                  value={draft.bcc}
                  onChange={(e) => set({ bcc: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="composer-field">
            <label htmlFor="cmp-subject">{t("mail.compose.subject")}</label>
            <input
              id="cmp-subject"
              aria-label={t("mail.compose.subject")}
              value={draft.subject}
              onChange={(e) => set({ subject: e.target.value })}
            />
          </div>

          <RteEditor
            value={draft.html}
            onChange={(html) => set({ html })}
            placeholder={t("mail.compose.bodyPlaceholder")}
            ariaLabel={t("mail.compose.body")}
          />

          <div className="composer-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={sending}
              aria-label={t("mail.compose.send")}
              onClick={() => onSend(draft)}
            >
              <Icon name="send" size={16} /> {t("mail.compose.send")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/mail/composer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/composer.tsx src/components/mail/composer.test.tsx
git commit -m "feat(4c): Composer flottant (présentationnel)"
```

---

## Task 13: Barre quick-reply du Reader (`QuickReply`)

**Files:**
- Create: `src/components/mail/quick-reply.tsx`
- Test: `src/components/mail/quick-reply.test.tsx`
- Modify: `src/components/mail/reader.tsx` (intègre la barre, nouvelle prop `onReply`)

**Interfaces:**
- Consumes : `RteEditor` ; `buildReplyContext` (`../../server/compose-build`) ; `ComposerDraft` (`./use-composer`) ; `AppThreadDetail`.
- Produces :
  - `interface QuickReplyProps { detail: AppThreadDetail; selfEmail: string; sending: boolean; onSend: (draft: ComposerDraft) => void }`
  - `QuickReply(props): JSX.Element` — modes reply/replyAll/forward, pré-rempli via `buildReplyContext`.
- Reader (modifié) : ajoute `onSend?: (draft: ComposerDraft) => void`, `sending?: boolean`, `selfEmail?: string` ; rend `<QuickReply>` sous les messages quand `detail` est chargé.

- [ ] **Step 1: Write the failing test**

`src/components/mail/quick-reply.test.tsx` :

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QuickReply } from "./quick-reply"
import type { AppThreadDetail } from "../../server/mail-types"

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

const detail: AppThreadDetail = {
  threadId: "t1",
  subject: "Sujet",
  messages: [
    {
      id: "m1",
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

describe("QuickReply", () => {
  it("affiche la barre de réponse et passe en mode édition au clic", () => {
    render(<QuickReply detail={detail} selfEmail="me@x.fr" sending={false} onSend={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    expect(screen.getByLabelText("mail.compose.body")).toBeInTheDocument()
  })

  it("envoie un brouillon de réponse pré-rempli (mode reply, objet Re:)", () => {
    const onSend = vi.fn()
    render(<QuickReply detail={detail} selfEmail="me@x.fr" sending={false} onSend={onSend} />)
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.send" }))
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "reply", to: "Alice <alice@x.fr>", subject: "Re: Sujet" })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/mail/quick-reply.test.tsx`
Expected: FAIL (`Cannot find module './quick-reply'`).

- [ ] **Step 3: Write minimal implementation**

`src/components/mail/quick-reply.tsx` :

```tsx
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon } from "./mail-icons"
import { RteEditor } from "./rte-editor"
import { buildReplyContext, type ComposeMode } from "../../server/compose-build"
import type { AppThreadDetail, MailAddress } from "../../server/mail-types"
import type { ComposerDraft } from "./use-composer"

export interface QuickReplyProps {
  detail: AppThreadDetail
  selfEmail: string
  sending: boolean
  onSend: (draft: ComposerDraft) => void
}

function formatAddrs(addrs: MailAddress[]): string {
  return addrs.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")
}

export function QuickReply({ detail, selfEmail, sending, onSend }: QuickReplyProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ComposerDraft | null>(null)

  function open(mode: ComposeMode) {
    const ctx = buildReplyContext(detail, mode, selfEmail)
    setDraft({
      mode,
      to: formatAddrs(ctx.to),
      cc: formatAddrs(ctx.cc),
      bcc: "",
      subject: ctx.subject,
      html: ctx.quotedHtml,
      inReplyTo: ctx.inReplyTo,
      references: ctx.references,
    })
  }

  if (!draft) {
    return (
      <div className="reply-bar">
        <button
          type="button"
          className="reply-bar-main"
          aria-label={t("mail.compose.reply")}
          onClick={() => open("reply")}
        >
          <Icon name="reply" size={16} /> {t("mail.compose.reply")}
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.replyAll")}
          onClick={() => open("replyAll")}
        >
          <Icon name="replyAll" size={17} />
        </button>
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.forward")}
          onClick={() => open("forward")}
        >
          <Icon name="forward" size={17} />
        </button>
      </div>
    )
  }

  const set = (patch: Partial<ComposerDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  return (
    <div className="quick-reply">
      <div className="composer-field">
        <label htmlFor="qr-to">{t("mail.compose.to")}</label>
        <input
          id="qr-to"
          aria-label={t("mail.compose.to")}
          value={draft.to}
          onChange={(e) => set({ to: e.target.value })}
        />
      </div>
      <RteEditor
        value={draft.html}
        onChange={(html) => set({ html })}
        ariaLabel={t("mail.compose.body")}
      />
      <div className="composer-actions">
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("mail.compose.close")}
          onClick={() => setDraft(null)}
        >
          <Icon name="x" size={16} />
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={sending}
          aria-label={t("mail.compose.send")}
          onClick={() => onSend(draft)}
        >
          <Icon name="send" size={16} /> {t("mail.compose.send")}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Intégrer dans `reader.tsx`**

Ajouter à `ReaderProps` : `onSend?: (draft: ComposerDraft) => void`, `sending?: boolean`, `selfEmail?: string`. Importer `QuickReply` et `ComposerDraft`. Dans le rendu du fil chargé (après la liste des `MessageItem`), insérer :

```tsx
{detail && onSend && (
  <QuickReply
    detail={detail}
    selfEmail={selfEmail ?? ""}
    sending={sending ?? false}
    onSend={onSend}
  />
)}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test src/components/mail/quick-reply.test.tsx src/components/mail/reader.test.tsx`
Expected: PASS (les tests Reader existants restent verts — nouvelles props optionnelles).

- [ ] **Step 6: Commit**

```bash
git add src/components/mail/quick-reply.tsx src/components/mail/quick-reply.test.tsx src/components/mail/reader.tsx
git commit -m "feat(4c): QuickReply dans le Reader (reply/replyAll/forward)"
```

---

## Task 14: Câblage (i18n, sidebar, route) + montage du Composer

**Files:**
- Modify: `src/i18n/resources.ts` (clés `mail.compose.*` fr + en)
- Modify: `src/components/mail/sidebar.tsx` (active le bouton, prop `onCompose`)
- Modify: `src/components/mail/index.ts` (exports)
- Modify: `src/routes/mail/$folder.tsx` (état d'ouverture, montage `Composer`, câblage Reader)
- Test: `src/routes/mail/$folder.test.tsx` (ouverture du composer)

**Interfaces:**
- Consumes : tout ce qui précède.
- Produces : Composer monté en overlay ; bouton « Nouveau message » fonctionnel ; quick-reply câblé au Reader.

- [ ] **Step 1: Ajouter les clés i18n** (`src/i18n/resources.ts`, dans `mail:` de `fr`, et le miroir `en`)

```ts
compose: {
  newMessage: 'Nouveau message',
  to: 'À',
  cc: 'Cc',
  bcc: 'Cci',
  ccToggle: 'Cc/Cci',
  subject: 'Objet',
  body: 'Corps du message',
  bodyPlaceholder: 'Écrivez votre message…',
  send: 'Envoyer',
  close: 'Fermer',
  minimize: 'Réduire',
  maximize: 'Plein écran',
  reply: 'Répondre',
  replyAll: 'Répondre à tous',
  forward: 'Transférer',
  bold: 'Gras',
  italic: 'Italique',
  link: 'Insérer un lien',
  linkPrompt: 'Adresse du lien (https://…)',
  bulletList: 'Liste à puces',
  numberList: 'Liste numérotée',
  sent: 'Message envoyé',
  error: "L'envoi a échoué",
  invalidRecipients: 'Une adresse destinataire est invalide',
  noRecipient: 'Ajoutez au moins un destinataire',
},
```

(miroir `en` avec traductions anglaises — structure identique.)

- [ ] **Step 2: Activer le bouton dans `sidebar.tsx`**

Remplacer le bouton `disabled` par un bouton câblé à une nouvelle prop `onCompose?: () => void` :

```tsx
<button
  className="compose-btn"
  onClick={onCompose}
  disabled={!onCompose}
  aria-label={t('mail.compose')}
>
  <Icon name="compose" size={16} />
  {t('mail.compose')}
</button>
```

Ajouter `onCompose?: () => void` à la signature des props de `AppSidebar`.

- [ ] **Step 3: Exporter dans `index.ts`**

```ts
export { Composer } from "./composer"
export { QuickReply } from "./quick-reply"
export { useComposer } from "./use-composer"
export { RteEditor } from "./rte-editor"
```

- [ ] **Step 4: Monter le Composer dans `$folder.tsx`**

Dans `MailPage` :
- Ajouter un état `const [composeOpen, setComposeOpen] = useState(false)`.
- `const composer = useComposer(folder)`.
- Passer `onCompose={() => setComposeOpen(true)}` à `AppSidebar`.
- Dans `overlay`, après `<ToastViewport />`, monter :

```tsx
{composeOpen && (
  <Composer
    initial={{ mode: "compose", to: "", cc: "", bcc: "", subject: "", html: "", references: [] }}
    sending={composer.sending}
    onSend={async (draft) => {
      const ok = await composer.send(draft)
      if (ok) setComposeOpen(false)
    }}
    onClose={() => setComposeOpen(false)}
  />
)}
```

- Dans `ReaderPane`, passer au `<Reader>` les props `selfEmail`, `sending={composer.send ? ...}` et `onSend` (réutiliser le même `useComposer(folder)` — l'instancier dans `ReaderPane` ou le remonter). **Décision** : instancier `useComposer(folder)` dans `ReaderPane` et passer `onSend`/`sending` au Reader ; `selfEmail` vient du loader de session si disponible, sinon `""` (le serveur recalcule l'identité — `selfEmail` ne sert qu'au filtrage replyAll côté UI).

- [ ] **Step 5: Write the failing test** (`$folder.test.tsx`)

```tsx
it("ouvre le Composer au clic sur Nouveau message", async () => {
  // rendre MailPage avec les mocks existants du fichier
  fireEvent.click(screen.getByRole("button", { name: /nouveau message/i }))
  expect(await screen.findByLabelText("À")).toBeInTheDocument()
})
```

(Adapter aux helpers/mocks déjà en place dans `$folder.test.tsx`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test src/routes/mail/$folder.test.tsx`
Expected: PASS.

- [ ] **Step 7: Full suite + lint + typecheck**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: tout vert.

- [ ] **Step 8: Commit**

```bash
git add src/i18n/resources.ts src/components/mail/sidebar.tsx src/components/mail/index.ts src/routes/mail/$folder.tsx src/routes/mail/$folder.test.tsx
git commit -m "feat(4c): câblage Composer (sidebar, route, i18n, quick-reply)"
```

---

## Self-Review

**Spec coverage** (vérifié contre `2026-06-21-plan-4c-composer-design.md`) :
- §2 périmètre (compose/reply/replyAll/forward, HTML minimal, 2 surfaces, IA stub) → Tasks 3, 10, 12, 13. **IA stub** : le bouton « Générer un brouillon » de la maquette n'est PAS porté en 4c (hors scope du plan — aucune régression, simple non-ajout). À noter explicitement si on veut le bouton désactivé visible : non inclus.
- §3.2 chaîne JMAP (Identity/Email/EmailSubmission + onSuccessUpdateEmail) → Tasks 4, 5.
- §3.3 capability submission + résolution role → Tasks 7, 9.
- §4 fonctions pures → Tasks 1–6.
- §5 server function + Zod durci → Task 9.
- §6 sécurité (B1–B4, R1–R6) → couvert : B1 (Tasks 3, 10), B2 (Task 1), B3 (Tasks 2, 9), B4 (Tasks 8, 9), R1 (Tasks 4, 5, 9), R2 (Task 5), R5 (Task 7), R6 (Task 6, 9).
- §7 UI → Tasks 10, 12, 13, 14.
- §8 erreurs → Tasks 9 (serveur générique), 11 (toasts), 6 (codes).
- §9 tests → chaque task porte ses tests.

**Placeholder scan** : pas de "TODO/TBD". Les "Décision" et "Prérequis" inline tranchent les points ouverts (icônes, blockquote, session.email, instanciation hook) avec une consigne exécutable.

**Type consistency** : `ComposeMode`, `ComposerDraft`, `SendBody`, `ReplyContext`, `SendIdentity`, `SendResult` sont définis une fois (Tasks 3–6) et réutilisés avec les mêmes noms en Tasks 9–13. `sendMailFn({ data })` cohérent entre Task 9 (définition) et Task 11 (appel). `jmapUserCall(sid, calls, caps?)` cohérent Tasks 7/9.

**Limites connues 4c à porter en revue** : transfert sans réémission des pièces jointes d'origine (upload hors scope) ; `selfEmail` côté UI best-effort (le serveur fait foi pour l'identité) ; `blockquote` non stylé (allowlist minimale) ; rate-limit in-memory mono-process (reset au redémarrage, comme `login-rate-limit`).

**Audit sécurité du plan** (intégré, voir `docs/superpowers/reviews/2026-06-21-plan-4c-security-review.md` §Plan) :
- **P1** (Task 1/10) — sanitisation découplée (frappe = brut, collage + injection citation = sanitisés) ; `compose-html.ts` déplacé dans `src/lib/` (hors frontière BFF).
- **P2** (Task 9) — clé de rate-limit = `accountId` (`currentSession` n'expose pas d'email) ; plus de chaîne vide partagée.
- Durcissements intégrés : R-B (regex name), R-C (tests mailto + note hook global), R-E (test fail-closed), R-F (garde anti-double-soumission), `bun audit` (Task 1).

---

## Execution Handoff

**Plan complet et sauvegardé dans `docs/superpowers/plans/2026-06-21-plan-4c-composer.md`.**
