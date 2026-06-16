# Plan 4b — Reader & Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter le lecteur de fil (3ᵉ colonne) en lecture seule et 5 actions (favori, lu/non-lu, archiver, corbeille, spam) au webmail Stalmail.

**Architecture:** Server functions BFF typées (Zod) appellent `jmapUserCall` ; toute la logique JMAP (build des `methodCalls`, parsing des réponses, rendu sûr du corps) vit dans des fonctions **pures testées**. Le corps HTML d'email est rendu dans une `<iframe sandbox="">` opaque + CSP. Les actions opèrent au niveau du fil et réconcilient le cache TanStack Query (optimiste pour star/read, invalidation pour les déplacements).

**Tech Stack:** TanStack Start (server functions), TanStack Query/Router, React 19, Zod 4, react-i18next, Vitest + Testing Library, Bun.

**Référence design :** `docs/superpowers/specs/2026-06-15-plan-4b-reader-actions-design.md` + revue sécurité `docs/superpowers/reviews/2026-06-15-plan-4b-security-review.md`.

**Commandes (Bun, jamais npm) :** `bun run test`, `bun run lint`, `bun run typecheck`. Tests serveur en env node (`src/server/**`), tests composants en jsdom (`src/components/**`, `src/routes/**`). Le pre-commit lance `lint && typecheck && test` ; ne pas le contourner.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/server/mail-types.ts` *(MOD)* | + `MailBodyPart`, `AppAttachment`, `AppMessage`, `AppThreadDetail` |
| `src/components/mail/email-body.ts` *(NEW)* | Pur : `pickBody`, `blockRemoteImages`, `sanitizeLinks`, `buildFrameDoc`, `hasRemoteImages` |
| `src/server/mail-actions.ts` *(MOD)* | + `parseThreadDetail`/`readThreadFn`, `buildSetFlagsCall`/`setFlagsFn`, `buildMoveCall`/`moveThreadFn` |
| `src/components/mail/toast.tsx` *(NEW)* | `ToastProvider` + `useToast()` (réutilise `.toast`/`.toast-wrap`) |
| `src/components/mail/mail-icons.tsx` *(MOD)* | + icônes : `archive`, `trash2`, `mail-open`, `more-v`, `chev-left`, `spam`, `reply`, `reply-all`, `forward`, `download`, `chev-down`, `x`, `clock`, `pin`, `send` |
| `src/components/mail/use-thread-actions.ts` *(NEW)* | Hook mutations optimistes (star, read, move) + réconciliation cache |
| `src/components/mail/message-item.tsx` *(NEW)* | Un message : en-tête repliable, corps (texte/iframe), pièces jointes |
| `src/components/mail/reader.tsx` *(NEW)* | Lecteur : reader-bar + thread-head + liste `MessageItem` + reply-bar disabled |
| `src/components/mail/layout.tsx` *(MOD)* | Slot reader : prop `reader?: ReactNode` |
| `src/components/mail/index.ts` *(MOD)* | + exports `Reader`, `MessageItem`, `ToastProvider`, `useToast` |
| `src/routes/mail/$folder.tsx` *(MOD)* | `validateSearch` `?thread`, montage Reader + query `readThreadFn`, fermeture, `ToastProvider` |
| `src/i18n/resources.ts` *(MOD)* | + `mail.reader.*` et `mail.actions.*` (dans `fr` ET `en`) |
| `src/components/mail/mail.css` *(MOD)* | `.img-block-banner`, `.msg-html-frame` |

Chaque fonction pure est testée dans un `*.test.ts` co-localisé ; chaque composant dans un `*.test.tsx`.

---

## Task 1 : Types partagés (`mail-types.ts`)

**Files:**
- Modify: `src/server/mail-types.ts` (ajouter à la fin, avant la dernière accolade du module)

- [ ] **Step 1 : Ajouter les types**

Ajouter à la fin de `src/server/mail-types.ts` (après l'interface `EmailListPage`) :

```ts
export interface MailBodyPart {
  partId?: string
  type: string // 'text/plain' | 'text/html' | …
  value?: string // résolu depuis bodyValues
}

export interface AppAttachment {
  blobId: string
  name: string
  type: string
  size: number
}

export interface AppMessage {
  id: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  receivedAt: string // ISO 8601
  unread: boolean
  hasAttachment: boolean
  textBody: string | null
  htmlBody: string | null
  attachments: AppAttachment[]
}

export interface AppThreadDetail {
  threadId: string
  subject: string
  messages: AppMessage[] // ordre chronologique (selon emailIds du Thread)
  emailIds: string[] // pour les actions au niveau fil
  starred: boolean // agrégat ($flagged sur au moins un message)
  unread: boolean // agrégat (au moins un message non lu)
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `bun run typecheck`
Expected: PASS (aucune erreur).

- [ ] **Step 3 : Commit**

```bash
git add src/server/mail-types.ts
git commit -m "feat(4b): types AppMessage/AppThreadDetail/AppAttachment"
```

---

## Task 2 : Module pur de rendu du corps (`email-body.ts`)

Sécurité (cf. design §2.7) : l'anti-XSS repose sur l'iframe `sandbox=""` + CSP (Task 8). `blockRemoteImages` est **anti-traceur** ; `sanitizeLinks` est de la défense en profondeur.

**Files:**
- Create: `src/components/mail/email-body.ts`
- Test: `src/components/mail/email-body.test.ts`

> NOTE env de test : ce fichier est un module **pur** (pas de DOM). Mais les tests `src/components/**` tournent en jsdom (cf. `vitest.config.ts`). C'est sans incidence — les fonctions n'utilisent pas le DOM.

- [ ] **Step 1 : Écrire les tests (échouent)**

Créer `src/components/mail/email-body.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import {
  pickBody,
  blockRemoteImages,
  sanitizeLinks,
  buildFrameDoc,
  hasRemoteImages,
} from './email-body'

describe('pickBody', () => {
  it('préfère le texte quand présent', () => {
    expect(pickBody({ textBody: 'salut', htmlBody: '<b>hi</b>' })).toEqual({ kind: 'text', content: 'salut' })
  })
  it('repli sur html si texte vide/espaces', () => {
    expect(pickBody({ textBody: '   ', htmlBody: '<b>hi</b>' })).toEqual({ kind: 'html', content: '<b>hi</b>' })
  })
  it('texte vide si les deux sont vides', () => {
    expect(pickBody({ textBody: null, htmlBody: null })).toEqual({ kind: 'text', content: '' })
  })
})

describe('blockRemoteImages', () => {
  it('neutralise un src http(s) distant', () => {
    expect(blockRemoteImages('<img src="https://tracker/x.png">')).not.toContain('https://tracker')
  })
  it('neutralise un src distant SANS guillemets', () => {
    expect(blockRemoteImages('<img src=https://tracker/x.png>')).not.toContain('https://tracker')
  })
  it('neutralise un srcset distant', () => {
    expect(blockRemoteImages('<img srcset="https://t/x.png 2x">')).not.toContain('https://t')
  })
  it('neutralise une url() CSS distante', () => {
    expect(blockRemoteImages('<div style="background:url(http://t/a.png)">')).not.toContain('http://t')
  })
  it('préserve data: et cid:', () => {
    const html = '<img src="data:image/png;base64,AAA"><img src="cid:logo">'
    const out = blockRemoteImages(html)
    expect(out).toContain('data:image/png')
    expect(out).toContain('cid:logo')
  })
})

describe('sanitizeLinks', () => {
  it('ajoute rel="noopener noreferrer"', () => {
    expect(sanitizeLinks('<a href="https://x.com">x</a>')).toContain('rel="noopener noreferrer"')
  })
  it('neutralise javascript: / data: / vbscript:', () => {
    expect(sanitizeLinks('<a href="javascript:alert(1)">x</a>')).toContain('href="#"')
    expect(sanitizeLinks('<a href="vbscript:x">x</a>')).toContain('href="#"')
  })
  it('conserve https et mailto', () => {
    expect(sanitizeLinks('<a href="mailto:a@b.c">m</a>')).toContain('mailto:a@b.c')
  })
})

describe('buildFrameDoc', () => {
  it('inclut la balise CSP default-src none', () => {
    const doc = buildFrameDoc('<p>x</p>', { showImages: false })
    expect(doc).toContain("default-src 'none'")
    expect(doc).toMatch(/<!doctype html>/i)
  })
  it('bloque les images si showImages=false', () => {
    expect(buildFrameDoc('<img src="https://t/x.png">', { showImages: false })).not.toContain('https://t')
  })
  it('garde les images distantes si showImages=true', () => {
    expect(buildFrameDoc('<img src="https://t/x.png">', { showImages: true })).toContain('https://t')
  })
})

describe('hasRemoteImages', () => {
  it('détecte un img distant', () => {
    expect(hasRemoteImages('<img src="https://t/x.png">')).toBe(true)
  })
  it('détecte un src sans guillemets et un srcset distant', () => {
    expect(hasRemoteImages('<img src=https://t/x.png>')).toBe(true)
    expect(hasRemoteImages('<img srcset="https://t/x.png 2x">')).toBe(true)
  })
  it('faux si seulement data:/cid:', () => {
    expect(hasRemoteImages('<img src="data:image/png;base64,AAA">')).toBe(false)
  })
})
```

- [ ] **Step 2 : Lancer les tests (échec attendu)**

Run: `bun run test -- email-body`
Expected: FAIL (module `./email-body` introuvable).

- [ ] **Step 3 : Implémenter le module**

Créer `src/components/mail/email-body.ts` :

```ts
// Rendu sûr du corps d'email. L'anti-XSS réel = iframe sandbox="" + CSP (cf. message-item).
// Ici : choix texte/html (pur), blocage des ressources distantes (anti-traceur),
// assainissement des liens (défense en profondeur), assemblage du document srcdoc.

const FRAME_CSP = "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'"

export function pickBody(msg: { textBody: string | null; htmlBody: string | null }): {
  kind: 'text' | 'html'
  content: string
} {
  if (msg.textBody && msg.textBody.trim() !== '') return { kind: 'text', content: msg.textBody }
  if (msg.htmlBody && msg.htmlBody.trim() !== '') return { kind: 'html', content: msg.htmlBody }
  return { kind: 'text', content: '' }
}

// IMPORTANT (F1/F2) : la garantie réelle (blocage réseau + non-exécution) vient de l'iframe
// sandbox="" + CSP `default-src 'none'; img-src data: cid:` (cf. buildFrameDoc / message-item).
// Les fonctions ci-dessous sont best-effort / anti-traceur / défense en profondeur — PAS la
// barrière de sécurité primaire. Elles couvrent les cas courants, pas l'exhaustivité du HTML.

// Neutralise src/srcset/background/url() distants (http/https/protocole-relatif), avec ou sans
// guillemets. Préserve data: et cid:.
export function blockRemoteImages(html: string): string {
  return html
    .replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["']?)(?:https?:|\/\/)[^\s"'>]*\2/gi, '$1$2$2')
    .replace(/(<(?:img|source)\b[^>]*?\bsrcset\s*=\s*)(["'])[^"']*\2/gi, '$1$2$2')
    .replace(/(\bbackground\s*=\s*)(["']?)(?:https?:|\/\/)[^\s"'>]*\2/gi, '$1$2$2')
    .replace(/url\(\s*(['"]?)(?:https?:|\/\/)[^)]*\1\s*\)/gi, 'url()')
}

// <a> : force rel="noopener noreferrer" et neutralise les schémas dangereux (avec/sans
// guillemets). Best-effort (cf. note ci-dessus) ; l'iframe sandbox bloque déjà l'exécution.
export function sanitizeLinks(html: string): string {
  return html.replace(/<a\b([^>]*?)>/gi, (_full, attrs: string) => {
    let a = attrs.replace(/\bhref\s*=\s*(["']?)\s*(?:javascript|data|vbscript):[^\s"'>]*\1/gi, 'href="#"')
    a = a.replace(/\srel\s*=\s*(["'])[^"']*\1/gi, '')
    return `<a${a} rel="noopener noreferrer">`
  })
}

// Détecte des ressources distantes (img src/srcset, url()) pour afficher le bandeau.
export function hasRemoteImages(html: string): boolean {
  return (
    /<img\b[^>]*\bsrc\s*=\s*["']?(?:https?:|\/\/)/i.test(html) ||
    /\bsrcset\s*=\s*["']?[^>]*(?:https?:|\/\/)/i.test(html) ||
    /url\(\s*["']?(?:https?:|\/\/)/i.test(html)
  )
}

// Assemble le document injecté dans <iframe srcdoc> : CSP + liens assainis + images (selon showImages).
export function buildFrameDoc(html: string, opts: { showImages: boolean }): string {
  let body = sanitizeLinks(html)
  if (!opts.showImages) body = blockRemoteImages(body)
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"></head><body>${body}</body></html>`
}
```

- [ ] **Step 4 : Lancer les tests (succès attendu)**

Run: `bun run test -- email-body`
Expected: PASS (tous les `describe`).

- [ ] **Step 5 : Commit**

```bash
git add src/components/mail/email-body.ts src/components/mail/email-body.test.ts
git commit -m "feat(4b): email-body pur (pickBody, blockRemoteImages, sanitizeLinks, buildFrameDoc)"
```

---

## Task 3 : Server function `readThreadFn` + parser pur

**Files:**
- Modify: `src/server/mail-actions.ts`
- Test: `src/server/mail-actions.test.ts` (ajouter des `describe`)

Rappel structure JMAP `Email/get` : `textBody`/`htmlBody` sont des tableaux de *parts* `{ partId, type }` ; le contenu est dans `bodyValues[partId].value`. `attachments` est un tableau `{ blobId, name, type, size }`.

- [ ] **Step 1 : Écrire les tests du parser (échouent)**

Ajouter à `src/server/mail-actions.test.ts` :

```ts
// Import unique en tête de mail-actions.test.ts pour les describe ajoutés (Tasks 3, 4, 5) :
import {
  parseThreadDetail,
  buildSetFlagsCall,
  buildMovePatch,
  parseEmailMailboxes,
  resolveTargetMailbox,
} from './mail-actions'

describe('parseThreadDetail', () => {
  const responses: JmapMethodResponse[] = [
    ['Thread/get', { list: [{ id: 't1', emailIds: ['e1', 'e2'] }] }, '0'],
    [
      'Email/get',
      {
        list: [
          {
            id: 'e2',
            from: [{ name: 'Bob', email: 'bob@x.io' }],
            to: [{ name: 'Moi', email: 'me@x.io' }],
            cc: null,
            subject: 'Re: sujet',
            receivedAt: '2026-06-10T10:00:00Z',
            keywords: { $seen: true },
            hasAttachment: false,
            textBody: [{ partId: 'p1', type: 'text/plain' }],
            htmlBody: [{ partId: 'p2', type: 'text/html' }],
            bodyValues: { p1: { value: 'texte e2' }, p2: { value: '<b>e2</b>' } },
            attachments: [],
          },
          {
            id: 'e1',
            from: [{ name: 'Alice', email: 'alice@x.io' }],
            to: [{ name: 'Moi', email: 'me@x.io' }],
            cc: [{ name: 'Cc', email: 'cc@x.io' }],
            subject: 'sujet',
            receivedAt: '2026-06-09T09:00:00Z',
            keywords: {},
            hasAttachment: true,
            textBody: [{ partId: 'q1', type: 'text/plain' }],
            htmlBody: [],
            bodyValues: { q1: { value: 'texte e1' } },
            attachments: [{ blobId: 'b1', name: 'cv.pdf', type: 'application/pdf', size: 1234 }],
          },
        ],
      },
      '1',
    ],
  ]

  it('ordonne les messages selon emailIds du Thread', () => {
    const d = parseThreadDetail(responses)
    expect(d.messages.map((m) => m.id)).toEqual(['e1', 'e2'])
  })
  it('résout le corps depuis bodyValues', () => {
    const d = parseThreadDetail(responses)
    expect(d.messages[0].textBody).toBe('texte e1')
    expect(d.messages[1].htmlBody).toBe('<b>e2</b>')
  })
  it('calcule les agrégats unread/starred et emailIds', () => {
    const d = parseThreadDetail(responses)
    expect(d.threadId).toBe('t1')
    expect(d.emailIds).toEqual(['e1', 'e2'])
    expect(d.unread).toBe(true) // e1 n'a pas $seen
    expect(d.starred).toBe(false)
    expect(d.subject).toBe('sujet') // sujet du 1er message chronologique
  })
  it('normalise cc null en [] et attachments manquants en []', () => {
    const d = parseThreadDetail(responses)
    expect(d.messages[1].cc).toEqual([])
    expect(d.messages[0].attachments).toHaveLength(1)
  })
  it('résiste aux réponses vides', () => {
    expect(parseThreadDetail([])).toEqual({
      threadId: '',
      subject: '',
      messages: [],
      emailIds: [],
      starred: false,
      unread: false,
    })
  })
})
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `bun run test -- mail-actions`
Expected: FAIL (`parseThreadDetail` non exporté).

- [ ] **Step 3 : Implémenter le parser + la server fn**

Dans `src/server/mail-actions.ts` : ajouter l'import de type, le parser pur, et la server fn. D'abord compléter l'import de types existant en tête de fichier pour inclure les nouveaux types :

```ts
import type { AppMailbox, AppThread, AppThreadDetail, AppMessage, AppAttachment, EmailListPage, MailAddress } from './mail-types'
```

Ajouter le parser pur et ses helpers (après `parseListPage`) :

```ts
interface RawBodyPart {
  partId?: string
  type?: string
}
interface RawDetailEmail {
  id: string
  from?: MailAddress[] | null
  to?: MailAddress[] | null
  cc?: MailAddress[] | null
  subject?: string
  receivedAt?: string
  keywords?: Record<string, boolean>
  hasAttachment?: boolean
  textBody?: RawBodyPart[]
  htmlBody?: RawBodyPart[]
  bodyValues?: Record<string, { value?: string }>
  attachments?: { blobId: string; name?: string; type?: string; size?: number }[]
}

// Pur : résout le 1er part d'un type donné en sa valeur texte (via bodyValues).
function resolveBody(parts: RawBodyPart[] | undefined, values: RawDetailEmail['bodyValues']): string | null {
  const first = Array.isArray(parts) ? parts[0] : undefined
  if (!first?.partId) return null
  const v = values?.[first.partId]?.value
  return typeof v === 'string' && v !== '' ? v : null
}

// Pur : batch readThread.
export function buildReadThreadCalls(accountId: string, threadId: string): JmapMethodCall[] {
  return [
    ['Thread/get', { accountId, ids: [threadId] }, '0'],
    [
      'Email/get',
      {
        accountId,
        '#ids': { resultOf: '0', name: 'Thread/get', path: '/list/*/emailIds' },
        properties: [
          'id', 'mailboxIds', 'keywords', 'from', 'to', 'cc',
          'subject', 'receivedAt', 'hasAttachment',
          'textBody', 'htmlBody', 'bodyValues', 'attachments',
        ],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
        maxBodyValueBytes: 256000,
      },
      '1',
    ],
  ]
}

// Pur : assemble AppThreadDetail depuis Thread/get + Email/get.
export function parseThreadDetail(responses: JmapMethodResponse[]): AppThreadDetail {
  const thread = (responses.find(([n]) => n === 'Thread/get')?.[1].list?.[0] ?? undefined) as
    | { id?: string; emailIds?: string[] }
    | undefined
  const threadId = thread?.id ?? ''
  const emailIds = Array.isArray(thread?.emailIds) ? thread!.emailIds! : []

  const rawList = responses.find(([n]) => n === 'Email/get')?.[1].list
  const list: RawDetailEmail[] = Array.isArray(rawList) ? (rawList as RawDetailEmail[]) : []
  const byId = new Map(list.map((e) => [e.id, e]))
  // Ordre chronologique = ordre des emailIds du Thread (sinon ordre brut).
  const ordered: RawDetailEmail[] = emailIds.length
    ? emailIds.map((id) => byId.get(id)).filter((e): e is RawDetailEmail => e !== undefined)
    : list

  const messages: AppMessage[] = ordered.map((e) => ({
    id: e.id,
    from: e.from ?? [],
    to: e.to ?? [],
    cc: e.cc ?? [],
    subject: e.subject ?? '',
    receivedAt: e.receivedAt ?? '',
    unread: (e.keywords ?? {}).$seen !== true,
    hasAttachment: e.hasAttachment === true,
    textBody: resolveBody(e.textBody, e.bodyValues),
    htmlBody: resolveBody(e.htmlBody, e.bodyValues),
    attachments: (e.attachments ?? []).map(
      (a): AppAttachment => ({
        blobId: a.blobId,
        name: a.name ?? 'pièce jointe',
        type: a.type ?? 'application/octet-stream',
        size: a.size ?? 0,
      }),
    ),
  }))

  return {
    threadId,
    subject: messages[0]?.subject ?? '',
    messages,
    emailIds,
    starred: list.some((e) => (e.keywords ?? {}).$flagged === true),
    unread: messages.some((m) => m.unread),
  }
}
```

Ajouter la server function (après `emailListFn`) :

```ts
const readThreadSchema = z.object({ threadId: z.string().min(1).max(64) })

// READ-ONLY (invariant design §2.5) : aucun Email/set ici.
export const readThreadFn = createServerFn({ method: 'GET' })
  .validator((d: { threadId: string }) => readThreadSchema.parse(d))
  .handler(async ({ data }): Promise<AppThreadDetail> => {
    const { jmapUserCall } = await import('./jmap-user')
    const { sid, accountId } = await requireSession()
    const responses = await jmapUserCall(sid, buildReadThreadCalls(accountId, data.threadId))
    return parseThreadDetail(responses)
  })
```

> **Note sécurité (F5, A04 — risque accepté)** : `maxBodyValueBytes: 256000` borne chaque corps, mais le nombre de messages d'un fil n'est pas plafonné (`#ids` résout tous les `emailIds`). Risque DoS jugé faible (un fil reste borné en pratique) ; **accepté pour la 4b**. Si un plafonnement s'avère nécessaire, l'ajouter ici (slice des `emailIds` côté serveur).

- [ ] **Step 4 : Lancer (succès attendu)**

Run: `bun run test -- mail-actions`
Expected: PASS.

- [ ] **Step 5 : typecheck + commit**

Run: `bun run typecheck` → PASS

```bash
git add src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(4b): readThreadFn + parseThreadDetail (lecture read-only du fil)"
```

---

## Task 4 : Server function `setFlagsFn` (favori / lu)

**Files:**
- Modify: `src/server/mail-actions.ts`
- Test: `src/server/mail-actions.test.ts`

- [ ] **Step 1 : Écrire les tests (échouent)**

Ajouter à `src/server/mail-actions.test.ts` :

```ts
describe('buildSetFlagsCall', () => {
  it('positionne le keyword à true', () => {
    expect(buildSetFlagsCall('acc', ['e1', 'e2'], '$seen', true)).toEqual([
      ['Email/set', { accountId: 'acc', update: { e1: { 'keywords/$seen': true }, e2: { 'keywords/$seen': true } } }, '0'],
    ])
  })
  it('retire le keyword avec null quand value=false', () => {
    expect(buildSetFlagsCall('acc', ['e1'], '$flagged', false)).toEqual([
      ['Email/set', { accountId: 'acc', update: { e1: { 'keywords/$flagged': null } } }, '0'],
    ])
  })
})
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `bun run test -- mail-actions`
Expected: FAIL (`buildSetFlagsCall` non exporté).

- [ ] **Step 3 : Implémenter**

Dans `src/server/mail-actions.ts` :

```ts
type MailFlag = '$seen' | '$flagged'

// Pur : Email/set qui patch un keyword sur plusieurs emails (true=ajoute, false=retire via null).
export function buildSetFlagsCall(
  accountId: string,
  emailIds: string[],
  flag: MailFlag,
  value: boolean,
): JmapMethodCall[] {
  const patch = value ? true : null
  const update: Record<string, Record<string, true | null>> = {}
  for (const id of emailIds) update[id] = { [`keywords/${flag}`]: patch }
  return [['Email/set', { accountId, update }, '0']]
}

const emailIdsSchema = z.array(z.string().min(1).max(64)).min(1).max(500)
const setFlagsSchema = z.object({
  emailIds: emailIdsSchema,
  flag: z.enum(['$seen', '$flagged']),
  value: z.boolean(),
})

export const setFlagsFn = createServerFn({ method: 'POST' })
  .validator((d: { emailIds: string[]; flag: MailFlag; value: boolean }) => setFlagsSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { jmapUserCall } = await import('./jmap-user')
    const { sid, accountId } = await requireSession()
    await jmapUserCall(sid, buildSetFlagsCall(accountId, data.emailIds, data.flag, data.value))
    return { ok: true }
  })
```

- [ ] **Step 4 : Lancer (succès attendu)**

Run: `bun run test -- mail-actions`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(4b): setFlagsFn (favori / lu-non-lu via keywords)"
```

---

## Task 5 : Server function `moveThreadFn` (archiver / corbeille / spam)

**Files:**
- Modify: `src/server/mail-actions.ts`
- Test: `src/server/mail-actions.test.ts`

- [ ] **Step 1 : Écrire les tests (échouent)**

Ajouter à `src/server/mail-actions.test.ts` :

```ts
const MOVE_MBX = [
  { id: 'mi', role: 'inbox' },
  { id: 'ma', role: 'archive' },
  { id: 'lbl', role: null }, // label (4d) — doit être préservé
]

describe('buildMovePatch', () => {
  it('retire les dossiers système actuels et ajoute la cible (patch ciblé)', () => {
    expect(buildMovePatch('acc', [{ id: 'e1', mailboxIds: ['mi'] }], MOVE_MBX, 'ma')).toEqual([
      ['Email/set', { accountId: 'acc', update: { e1: { 'mailboxIds/ma': true, 'mailboxIds/mi': null } } }, '0'],
    ])
  })
  it('préserve les mailboxes sans role (labels) — ne les met pas à null', () => {
    const out = buildMovePatch('acc', [{ id: 'e1', mailboxIds: ['mi', 'lbl'] }], MOVE_MBX, 'ma')
    const patch = (out[0][1] as { update: Record<string, Record<string, unknown>> }).update.e1
    expect(patch).toEqual({ 'mailboxIds/ma': true, 'mailboxIds/mi': null })
    expect(patch['mailboxIds/lbl']).toBeUndefined()
  })
  it('idempotent si déjà dans la cible', () => {
    expect(buildMovePatch('acc', [{ id: 'e1', mailboxIds: ['ma'] }], MOVE_MBX, 'ma')).toEqual([
      ['Email/set', { accountId: 'acc', update: { e1: { 'mailboxIds/ma': true } } }, '0'],
    ])
  })
})

describe('parseEmailMailboxes', () => {
  it('extrait {id, mailboxIds[]} depuis Email/get', () => {
    const responses: JmapMethodResponse[] = [
      ['Email/get', { list: [{ id: 'e1', mailboxIds: { mi: true, lbl: true } }] }, '0'],
    ]
    expect(parseEmailMailboxes(responses)).toEqual([{ id: 'e1', mailboxIds: ['mi', 'lbl'] }])
  })
  it('résiste à mailboxIds absent', () => {
    expect(parseEmailMailboxes([['Email/get', { list: [{ id: 'e1' }] }, '0']])).toEqual([
      { id: 'e1', mailboxIds: [] },
    ])
  })
})

describe('resolveTargetMailbox', () => {
  it("résout 'archive' → id du role archive", () => {
    expect(resolveTargetMailbox('archive', [{ id: 'ma', role: 'archive' }])).toBe('ma')
  })
  it("'spam' (URL) → role junk", () => {
    expect(resolveTargetMailbox('spam', [{ id: 'mj', role: 'junk' }])).toBe('mj')
  })
  it('role absent → undefined', () => {
    expect(resolveTargetMailbox('trash', [{ id: 'mi', role: 'inbox' }])).toBeUndefined()
  })
})
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `bun run test -- mail-actions`
Expected: FAIL.

- [ ] **Step 3 : Implémenter**

Dans `src/server/mail-actions.ts` (réutilise `MailboxRef` et `mailboxIdByRole` existants) :

```ts
export type MoveTarget = 'archive' | 'trash' | 'junk' | 'inbox'

// La cible 'spam' de l'UI = role 'junk' ; les autres targets = role homonyme.
const ROLE_BY_TARGET: Record<MoveTarget, string> = {
  archive: 'archive',
  trash: 'trash',
  junk: 'junk',
  inbox: 'inbox',
}

// Pur : target (UI) → mailboxId, résolu côté serveur depuis Mailbox/get. Accepte 'spam' alias de 'junk'.
export function resolveTargetMailbox(
  target: MoveTarget | 'spam',
  mailboxes: MailboxRef[],
): string | undefined {
  const t: MoveTarget = target === 'spam' ? 'junk' : target
  return mailboxIdByRole(mailboxes, ROLE_BY_TARGET[t])
}

// Pur : extrait {id, mailboxIds[]} d'une réponse Email/get (mailboxIds JMAP = objet { id: true }).
export function parseEmailMailboxes(responses: JmapMethodResponse[]): { id: string; mailboxIds: string[] }[] {
  const list = responses.find(([n]) => n === 'Email/get')?.[1].list
  const arr = Array.isArray(list) ? (list as { id: string; mailboxIds?: Record<string, boolean> }[]) : []
  return arr.map((e) => ({ id: e.id, mailboxIds: Object.keys(e.mailboxIds ?? {}) }))
}

// Pur : PATCH CIBLÉ (F3). Retire chaque email de ses dossiers SYSTÈME actuels (role != null)
// et l'ajoute à la cible ; PRÉSERVE les mailboxes sans role (futurs labels, 4d). Remplace
// l'ancienne approche « écraser mailboxIds » qui détruisait labels/multi-dossiers.
export function buildMovePatch(
  accountId: string,
  emails: { id: string; mailboxIds: string[] }[],
  mailboxes: MailboxRef[],
  targetId: string,
): JmapMethodCall[] {
  const roleIds = new Set(mailboxes.filter((m) => m.role !== null).map((m) => m.id))
  const update: Record<string, Record<string, true | null>> = {}
  for (const e of emails) {
    const patch: Record<string, true | null> = { [`mailboxIds/${targetId}`]: true }
    for (const mid of e.mailboxIds) {
      if (mid !== targetId && roleIds.has(mid)) patch[`mailboxIds/${mid}`] = null
    }
    update[e.id] = patch
  }
  return [['Email/set', { accountId, update }, '0']]
}

const moveSchema = z.object({
  emailIds: emailIdsSchema,
  to: z.enum(['archive', 'trash', 'junk', 'inbox', 'spam']),
})

export const moveThreadFn = createServerFn({ method: 'POST' })
  .validator((d: { emailIds: string[]; to: MoveTarget | 'spam' }) => moveSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { jmapUserCall } = await import('./jmap-user')
    const { sid, accountId } = await requireSession()
    // 1er aller-retour (2 reads batchés) : rôles des mailboxes + mailboxIds actuels des emails.
    const reads = await jmapUserCall(sid, [
      ['Mailbox/get', { accountId, ids: null, properties: ['id', 'role'] }, '0'],
      ['Email/get', { accountId, ids: data.emailIds, properties: ['id', 'mailboxIds'] }, '1'],
    ])
    const refs = mailboxRefs(reads)
    const targetId = resolveTargetMailbox(data.to, refs)
    if (targetId === undefined) throw new Error('move: target mailbox unavailable') // message générique (F4)
    const emails = parseEmailMailboxes(reads)
    await jmapUserCall(sid, buildMovePatch(accountId, emails, refs, targetId))
    return { ok: true }
  })
```

> `emailIdsSchema` défini en Task 4 ; placer Task 4 avant Task 5 (ordre du fichier). **F3 (patch ciblé) supersède** la note §2.4 du design qui prévoyait un remplacement de `mailboxIds`.

- [ ] **Step 4 : Lancer (succès attendu)**

Run: `bun run test -- mail-actions`
Expected: PASS.

- [ ] **Step 5 : typecheck + commit**

Run: `bun run typecheck` → PASS

```bash
git add src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(4b): moveThreadFn (archive/trash/junk/inbox, role résolu serveur)"
```

---

## Task 6 : i18n — clés `mail.reader` et `mail.actions`

**Files:**
- Modify: `src/i18n/resources.ts` (objets `fr` ET `en` — `en` est typé `DeepRecord<typeof fr>`, les deux doivent avoir exactement les mêmes clés)
- Test: `src/i18n/resources.test.ts` (vérifie déjà la parité fr/en ; relancer)

- [ ] **Step 1 : Ajouter les clés dans `fr`**

Dans l'objet `fr`, repérer la clé `mail: { … }` existante et y ajouter les sous-objets `reader` et `actions` :

```ts
    reader: {
      empty: 'Aucune conversation sélectionnée',
      emptyHint: 'Choisissez un message dans la liste pour le lire ici.',
      messages_one: '{{count}} message',
      messages_other: '{{count}} messages',
      back: 'Retour',
      archive: 'Archiver',
      trash: 'Supprimer',
      snooze: 'Reporter',
      spam: 'Signaler comme spam',
      notSpam: 'Retirer des indésirables',
      label: 'Étiqueter',
      star: 'Favori',
      more: 'Plus',
      markUnread: 'Marquer comme non lu',
      from: 'De',
      to: 'À',
      cc: 'Cc',
      date: 'Date',
      showImages: 'Afficher les images',
      imagesBlocked: 'Images distantes bloquées pour votre confidentialité.',
      retry: 'Réessayer',
      loadError: 'Impossible d’ouvrir le message.',
      reply: 'Répondre',
    },
    actions: {
      archived: 'Conversation archivée',
      trashed: 'Conversation supprimée',
      spamReported: 'Marquée comme indésirable',
      notSpam: 'Retirée des indésirables',
      markedRead: 'Marquée comme lue',
      markedUnread: 'Marquée comme non lue',
      starred: 'Ajoutée aux favoris',
      unstarred: 'Retirée des favoris',
      error: 'L’action a échoué',
    },
```

- [ ] **Step 2 : Ajouter les mêmes clés dans `en`**

Dans l'objet `en`, sous `mail`, ajouter :

```ts
    reader: {
      empty: 'No conversation selected',
      emptyHint: 'Pick a message from the list to read it here.',
      messages_one: '{{count}} message',
      messages_other: '{{count}} messages',
      back: 'Back',
      archive: 'Archive',
      trash: 'Delete',
      snooze: 'Snooze',
      spam: 'Report spam',
      notSpam: 'Not spam',
      label: 'Label',
      star: 'Star',
      more: 'More',
      markUnread: 'Mark as unread',
      from: 'From',
      to: 'To',
      cc: 'Cc',
      date: 'Date',
      showImages: 'Show images',
      imagesBlocked: 'Remote images blocked for your privacy.',
      retry: 'Retry',
      loadError: 'Could not open the message.',
      reply: 'Reply',
    },
    actions: {
      archived: 'Conversation archived',
      trashed: 'Conversation deleted',
      spamReported: 'Marked as spam',
      notSpam: 'Removed from spam',
      markedRead: 'Marked as read',
      markedUnread: 'Marked as unread',
      starred: 'Added to favorites',
      unstarred: 'Removed from favorites',
      error: 'Action failed',
    },
```

- [ ] **Step 3 : Lancer les tests i18n**

Run: `bun run test -- resources`
Expected: PASS (parité fr/en respectée).

- [ ] **Step 4 : typecheck (parité de type fr/en)**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/i18n/resources.ts
git commit -m "feat(4b): i18n mail.reader + mail.actions (fr/en)"
```

---

## Task 7 : Icônes manquantes (`mail-icons.tsx`)

**Files:**
- Modify: `src/components/mail/mail-icons.tsx` (objet `ICON_PATHS`)
- Test: `src/components/mail/mail-icons.test.tsx`

- [ ] **Step 1 : Écrire le test (échoue)**

Ajouter à `src/components/mail/mail-icons.test.tsx` (suivre le style existant du fichier) :

```ts
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Icon } from './mail-icons'

describe('Icon — nouvelles icônes 4b', () => {
  const names = ['archive', 'trash2', 'mail-open', 'more-v', 'chev-left', 'spam', 'download', 'x', 'reply']
  it.each(names)('rend un <svg> non vide pour "%s"', (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.innerHTML.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `bun run test -- mail-icons`
Expected: FAIL (paths vides → `innerHTML.length === 0`).

- [ ] **Step 3 : Ajouter les paths**

Dans `src/components/mail/mail-icons.tsx`, ajouter ces entrées à `ICON_PATHS` (style cohérent : stroke, 24×24) :

```ts
  archive: '<path d="M3 7h18v3H3z"/><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"/><path d="M10 14h4"/>',
  trash2: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/>',
  'mail-open': '<path d="M3 9l9-6 9 6v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9l9 6 9-6"/>',
  'more-v': '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  'chev-left': '<path d="M15 6l-6 6 6 6"/>',
  'chev-down': '<path d="M6 9l6 6 6-6"/>',
  spam: '<path d="M12 3l9 16H3z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  reply: '<path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 5 5v1"/>',
  'reply-all': '<path d="M7 7l-5 5 5 5"/><path d="M12 7l-5 5 5 5"/><path d="M7 12h9a4 4 0 0 1 4 4v1"/>',
  forward: '<path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 0 0-5 5v1"/>',
  download: '<path d="M12 3v12"/><path d="M7 11l5 4 5-4"/><path d="M5 19h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  pin: '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14v7"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
```

- [ ] **Step 4 : Lancer (succès attendu)**

Run: `bun run test -- mail-icons`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/components/mail/mail-icons.tsx src/components/mail/mail-icons.test.tsx
git commit -m "feat(4b): icônes reader (archive, trash2, mail-open, more-v, …)"
```

---

## Task 8 : Système de toast (`toast.tsx`) — porté de la maquette

La maquette **contient** un toast (`webmail/project/mail-app.jsx` : state `toast`, helper `showToast(msg, opts)` auto-dismiss 3600 ms, rendu `.toast-wrap > .toast > .toast-msg` + bouton de fermeture). La 4a ne l'a pas porté en React, mais les classes CSS (`.toast-wrap`, `.toast`, `.toast-msg`, `.toast-mail`) sont **déjà dans `mail.css`**. On porte ce patron fidèlement sous forme de `ToastProvider` + `useToast()`. La variante `toast-mail` (avatar) et l'action « Annuler » (undo) de la maquette relèvent du snooze/undo → **hors 4b** ; on garde message + fermeture.

**Files:**
- Create: `src/components/mail/toast.tsx`
- Test: `src/components/mail/toast.test.tsx`

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `src/components/mail/toast.test.tsx` :

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ToastProvider, useToast } from './toast'

function Trigger() {
  const notify = useToast()
  return (
    <button onClick={() => notify('Bonjour', 'success')}>go</button>
  )
}

describe('ToastProvider / useToast', () => {
  it('affiche le message (.toast-msg) + bouton de fermeture après notify', () => {
    const { container } = render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    act(() => {
      screen.getByText('go').click()
    })
    expect(container.querySelector('.toast-wrap .toast .toast-msg')?.textContent).toBe('Bonjour')
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument()
  })

  it('le bouton OK ferme le toast', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    act(() => {
      screen.getByText('go').click()
    })
    act(() => {
      screen.getByRole('button', { name: 'OK' }).click()
    })
    expect(screen.queryByText('Bonjour')).not.toBeInTheDocument()
  })

  it('useToast hors provider est un no-op (ne jette pas)', () => {
    function Bare() {
      const notify = useToast()
      return <button onClick={() => notify('x')}>b</button>
    }
    render(<Bare />)
    act(() => {
      screen.getByText('b').click()
    })
    expect(screen.queryByText('x')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `bun run test -- toast`
Expected: FAIL (module `./toast` introuvable).

- [ ] **Step 3 : Implémenter**

Créer `src/components/mail/toast.tsx` :

```tsx
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type ToastKind = 'success' | 'error'
type ToastItem = { id: number; message: string; kind: ToastKind }
type Notify = (message: string, kind?: ToastKind) => void

const ToastCtx = createContext<Notify>(() => {})

export function useToast(): Notify {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const notify = useCallback<Notify>((message, kind = 'success') => {
    const id = ++counter.current
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => dismiss(id), 3600) // même délai que la maquette (showToast)
  }, [dismiss])

  // Markup fidèle à la maquette : .toast-wrap > .toast > .toast-msg + bouton de fermeture.
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast' + (t.kind === 'error' ? ' toast-error' : '')}>
            <span className="toast-msg">{t.message}</span>
            <button onClick={() => dismiss(t.id)}>OK</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
```

- [ ] **Step 4 : Lancer (succès attendu)**

Run: `bun run test -- toast`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/components/mail/toast.tsx src/components/mail/toast.test.tsx
git commit -m "feat(4b): ToastProvider + useToast (minimal, classes maquette)"
```

---

## Task 9 : Hook d'actions (`use-thread-actions.ts`)

Encapsule les mutations + réconciliation cache (design §2.6) : optimiste pour star/read (patch des pages liste + détail), invalidation pour move (+ fermeture lecteur + invalidation mailboxes). Toasts via `useToast`.

**Files:**
- Create: `src/components/mail/use-thread-actions.ts`
- Test: `src/components/mail/use-thread-actions.test.tsx`

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `src/components/mail/use-thread-actions.test.tsx` :

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ToastProvider } from './toast'
import { patchThreadInPages } from './use-thread-actions'
import type { EmailListPage, AppThread } from '../../server/mail-types'

// Mock des server functions
const setFlags = vi.fn().mockResolvedValue({ ok: true })
const move = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../server/mail-actions', () => ({
  setFlagsFn: (args: unknown) => setFlags(args),
  moveThreadFn: (args: unknown) => move(args),
}))

const thread = (over: Partial<AppThread> = {}): AppThread => ({
  id: 'e1', threadId: 't1', subject: 's', preview: 'p', from: [], to: [],
  messageCount: 1, receivedAt: '2026-06-10T00:00:00Z', unread: true, starred: false,
  hasAttachment: false, mailboxIds: ['mi'], ...over,
})

describe('patchThreadInPages (pur)', () => {
  it('patch l’AppThread par threadId dans toutes les pages', () => {
    const page: EmailListPage = { threads: [thread()], total: 1, position: 0 }
    const out = patchThreadInPages(page, 't1', { unread: false })
    expect(out.threads[0].unread).toBe(false)
  })
  it('laisse la page inchangée si threadId absent', () => {
    const page: EmailListPage = { threads: [thread()], total: 1, position: 0 }
    expect(patchThreadInPages(page, 'tX', { unread: false })).toBe(page)
  })
})
```

> NOTE : on teste surtout la fonction **pure** `patchThreadInPages`. Le comportement optimiste/rollback complet du hook est couvert par les tests du composant Reader (Task 11) qui exercent les clics ; ici on garde un test ciblé sur la logique pure de patch (la partie risquée).

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `bun run test -- use-thread-actions`
Expected: FAIL (`patchThreadInPages` non exporté).

- [ ] **Step 3 : Implémenter**

Créer `src/components/mail/use-thread-actions.ts` :

```ts
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { setFlagsFn, moveThreadFn } from '../../server/mail-actions'
import type { EmailListPage } from '../../server/mail-types'
import { useToast } from './toast'

// Pur : renvoie une page avec l'AppThread (par threadId) patché, ou la page inchangée (référence) si absent.
export function patchThreadInPages(
  page: EmailListPage,
  threadId: string,
  patch: Partial<{ unread: boolean; starred: boolean }>,
): EmailListPage {
  let changed = false
  const threads = page.threads.map((t) => {
    if (t.threadId !== threadId) return t
    changed = true
    return { ...t, ...patch }
  })
  return changed ? { ...page, threads } : page
}

type MoveTo = 'archive' | 'trash' | 'junk' | 'inbox' | 'spam'

export interface ThreadActions {
  star: (value: boolean) => Promise<void>
  markRead: (value: boolean) => Promise<void>
  move: (to: MoveTo) => Promise<void>
}

// folder = dossier courant (clé de cache liste) ; emailIds/threadId = fil ouvert.
export function useThreadActions(folder: string, threadId: string, emailIds: string[]): ThreadActions {
  const qc = useQueryClient()
  const router = useRouter()
  const notify = useToast()
  const { t } = useTranslation()
  const listKey = ['threads', folder] as const
  const detailKey = ['thread', threadId] as const

  // Patch optimiste en place (liste + détail) avec snapshot pour rollback.
  async function optimisticFlag(
    flag: '$seen' | '$flagged',
    value: boolean,
    patch: Partial<{ unread: boolean; starred: boolean }>,
    okMsg: string,
  ) {
    if (emailIds.length === 0) return // F6 : pas d'action tant que le fil n'est pas chargé (évite un rejet Zod .min(1))
    await qc.cancelQueries({ queryKey: listKey })
    const prevList = qc.getQueriesData<EmailListPage>({ queryKey: listKey })
    const prevDetail = qc.getQueryData(detailKey)
    qc.setQueriesData<EmailListPage>({ queryKey: listKey }, (page) =>
      page ? patchThreadInPages(page, threadId, patch) : page,
    )
    qc.setQueryData(detailKey, (d: unknown) =>
      d ? { ...(d as object), ...patch } : d,
    )
    try {
      await setFlagsFn({ data: { emailIds, flag, value } })
      notify(okMsg, 'success')
    } catch {
      for (const [key, data] of prevList) qc.setQueryData(key, data)
      qc.setQueryData(detailKey, prevDetail)
      notify(t('mail.actions.error'), 'error')
    }
  }

  return {
    star: (value) =>
      optimisticFlag('$flagged', value, { starred: value }, value ? t('mail.actions.starred') : t('mail.actions.unstarred')),
    markRead: (value) =>
      optimisticFlag('$seen', value, { unread: !value }, value ? t('mail.actions.markedRead') : t('mail.actions.markedUnread')),
    move: async (to) => {
      if (emailIds.length === 0) return // F6 : fil non chargé → no-op
      try {
        await moveThreadFn({ data: { emailIds, to } })
        await qc.invalidateQueries({ queryKey: listKey })
        await router.invalidate() // rafraîchit les compteurs sidebar (loader mailboxesFn)
        await router.navigate({ to: '/mail/$folder', params: { folder }, search: { thread: undefined } })
        const msg =
          to === 'archive' ? t('mail.actions.archived')
          : to === 'trash' ? t('mail.actions.trashed')
          : to === 'spam' || to === 'junk' ? t('mail.actions.spamReported')
          : t('mail.actions.notSpam')
        notify(msg, 'success')
      } catch {
        notify(t('mail.actions.error'), 'error')
      }
    },
  }
}
```

- [ ] **Step 4 : Lancer (succès attendu)**

Run: `bun run test -- use-thread-actions`
Expected: PASS.

- [ ] **Step 5 : typecheck + commit**

Run: `bun run typecheck` → PASS

```bash
git add src/components/mail/use-thread-actions.ts src/components/mail/use-thread-actions.test.tsx
git commit -m "feat(4b): use-thread-actions (optimiste star/read, invalidation move)"
```

---

## Task 10 : Composant `MessageItem`

**Files:**
- Create: `src/components/mail/message-item.tsx`
- Test: `src/components/mail/message-item.test.tsx`

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `src/components/mail/message-item.test.tsx` :

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../../i18n/i18n'
import { MessageItem } from './message-item'
import type { AppMessage } from '../../server/mail-types'

const msg = (over: Partial<AppMessage> = {}): AppMessage => ({
  id: 'e1', from: [{ name: 'Bob', email: 'bob@x.io' }], to: [{ name: 'Moi', email: 'me@x.io' }],
  cc: [], subject: 's', receivedAt: '2026-06-10T10:00:00Z', unread: false, hasAttachment: false,
  textBody: 'corps en clair', htmlBody: null, attachments: [], ...over,
})

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)
}

describe('MessageItem', () => {
  it('affiche le corps texte quand ouvert', () => {
    wrap(<MessageItem message={msg()} defaultOpen />)
    expect(screen.getByText('corps en clair')).toBeInTheDocument()
  })
  it('rend une iframe pour un corps html-seul', () => {
    const { container } = wrap(<MessageItem message={msg({ textBody: null, htmlBody: '<p>hi</p>' })} defaultOpen />)
    expect(container.querySelector('iframe.msg-html-frame')).not.toBeNull()
  })
  it("liste les pièces jointes avec bouton télécharger désactivé", () => {
    wrap(<MessageItem message={msg({ attachments: [{ blobId: 'b', name: 'cv.pdf', type: 'application/pdf', size: 10 }] })} defaultOpen />)
    expect(screen.getByText('cv.pdf')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cv\.pdf/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `bun run test -- message-item`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Implémenter**

Créer `src/components/mail/message-item.tsx` :

```tsx
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, Avatar } from './mail-icons'
import { formatThreadDate } from './format-date'
import { pickBody, buildFrameDoc, hasRemoteImages } from './email-body'
import type { AppMessage } from '../../server/mail-types'

export function MessageItem({ message, defaultOpen = false }: { message: AppMessage; defaultOpen?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const [showImages, setShowImages] = useState(false)

  const lead = message.from.at(0)
  const leadName = lead?.name || lead?.email || '—'
  const body = useMemo(() => pickBody(message), [message])
  const remote = body.kind === 'html' && hasRemoteImages(body.content)
  const frameDoc = useMemo(
    () => (body.kind === 'html' ? buildFrameDoc(body.content, { showImages }) : ''),
    [body, showImages],
  )

  return (
    <div className={'msg' + (open ? '' : ' collapsed')}>
      <div className="msg-head" onClick={() => setOpen((o) => !o)}>
        <Avatar name={leadName} email={lead?.email ?? ''} />
        <div className="who">
          <div className="nm">{leadName}</div>
          {open && message.to.length > 0 && (
            <div className="to">
              {t('mail.reader.to')} {message.to.map((r) => r.name || r.email).join(', ')}
            </div>
          )}
        </div>
        <div className="when">{formatThreadDate(message.receivedAt)}</div>
      </div>

      {open && (
        <div className="msg-body">
          {remote && !showImages && (
            <div className="img-block-banner">
              {t('mail.reader.imagesBlocked')}{' '}
              <button className="mini-btn" onClick={() => setShowImages(true)}>
                {t('mail.reader.showImages')}
              </button>
            </div>
          )}
          {body.kind === 'text' ? (
            <p style={{ whiteSpace: 'pre-wrap' }}>{body.content}</p>
          ) : (
            <iframe
              className="msg-html-frame"
              title={message.subject || leadName}
              sandbox=""
              srcDoc={frameDoc}
            />
          )}

          {message.attachments.length > 0 && (
            <div className="attach-row">
              {message.attachments.map((a) => (
                <button key={a.blobId} className="attach" disabled aria-label={a.name}>
                  <div className="fi">{(a.type.split('/')[1] ?? 'fichier').slice(0, 4)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="fn">{a.name}</div>
                    <div className="fs">{Math.ceil(a.size / 1024)} Ko</div>
                  </div>
                  <Icon name="download" size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4 : Lancer (succès attendu)**

Run: `bun run test -- message-item`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/components/mail/message-item.tsx src/components/mail/message-item.test.tsx
git commit -m "feat(4b): MessageItem (corps texte/iframe sandbox + CSP, pièces jointes)"
```

---

## Task 11 : Composant `Reader`

**Files:**
- Create: `src/components/mail/reader.tsx`
- Test: `src/components/mail/reader.test.tsx`

Le `Reader` est **présentationnel** : il reçoit `detail` (ou `undefined`), `isLoading`, `isError`, le `folder`, et des callbacks d'action. Il ne fait pas lui-même le fetch (la route s'en charge, Task 12), ce qui le rend testable sans react-query.

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `src/components/mail/reader.test.tsx` :

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../../i18n/i18n'
import { Reader } from './reader'
import type { AppThreadDetail } from '../../server/mail-types'

const detail = (): AppThreadDetail => ({
  threadId: 't1', subject: 'Sujet test', emailIds: ['e1'], starred: false, unread: false,
  messages: [{
    id: 'e1', from: [{ name: 'Bob', email: 'bob@x.io' }], to: [], cc: [],
    subject: 'Sujet test', receivedAt: '2026-06-10T10:00:00Z', unread: false,
    hasAttachment: false, textBody: 'hello', htmlBody: null, attachments: [],
  }],
})

const noop = { star: vi.fn(), markRead: vi.fn(), move: vi.fn(), onBack: vi.fn() }
function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)
}

describe('Reader', () => {
  it('état vide quand pas de détail', () => {
    wrap(<Reader folder="inbox" detail={undefined} isLoading={false} isError={false} {...noop} />)
    expect(screen.getByText('Aucune conversation sélectionnée')).toBeInTheDocument()
  })
  it('affiche sujet + message quand chargé', () => {
    wrap(<Reader folder="inbox" detail={detail()} isLoading={false} isError={false} {...noop} />)
    expect(screen.getByText('Sujet test')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
  it('clic Archiver appelle move("archive")', () => {
    const move = vi.fn()
    wrap(<Reader folder="inbox" detail={detail()} isLoading={false} isError={false} {...noop} move={move} />)
    screen.getByTitle('Archiver').click()
    expect(move).toHaveBeenCalledWith('archive')
  })
  it('bouton Répondre est désactivé (4c)', () => {
    wrap(<Reader folder="inbox" detail={detail()} isLoading={false} isError={false} {...noop} />)
    expect(screen.getByRole('button', { name: /Répondre/i })).toBeDisabled()
  })
  it('état erreur propose Réessayer', () => {
    wrap(<Reader folder="inbox" detail={undefined} isLoading={false} isError {...noop} />)
    expect(screen.getByText('Impossible d’ouvrir le message.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `bun run test -- reader`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Implémenter**

Créer `src/components/mail/reader.tsx` :

```tsx
import { useTranslation } from 'react-i18next'
import { Icon } from './mail-icons'
import { MessageItem } from './message-item'
import type { AppThreadDetail } from '../../server/mail-types'

export interface ReaderProps {
  folder: string
  detail: AppThreadDetail | undefined
  isLoading: boolean
  isError: boolean
  star: (value: boolean) => void
  markRead: (value: boolean) => void
  move: (to: 'archive' | 'trash' | 'junk' | 'inbox' | 'spam') => void
  onBack: () => void
}

export function Reader({ folder, detail, isLoading, isError, star, markRead, move, onBack }: ReaderProps) {
  const { t } = useTranslation()

  if (isError) {
    return (
      <section className="reader">
        <div className="empty">
          <div>
            <div className="glyph"><Icon name="mail-open" size={28} /></div>
            <p>{t('mail.reader.loadError')}</p>
          </div>
        </div>
      </section>
    )
  }

  if (!detail && !isLoading) {
    return (
      <section className="reader">
        <div className="empty">
          <div>
            <div className="glyph"><Icon name="mail-open" size={28} /></div>
            <h3>{t('mail.reader.empty')}</h3>
            <p>{t('mail.reader.emptyHint')}</p>
          </div>
        </div>
      </section>
    )
  }

  const inSpam = folder === 'spam'

  return (
    <section className="reader">
      <div className="reader-bar">
        <button className="icon-btn sm" onClick={onBack} title={t('mail.reader.back')}>
          <Icon name="chev-left" size={18} />
        </button>
        <button className="icon-btn sm" title={t('mail.reader.archive')} onClick={() => move('archive')}>
          <Icon name="archive" size={17} />
        </button>
        <button className="icon-btn sm" title={t('mail.reader.trash')} onClick={() => move('trash')}>
          <Icon name="trash2" size={17} />
        </button>
        <button className="icon-btn sm" title={t('mail.reader.snooze')} disabled>
          <Icon name="clock" size={17} />
        </button>
        {inSpam ? (
          <button className="icon-btn sm" title={t('mail.reader.notSpam')} onClick={() => move('inbox')}>
            <Icon name="mail-open" size={17} />
          </button>
        ) : (
          <button className="icon-btn sm" title={t('mail.reader.spam')} onClick={() => move('spam')}>
            <Icon name="spam" size={17} />
          </button>
        )}
        <button className="icon-btn sm" title={t('mail.reader.label')} disabled>
          <Icon name="tag" size={17} />
        </button>
        <span className="sp" />
        <button
          className={'icon-btn sm' + (detail?.starred ? ' on' : '')}
          title={t('mail.reader.star')}
          onClick={() => star(!detail?.starred)}
        >
          <Icon name={detail?.starred ? 'star-fill' : 'star'} size={17} />
        </button>
        <button className="icon-btn sm" title={t('mail.reader.markUnread')} onClick={() => markRead(false)}>
          <Icon name="mail-open" size={17} />
        </button>
      </div>

      <div className="reader-scroll scroll">
        <div className="reader-inner">
          {detail && (
            <>
              <div className="thread-head">
                <div className="thread-subject">{detail.subject}</div>
                <div className="thread-meta">
                  <span className="row-time" style={{ marginLeft: 'auto' }}>
                    {t('mail.reader.messages', { count: detail.messages.length })}
                  </span>
                </div>
              </div>

              {detail.messages.map((m, i) => (
                <MessageItem key={m.id} message={m} defaultOpen={i === detail.messages.length - 1} />
              ))}

              <div className="reply-bar">
                <button className="reply-bar-main" disabled>
                  <Icon name="reply" size={16} />
                  <span className="rb-text">{t('mail.reader.reply')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4 : Lancer (succès attendu)**

Run: `bun run test -- reader`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/components/mail/reader.tsx src/components/mail/reader.test.tsx
git commit -m "feat(4b): Reader (reader-bar 5 actions, thread-head, messages, reply disabled)"
```

---

## Task 12 : Câblage layout + route + barrel + CSS

Relie le tout : `layout.tsx` accepte un slot reader ; la route lit `?thread`, fetch `readThreadFn`, monte le `Reader` via `useThreadActions`, auto-marque lu à l'ouverture, et enveloppe dans `ToastProvider`.

**Files:**
- Modify: `src/components/mail/layout.tsx`
- Modify: `src/components/mail/index.ts`
- Modify: `src/routes/mail/$folder.tsx`
- Modify: `src/components/mail/mail.css`
- Test: `src/routes/mail/$folder.test.tsx` (existant — adapter)

- [ ] **Step 1 : Layout — ajouter le slot reader**

Remplacer le contenu de `src/components/mail/layout.tsx` :

```tsx
import type { ReactNode } from 'react'

export function MailLayout({ sidebar, list, reader }: { sidebar: ReactNode; list: ReactNode; reader?: ReactNode }) {
  return (
    <div className="app">
      {sidebar}
      <section className="list">{list}</section>
      {reader ?? <section className="reader reader-placeholder" aria-hidden="true" />}
    </div>
  )
}
```

- [ ] **Step 2 : Barrel — exporter les nouveaux composants**

Dans `src/components/mail/index.ts`, ajouter :

```ts
export { Reader } from './reader'
export { MessageItem } from './message-item'
export { ToastProvider, useToast } from './toast'
export { useThreadActions } from './use-thread-actions'
```

- [ ] **Step 3 : CSS — bandeau images + iframe**

Ajouter à la fin de `src/components/mail/mail.css` :

```css
.msg-html-frame {
  width: 100%;
  min-height: 320px;
  border: 0;
  background: #fff;
}
.img-block-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 13px;
  background: var(--surface-2, #f3f4f6);
  border-radius: 8px;
  color: var(--ink-2, #4b5563);
}
```

- [ ] **Step 4 : Adapter le test de route (échoue d'abord)**

Remplacer `src/routes/mail/$folder.test.tsx` par (couvre : pas de `?thread` → placeholder ; `?thread` → Reader monté). Le mock de `mail-actions` couvre `mailboxesFn`, `emailListFn` et `readThreadFn` :

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../../i18n/i18n'
import { MailPage } from './$folder'
import type { AppMailbox } from '../../server/mail-types'

vi.mock('../../server/mail-actions', () => ({
  mailboxesFn: vi.fn().mockResolvedValue([]),
  emailListFn: vi.fn().mockResolvedValue({ threads: [], total: 0, position: 0 }),
  readThreadFn: vi.fn().mockResolvedValue({
    threadId: 't1', subject: 'Sujet ouvert', emailIds: ['e1'], starred: false, unread: false,
    messages: [{ id: 'e1', from: [], to: [], cc: [], subject: 'Sujet ouvert', receivedAt: '2026-06-10T00:00:00Z', unread: false, hasAttachment: false, textBody: 'corps', htmlBody: null, attachments: [] }],
  }),
  setFlagsFn: vi.fn().mockResolvedValue({ ok: true }),
  moveThreadFn: vi.fn().mockResolvedValue({ ok: true }),
}))

const MBX: AppMailbox[] = [{ id: 'mi', name: 'Réception', role: 'inbox', unreadEmails: 0, totalEmails: 0, sortOrder: 1 }]

beforeEach(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as Record<string, unknown>).ResizeObserver = RO
})

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  )
}

describe('MailPage — reader', () => {
  it('sans ?thread : placeholder, pas de reader-bar', () => {
    wrap(<MailPage folder="inbox" mailboxes={MBX} accountName="Moi" threadId={undefined} />)
    expect(document.querySelector('.reader-placeholder')).not.toBeNull()
  })
  it('avec threadId : monte le Reader et charge le fil', async () => {
    wrap(<MailPage folder="inbox" mailboxes={MBX} accountName="Moi" threadId="t1" />)
    await waitFor(() => expect(screen.getByText('Sujet ouvert')).toBeInTheDocument())
  })
})
```

- [ ] **Step 5 : Lancer (échec attendu)**

Run: `bun run test -- '\$folder'`
Expected: FAIL (`MailPage` n'accepte pas `threadId` ; pas de montage Reader).

- [ ] **Step 6 : Implémenter la route**

Remplacer `src/routes/mail/$folder.tsx` :

```tsx
import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { requireAuth } from '@/lib/auth-guard'
import { mailboxesFn, readThreadFn } from '@/server/mail-actions'
import { MailLayout, AppSidebar, ThreadList, Reader, ToastProvider, useThreadActions } from '@/components/mail'
import type { AppMailbox } from '@/server/mail-types'
import '@/components/mail/mail.css'

export const Route = createFileRoute('/mail/$folder')({
  beforeLoad: () => requireAuth(),
  validateSearch: (search: Record<string, unknown>): { thread?: string } => ({
    // F7 : borne la longueur (défense en profondeur ; le serveur re-valide via readThreadSchema.max(64)).
    thread:
      typeof search.thread === 'string' && search.thread.length > 0 && search.thread.length <= 64
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
  const { thread } = Route.useSearch()
  return <MailPage folder={folder} mailboxes={mailboxes} accountName={accountName} threadId={thread} />
}

// Présentationnel testable (props injectées).
export function MailPage({
  folder,
  mailboxes,
  accountName = '',
  threadId,
}: {
  folder: string
  mailboxes: AppMailbox[]
  accountName?: string
  threadId?: string
}) {
  const { t } = useTranslation()
  const activeMailbox = mailboxes.find((m) => m.role === folder)

  return (
    <ToastProvider>
      <MailLayout
        sidebar={<AppSidebar mailboxes={mailboxes} activeFolder={folder} accountName={accountName} />}
        list={
          folder === 'snoozed' ? (
            <div className="list-empty">{t('mail.snoozedUnavailable')}</div>
          ) : (
            <ThreadList folder={folder} provisionalCount={activeMailbox?.totalEmails} />
          )
        }
        reader={threadId ? <ReaderPane folder={folder} threadId={threadId} /> : undefined}
      />
    </ToastProvider>
  )
}

// Sous-composant : fetch du fil + actions + auto-marquage lu.
function ReaderPane({ folder, threadId }: { folder: string; threadId: string }) {
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['thread', threadId],
    queryFn: () => readThreadFn({ data: { threadId } }),
    staleTime: 30_000,
  })
  const detail = query.data
  const actions = useThreadActions(folder, threadId, detail?.emailIds ?? [])

  // Auto-marquage lu à l'ouverture d'un fil non lu (design §2.1) — via setFlags (POST), pas dans readThreadFn.
  useEffect(() => {
    if (detail && detail.unread && detail.emailIds.length > 0) {
      void actions.markRead(true)
    }
    // déclenché quand un nouveau fil non lu est chargé
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.threadId, detail?.unread])

  return (
    <Reader
      folder={folder}
      detail={detail}
      isLoading={query.isLoading}
      isError={query.isError}
      star={(v) => void actions.star(v)}
      markRead={(v) => void actions.markRead(v)}
      move={(to) => void actions.move(to)}
      onBack={() => void navigate({ to: '/mail/$folder', params: { folder }, search: { thread: undefined } })}
    />
  )
}
```

- [ ] **Step 7 : Mettre à jour `ThreadRow` pour naviguer vers `?thread`**

`ThreadRow` (Task 4a) appelle déjà `onOpen?.(thread.id)`. Vérifier que `ThreadList` câble `onOpen` vers une navigation `search: { thread: id }`. Dans `src/components/mail/thread-list.tsx`, là où `ThreadRow` reçoit `onOpen`, passer :

```tsx
// en tête du composant ThreadList :
import { useNavigate, useSearch } from '@tanstack/react-router'
// …
const navigate = useNavigate()
const { thread: openThread } = useSearch({ from: '/mail/$folder' })
// …
// pour chaque ThreadRow :
//   selected={thread?.id === openThread}
//   onOpen={(id) => navigate({ to: '/mail/$folder', params: { folder }, search: { thread: id } })}
```

> Si `ThreadList` ne connaît pas `folder`, l'ajouter à ses props (il le reçoit déjà depuis `MailPage`). Adapter les tests existants de `thread-list` si la signature change (ajouter le `MemoryRouter`/contexte si nécessaire, ou garder `onOpen` optionnel et injecter la navigation depuis `MailPage`). **Approche recommandée** : garder `ThreadList` agnostique — lui passer `onOpen`/`selectedId` en props depuis `MailPage`, et faire la navigation dans `MailPage`. Cela évite de coupler `ThreadList` au routeur et préserve ses tests.

Implémentation recommandée (découplée) — dans `MailPage`, calculer la navigation et la passer :

```tsx
// dans MailPage, avant le return :
const navigate = useNavigate()
// …
list={
  folder === 'snoozed' ? (
    <div className="list-empty">{t('mail.snoozedUnavailable')}</div>
  ) : (
    <ThreadList
      folder={folder}
      provisionalCount={activeMailbox?.totalEmails}
      selectedId={threadId}
      onOpen={(id) => void navigate({ to: '/mail/$folder', params: { folder }, search: { thread: id } })}
    />
  )
}
```

Et dans `ThreadList`, ajouter les props `selectedId?: string` et `onOpen?: (id: string) => void`, les transmettre à chaque `ThreadRow` (`selected={thread?.id === selectedId}`, `onOpen={onOpen}`). Les tests existants de `ThreadList` continuent de passer (props optionnelles).

- [ ] **Step 8 : Lancer toute la suite**

Run: `bun run test`
Expected: PASS (tous les projets — server + client). Si un test 4a de `thread-list`/`$folder` casse, l'ajuster aux nouvelles props optionnelles.

- [ ] **Step 9 : lint + typecheck**

Run: `bun run lint && bun run typecheck`
Expected: PASS.

- [ ] **Step 10 : Commit**

```bash
git add src/components/mail/layout.tsx src/components/mail/index.ts src/components/mail/mail.css src/components/mail/thread-list.tsx src/routes/mail/$folder.tsx src/routes/mail/$folder.test.tsx
git commit -m "feat(4b): câblage reader — route ?thread, ToastProvider, navigation liste"
```

---

## Task 13 : Vérification finale & revue

- [ ] **Step 1 : Suite complète + build**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: tout PASS.

- [ ] **Step 2 : Vérification manuelle (optionnelle, skill `run`)**

Lancer l'app, ouvrir un fil depuis la liste : le lecteur s'affiche, le fil se charge, le fil non lu passe lu (compteur sidebar décrémente), star/archive/trash/spam fonctionnent avec toast, un email HTML s'affiche en iframe avec images bloquées + bandeau.

- [ ] **Step 3 : Revue sécurité ciblée**

Dispatch du subagent `security-reviewer` sur le diff (`git diff main...HEAD`) — vérifier en particulier : `sandbox=""` (jamais `allow-same-origin`), CSP présente dans `buildFrameDoc`, aucune fuite de token, Zod sur les 3 server fn, `readThreadFn` read-only.

- [ ] **Step 4 : Commit final éventuel** (corrections de revue), puis ouvrir la PR.

---

## Self-Review (rempli par l'auteur du plan)

**Couverture spec :**
- §2.1 actions (5) → Tasks 4, 5, 9 ✅ ; auto-read → Task 12 ✅
- §2.4 server fn typées (setFlags/move) → Tasks 4, 5 ✅ ; plafond `.max(500)` → Task 4 ✅
- §2.5 readThreadFn + invariant read-only → Task 3 ✅
- §2.6 réconciliation hybride → Task 9 ✅
- §2.7 rendu sûr (sandbox="" + CSP + sanitizeLinks + blockRemoteImages) → Tasks 2, 10 ✅
- §4 types → Task 1 ✅
- §6 composants (Reader, MessageItem, hook) → Tasks 9, 10, 11 ✅
- §7 CSS (img-block-banner, msg-html-frame) → Task 12 ✅
- §8 i18n → Task 6 ✅
- §9 erreurs (toasts génériques, rollback) → Tasks 8, 9 ✅
- §10 tests → chaque task ✅
- **Toast** : patron présent dans la maquette (`mail-app.jsx`, classes CSS déjà dans `mail.css`) mais non porté en React par la 4a → porté fidèlement en Task 8 (`.toast-wrap`/`.toast`/`.toast-msg` + fermeture, délai 3600 ms).

**Placeholders :** aucun — code complet à chaque step.

**Cohérence des types/signatures :** `AppThreadDetail`/`AppMessage` (Task 1) réutilisés tels quels en Tasks 3/9/10/11 ; `setFlagsFn({data})`/`moveThreadFn({data})` invoqués avec l'enveloppe `{ data }` (convention createServerFn) en Task 9 ; `useThreadActions(folder, threadId, emailIds)` signature unique (Tasks 9, 12).

**Revue sécurité du plan (security-reviewer, OWASP) — amendements intégrés :**
- **F3 (🟡, A04/A08)** : `moveThreadFn` fait désormais un **patch ciblé** (`buildMovePatch` + `parseEmailMailboxes`, Task 5) — retire les dossiers système actuels, préserve les labels — au lieu d'écraser `mailboxIds`. Supersède la note §2.4 du design.
- **F1/F2 (🔵, A03 défense-en-profondeur)** : regex `blockRemoteImages`/`hasRemoteImages`/`sanitizeLinks` élargies (src sans quotes, `srcset`) + commentaire actant que la **garantie réelle = sandbox + CSP** (Task 2, + cas de test).
- **F4 (🔵, A09)** : message d'erreur serveur générique dans `moveThreadFn` (Task 5).
- **F6 (🔵, A04)** : `useThreadActions` no-op si `emailIds` vide (Task 9).
- **F7 (🔵)** : `validateSearch` borne la longueur du `?thread` à 64 (Task 12).
- **F5 (🔵)** : taille de fil non plafonnée → risque accepté, documenté (Task 3).
- Verdict reviewer : aucune faille XSS/auth/token ; barrière réelle (sandbox="" + CSP) correctement implémentée.
