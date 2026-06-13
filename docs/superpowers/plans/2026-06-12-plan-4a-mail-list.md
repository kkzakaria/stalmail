# Plan 4a — Mail List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le placeholder `/mail/$folder` par le premier écran fonctionnel du webmail : sidebar de dossiers JMAP + liste de threads virtualisée en lecture seule, sur une grosse boîte, sans blocage réseau.

**Architecture:** BFF — chaque accès JMAP passe par une server function TanStack Start qui récupère un access token Bearer frais (`withFreshAccessToken`) et appelle Stalwart. La liste utilise un **fenêtrage à index absolu** : le virtualizer compte sur le `total`, et une `useQueries` charge une **plage** (`position`/`limit`) par fenêtre visible, débouncée, avec skeletons. Toute la logique de résolution `index → données` est isolée dans `use-windowed-threads` pour permettre la bascule 4d vers un index d'ids maintenu par `Email/queryChanges` sans toucher au rendu.

**Tech Stack:** TanStack Start (server fns), `@tanstack/react-query` (useQueries), `@tanstack/react-virtual` (useVirtualizer), `@tanstack/react-router-ssr-query` (intégration SSR), react-i18next, Tailwind v4 + variables CSS portées de la maquette, Vitest + Testing Library.

**Spec de référence :** `docs/superpowers/specs/2026-06-12-plan-4a-mail-list-design.md` (lire avant de commencer). Maquette extraite dans `/tmp/wmx/webmail/project/` (ou ré-extraire `webmail.zip`).

**Conventions du repo (à respecter) :**
- Server fns : `createServerFn({ method }).validator(zod).handler(fn)` ; dans le handler, importer les modules serveur en **dynamic import** (`const { readSid } = await import('./session-cookie')`) — voir `src/server/auth-actions.ts`.
- Alias d'import : `@/` → `src/`.
- Tests : projet **server** (`node`) couvre `src/server/**` + `src/lib/**` ; projet **client** (`jsdom`) couvre `src/routes/**`, `src/components/**`, `src/i18n/**` (cf. `vitest.config.ts`). Le placement d'un fichier de test détermine son environnement.
- Lancer un seul fichier : `bunx vitest run <chemin>`. Toute la suite : `bun run test`. Typecheck : `bun run typecheck`.
- i18n : `src/i18n/resources.ts` exporte `fr` (objet plat) et `en: DeepRecord<typeof fr>`. `resources.test.ts` impose la **parité stricte des clés** fr/en. Toute clé ajoutée à `fr` doit l'être à `en`.

---

## File Structure

**Créer :**
- `src/server/mail-types.ts` — types partagés (`AppMailbox`, `AppThread`, `EmailListPage`, `VirtualFolder`, `JmapMethodCall`/`Response` ré-export).
- `src/server/jmap-user.ts` — `jmapUserCall(sid, methodCalls)` (transport Bearer) + `JmapUserError`.
- `src/server/jmap-user.test.ts`
- `src/server/mail-actions.ts` — helpers purs (`mapMailboxes`, `resolveFilter`, `buildListMethodCalls`, `parseListPage`) + server fns `mailboxesFn`, `emailListFn`.
- `src/server/mail-actions.test.ts`
- `src/components/mail/mail.css` — variables + styles portés de la maquette.
- `src/components/mail/mail-icons.tsx` — `Icon`, `Avatar`, helpers purs `initialsOf`, `hashColor`.
- `src/components/mail/mail-icons.test.tsx`
- `src/components/mail/format-date.ts` — `formatThreadDate(iso, now)` (FR).
- `src/components/mail/format-date.test.ts` → **placé sous `src/components`** donc projet client ; OK (pure, pas de DOM).
- `src/components/mail/thread-row.tsx` — `ThreadRow` read-only + skeleton.
- `src/components/mail/thread-row.test.tsx`
- `src/components/mail/use-windowed-threads.ts` — hook fenêtrage + helpers purs (`pageIndexesForItems`, `threadAt`).
- `src/components/mail/use-windowed-threads.test.ts`
- `src/components/mail/thread-list.tsx` — `ThreadList` (virtualizer sur total + skeletons).
- `src/components/mail/thread-list.test.tsx`
- `src/components/mail/sidebar.tsx` — `AppSidebar`.
- `src/components/mail/sidebar.test.tsx`
- `src/components/mail/layout.tsx` — grille 3 colonnes.
- `src/components/mail/index.ts` — re-exports.
- `src/routes/mail/$folder.test.tsx` — test d'intégration route.

**Modifier :**
- `package.json` — deps `@tanstack/react-virtual`, `@tanstack/react-query` (directe), `@fontsource-variable/onest`.
- `src/router.tsx` — `QueryClient` dans le contexte routeur + `setupRouterSsrQueryIntegration`.
- `src/routes/__root.tsx` — `createRootRouteWithContext<{ queryClient }>`, `data-theme` sur `<html>`, import police Onest.
- `src/i18n/resources.ts` — namespace `mail` (fr + en).
- `src/routes/mail/$folder.tsx` — remplace le placeholder, loader `mailboxesFn`, branche `MailLayout`.

---

## Task 1: Dépendances + intégration QueryClient SSR

**Files:**
- Modify: `package.json`
- Modify: `src/router.tsx`
- Modify: `src/routes/__root.tsx`

- [ ] **Step 1: Installer les dépendances**

```bash
bun add @tanstack/react-virtual @tanstack/react-query @fontsource-variable/onest
```

Vérifier que `package.json` liste désormais ces 3 paquets dans `dependencies` (react-query passe de transitif à direct).

- [ ] **Step 2: Brancher le QueryClient dans le routeur**

Remplacer `src/router.tsx` par :

```tsx
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { QueryClient } from "@tanstack/react-query"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  })

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  })

  // Provisionne le QueryClientProvider + déshydratation SSR-safe (évite double-fetch / mismatch).
  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
```

- [ ] **Step 3: Typer le contexte racine**

Dans `src/routes/__root.tsx`, remplacer l'import et la création de route :

```tsx
// avant : import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router"
import type { QueryClient } from "@tanstack/react-query"
```

```tsx
// avant : export const Route = createRootRoute({
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
```

(Le reste de l'objet de route — `loader`, `head`, `notFoundComponent`, `shellComponent` — est inchangé.)

- [ ] **Step 4: Vérifier le typecheck**

Run: `bun run typecheck`
Expected: PASS (aucune erreur).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/router.tsx src/routes/__root.tsx
git commit -m "feat(mail): add react-query/virtual deps and SSR query integration"
```

---

## Task 2: Types partagés

**Files:**
- Create: `src/server/mail-types.ts`

- [ ] **Step 1: Écrire les types**

```ts
// Types partagés entre server functions (mail-actions) et composants UI (mail/*).
export interface AppMailbox {
  id: string
  name: string
  role: string | null // 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | null
  unreadEmails: number
  totalEmails: number
  sortOrder: number
}

// Dossiers virtuels sans mailbox JMAP réelle.
export type VirtualFolder = 'starred' | 'snoozed'

export interface MailAddress {
  name: string
  email: string
}

export interface AppThread {
  id: string // id de l'email représentatif (résultat collapsé Email/query)
  threadId: string
  subject: string
  preview: string
  from: MailAddress[]
  to: MailAddress[]
  messageCount: number
  receivedAt: string // ISO 8601
  unread: boolean // !keywords['$seen']
  starred: boolean // keywords['$flagged'] === true
  hasAttachment: boolean
  mailboxIds: string[]
}

export interface EmailListPage {
  threads: AppThread[]
  total: number
  position: number
  queryState?: string // réservé pour Email/queryChanges (Plan 4d)
}
```

- [ ] **Step 2: Vérifier le typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/mail-types.ts
git commit -m "feat(mail): shared mail types"
```

---

## Task 3: Transport JMAP utilisateur (`jmap-user.ts`)

**Files:**
- Create: `src/server/jmap-user.ts`
- Test: `src/server/jmap-user.test.ts`

- [ ] **Step 1: Écrire les tests (échouent)**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { isRedirect } from '@tanstack/react-router'

vi.mock('./session', () => ({ withFreshAccessToken: vi.fn() }))
vi.mock('./stalwart-user', () => ({ stalwartUserFetch: vi.fn() }))

import { withFreshAccessToken } from './session'
import { stalwartUserFetch } from './stalwart-user'
import { jmapUserCall, JmapUserError } from './jmap-user'

const methodCalls = [['Mailbox/get', { accountId: 'a1', ids: null }, '0']] as const

beforeEach(() => {
  vi.resetAllMocks()
})

describe('jmapUserCall', () => {
  it('envoie le batch en Bearer et retourne methodResponses', async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue('tok-123')
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(JSON.stringify({ methodResponses: [['Mailbox/get', { list: [] }, '0']] }), {
        status: 200,
      }),
    )

    const res = await jmapUserCall('sid-1', methodCalls as never)

    expect(withFreshAccessToken).toHaveBeenCalledWith('sid-1')
    const [path, token, init] = vi.mocked(stalwartUserFetch).mock.calls[0]
    expect(path).toBe('/jmap/')
    expect(token).toBe('tok-123')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.using).toContain('urn:ietf:params:jmap:mail')
    expect(body.methodCalls).toEqual(methodCalls)
    expect(res).toEqual([['Mailbox/get', { list: [] }, '0']])
  })

  it('token null → throw redirect /login', async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue(null)
    try {
      await jmapUserCall('sid-1', methodCalls as never)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(isRedirect(err)).toBe(true)
    }
  })

  it('HTTP non-2xx → JmapUserError', async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue('tok')
    vi.mocked(stalwartUserFetch).mockResolvedValue(new Response('nope', { status: 500 }))
    await expect(jmapUserCall('sid-1', methodCalls as never)).rejects.toBeInstanceOf(JmapUserError)
  })

  it('réponse method ["error", ...] → JmapUserError avec type', async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue('tok')
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(
        JSON.stringify({ methodResponses: [['error', { type: 'serverFail' }, '0']] }),
        { status: 200 },
      ),
    )
    await expect(jmapUserCall('sid-1', methodCalls as never)).rejects.toMatchObject({
      name: 'JmapUserError',
      type: 'serverFail',
    })
  })
})
```

- [ ] **Step 2: Lancer les tests (échec attendu)**

Run: `bunx vitest run src/server/jmap-user.test.ts`
Expected: FAIL (`jmap-user` introuvable).

- [ ] **Step 3: Implémenter `jmap-user.ts`**

```ts
import { redirect } from '@tanstack/react-router'
import { withFreshAccessToken } from './session'
import { stalwartUserFetch } from './stalwart-user'
import type { JmapMethodCall, JmapMethodResponse } from './jmap'

export class JmapUserError extends Error {
  constructor(
    message: string,
    readonly type?: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'JmapUserError'
  }
}

const MAIL_CAPABILITIES = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail']

// Appel JMAP batch avec le token Bearer de l'utilisateur. Session expirée → redirect /login.
export async function jmapUserCall(
  sid: string,
  methodCalls: JmapMethodCall[],
): Promise<JmapMethodResponse[]> {
  const accessToken = await withFreshAccessToken(sid)
  if (accessToken === null) throw redirect({ to: '/login' })

  const res = await stalwartUserFetch('/jmap/', accessToken, {
    method: 'POST',
    body: JSON.stringify({ using: MAIL_CAPABILITIES, methodCalls }),
  })
  if (!res.ok) throw new JmapUserError(`jmap request failed: HTTP ${res.status}`)

  const body = (await res.json()) as { methodResponses?: JmapMethodResponse[] }
  const responses = body.methodResponses ?? []
  for (const [name, args] of responses) {
    if (name === 'error') {
      const e = args as { type?: string; description?: string }
      throw new JmapUserError(e.description ?? 'jmap method error', e.type, args)
    }
  }
  return responses
}
```

- [ ] **Step 4: Lancer les tests (succès attendu)**

Run: `bunx vitest run src/server/jmap-user.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/jmap-user.ts src/server/jmap-user.test.ts
git commit -m "feat(mail): user-scoped JMAP batch transport (Bearer)"
```

---

## Task 4: `mapMailboxes` + `mailboxesFn`

**Files:**
- Create: `src/server/mail-actions.ts`
- Test: `src/server/mail-actions.test.ts`

- [ ] **Step 1: Écrire le test de `mapMailboxes` (échoue)**

```ts
import { describe, expect, it } from 'vitest'
import { mapMailboxes } from './mail-actions'
import type { JmapMethodResponse } from './jmap'

describe('mapMailboxes', () => {
  it('mappe Mailbox/get vers AppMailbox[] trié par sortOrder', () => {
    const responses: JmapMethodResponse[] = [
      [
        'Mailbox/get',
        {
          list: [
            { id: 'm2', name: 'Envoyés', role: 'sent', unreadEmails: 0, totalEmails: 3, sortOrder: 2 },
            { id: 'm1', name: 'Réception', role: 'inbox', unreadEmails: 5, totalEmails: 40, sortOrder: 1 },
          ],
        },
        '0',
      ],
    ]
    const out = mapMailboxes(responses)
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(out[0]).toMatchObject({ role: 'inbox', unreadEmails: 5, totalEmails: 40 })
  })

  it('normalise role absent en null', () => {
    const responses: JmapMethodResponse[] = [
      ['Mailbox/get', { list: [{ id: 'm1', name: 'X', unreadEmails: 0, totalEmails: 0, sortOrder: 0 }] }, '0'],
    ]
    expect(mapMailboxes(responses)[0].role).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/server/mail-actions.test.ts`
Expected: FAIL (`mapMailboxes` introuvable).

- [ ] **Step 3: Implémenter `mapMailboxes` + le squelette serveur**

Créer `src/server/mail-actions.ts` :

```ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { JmapMethodCall, JmapMethodResponse } from './jmap'
import type { AppMailbox } from './mail-types'

interface RawMailbox {
  id: string
  name: string
  role?: string | null
  unreadEmails: number
  totalEmails: number
  sortOrder: number
}

// Pur : extrait + trie les mailboxes d'une réponse Mailbox/get.
export function mapMailboxes(responses: JmapMethodResponse[]): AppMailbox[] {
  const get = responses.find(([name]) => name === 'Mailbox/get')
  const list = (get?.[1].list as RawMailbox[] | undefined) ?? []
  return list
    .map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role ?? null,
      unreadEmails: m.unreadEmails,
      totalEmails: m.totalEmails,
      sortOrder: m.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

// Récupère sid + accountId depuis la session (server-only).
async function requireSession(): Promise<{ sid: string; accountId: string }> {
  const { readSid } = await import('./session-cookie')
  const { currentSession } = await import('./session')
  const { redirect } = await import('@tanstack/react-router')
  const sid = readSid()
  const session = currentSession(sid)
  if (!sid || !session) throw redirect({ to: '/login' })
  return { sid, accountId: session.accountId }
}

export const mailboxesFn = createServerFn({ method: 'GET' }).handler(async (): Promise<AppMailbox[]> => {
  const { jmapUserCall } = await import('./jmap-user')
  const { sid, accountId } = await requireSession()
  const responses = await jmapUserCall(sid, [
    [
      'Mailbox/get',
      { accountId, ids: null, properties: ['id', 'name', 'role', 'unreadEmails', 'totalEmails', 'sortOrder'] },
      '0',
    ],
  ])
  return mapMailboxes(responses)
})
```

- [ ] **Step 4: Lancer (succès attendu)**

Run: `bunx vitest run src/server/mail-actions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(mail): mailboxesFn + mapMailboxes"
```

---

## Task 5: `resolveFilter` + `buildListMethodCalls` + `parseListPage` + `emailListFn`

**Files:**
- Modify: `src/server/mail-actions.ts`
- Modify: `src/server/mail-actions.test.ts`

- [ ] **Step 1: Ajouter les tests des helpers purs (échouent)**

Ajouter à `src/server/mail-actions.test.ts` :

```ts
import { resolveFilter, buildListMethodCalls, parseListPage } from './mail-actions'
import type { AppMailbox } from './mail-types'

const MBX: AppMailbox[] = [
  { id: 'mi', name: 'In', role: 'inbox', unreadEmails: 0, totalEmails: 0, sortOrder: 1 },
  { id: 'mt', name: 'Trash', role: 'trash', unreadEmails: 0, totalEmails: 0, sortOrder: 2 },
  { id: 'ms', name: 'Spam', role: 'spam', unreadEmails: 0, totalEmails: 0, sortOrder: 3 },
]

describe('resolveFilter', () => {
  it('dossier réel → inMailbox sur l’id du role', () => {
    expect(resolveFilter('inbox', MBX)).toEqual({ inMailbox: 'mi' })
  })

  it('starred → $flagged AND NOT (trash, spam) [R5]', () => {
    expect(resolveFilter('starred', MBX)).toEqual({
      operator: 'AND',
      conditions: [
        { hasKeyword: '$flagged' },
        { operator: 'NOT', conditions: [{ inMailbox: 'mt' }, { inMailbox: 'ms' }] },
      ],
    })
  })
})

describe('buildListMethodCalls', () => {
  it('Email/query inclut collapseThreads + calculateTotal + position/limit', () => {
    const calls = buildListMethodCalls('acc', { inMailbox: 'mi' }, 50, 50)
    const [, query] = calls[0]
    expect(query).toMatchObject({
      accountId: 'acc',
      collapseThreads: true,
      calculateTotal: true,
      position: 50,
      limit: 50,
      sort: [{ property: 'receivedAt', isAscending: false }],
    })
    expect(calls[1][0]).toBe('Email/get')
    expect(calls[2][0]).toBe('Thread/get')
    expect((calls[2][1] as Record<string, unknown>)['#ids']).toMatchObject({
      resultOf: '1',
      name: 'Email/get',
      path: '/list/*/threadId',
    })
  })
})

describe('parseListPage', () => {
  it('assemble threads (messageCount via Thread/get), total et position', () => {
    const responses: JmapMethodResponse[] = [
      ['Email/query', { total: 120, position: 0 }, '0'],
      [
        'Email/get',
        {
          list: [
            {
              id: 'e1',
              threadId: 't1',
              mailboxIds: { mi: true },
              keywords: { $flagged: true },
              from: [{ name: 'Alice', email: 'a@x.fr' }],
              to: [{ name: 'Moi', email: 'me@x.fr' }],
              subject: 'Sujet',
              preview: 'Aperçu',
              receivedAt: '2026-06-10T08:00:00Z',
              hasAttachment: true,
            },
          ],
        },
        '1',
      ],
      ['Thread/get', { list: [{ id: 't1', emailIds: ['e1', 'e2', 'e3'] }] }, '2'],
    ]
    const page = parseListPage(responses, 0)
    expect(page.total).toBe(120)
    expect(page.position).toBe(0)
    expect(page.threads).toHaveLength(1)
    expect(page.threads[0]).toMatchObject({
      id: 'e1',
      threadId: 't1',
      messageCount: 3,
      unread: false, // $seen absent ⇒ unread… voir assertion suivante
      starred: true,
      hasAttachment: true,
      mailboxIds: ['mi'],
    })
  })

  it('unread = true quand $seen absent, false quand présent', () => {
    const mk = (keywords: Record<string, boolean>): JmapMethodResponse[] => [
      ['Email/query', { total: 1, position: 0 }, '0'],
      [
        'Email/get',
        {
          list: [
            {
              id: 'e1', threadId: 't1', mailboxIds: {}, keywords,
              from: [], to: [], subject: '', preview: '', receivedAt: '2026-06-10T08:00:00Z',
              hasAttachment: false,
            },
          ],
        },
        '1',
      ],
      ['Thread/get', { list: [{ id: 't1', emailIds: ['e1'] }] }, '2'],
    ]
    expect(parseListPage(mk({}), 0).threads[0].unread).toBe(true)
    expect(parseListPage(mk({ $seen: true }), 0).threads[0].unread).toBe(false)
  })
})
```

> **Note :** dans le 1er test `parseListPage`, l'email n'a pas `$seen` → `unread: true`. Corriger l'assertion `unread: false` en `unread: true` avant d'exécuter (laissée ici pour t'obliger à lire le keyword). Valeur correcte attendue : `unread: true`.

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/server/mail-actions.test.ts`
Expected: FAIL (`resolveFilter` introuvable).

- [ ] **Step 3: Implémenter les helpers + `emailListFn`**

Ajouter à `src/server/mail-actions.ts` :

```ts
import type { AppThread, EmailListPage, MailAddress } from './mail-types'

type JmapFilter = Record<string, unknown>

function mailboxIdByRole(mailboxes: AppMailbox[], role: string): string | undefined {
  return mailboxes.find((m) => m.role === role)?.id
}

// Pur : dossier URL → filtre JMAP. 'starred' exclut corbeille/spam (R5, aligné Gmail).
export function resolveFilter(folder: string, mailboxes: AppMailbox[]): JmapFilter {
  if (folder === 'starred') {
    const exclude: JmapFilter[] = []
    const trash = mailboxIdByRole(mailboxes, 'trash')
    const spam = mailboxIdByRole(mailboxes, 'spam')
    if (trash) exclude.push({ inMailbox: trash })
    if (spam) exclude.push({ inMailbox: spam })
    return {
      operator: 'AND',
      conditions: [{ hasKeyword: '$flagged' }, { operator: 'NOT', conditions: exclude }],
    }
  }
  const id = mailboxIdByRole(mailboxes, folder)
  return { inMailbox: id }
}

// Pur : batch Email/query + Email/get + Thread/get.
export function buildListMethodCalls(
  accountId: string,
  filter: JmapFilter,
  position: number,
  limit: number,
): JmapMethodCall[] {
  return [
    [
      'Email/query',
      {
        accountId,
        collapseThreads: true,
        calculateTotal: true,
        filter,
        sort: [{ property: 'receivedAt', isAscending: false }],
        position,
        limit,
      },
      '0',
    ],
    [
      'Email/get',
      {
        accountId,
        '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' },
        properties: [
          'id', 'threadId', 'mailboxIds', 'keywords',
          'from', 'to', 'subject', 'preview', 'receivedAt', 'hasAttachment',
        ],
      },
      '1',
    ],
    ['Thread/get', { accountId, '#ids': { resultOf: '1', name: 'Email/get', path: '/list/*/threadId' } }, '2'],
  ]
}

interface RawEmail {
  id: string
  threadId: string
  mailboxIds: Record<string, boolean>
  keywords: Record<string, boolean>
  from?: MailAddress[] | null
  to?: MailAddress[] | null
  subject?: string
  preview?: string
  receivedAt: string
  hasAttachment?: boolean
}

// Pur : assemble la page depuis les 3 réponses du batch.
export function parseListPage(responses: JmapMethodResponse[], position: number): EmailListPage {
  const query = responses.find(([n]) => n === 'Email/query')?.[1] as
    | { total?: number; queryState?: string }
    | undefined
  const emails = (responses.find(([n]) => n === 'Email/get')?.[1].list as RawEmail[] | undefined) ?? []
  const threads = (responses.find(([n]) => n === 'Thread/get')?.[1].list as
    | { id: string; emailIds: string[] }[]
    | undefined) ?? []
  const countByThread = new Map(threads.map((t) => [t.id, t.emailIds.length]))

  const appThreads: AppThread[] = emails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    subject: e.subject ?? '',
    preview: e.preview ?? '',
    from: e.from ?? [],
    to: e.to ?? [],
    messageCount: countByThread.get(e.threadId) ?? 1,
    receivedAt: e.receivedAt,
    unread: e.keywords?.$seen !== true,
    starred: e.keywords?.$flagged === true,
    hasAttachment: e.hasAttachment === true,
    mailboxIds: Object.keys(e.mailboxIds ?? {}),
  }))

  return {
    threads: appThreads,
    total: query?.total ?? appThreads.length,
    position,
    queryState: query?.queryState,
  }
}

const emailListSchema = z.object({
  folder: z.string().min(1).max(64),
  position: z.number().int().min(0),
  limit: z.number().int().min(1).max(200),
})

export const emailListFn = createServerFn({ method: 'GET' })
  .validator((d: { folder: string; position: number; limit: number }) => emailListSchema.parse(d))
  .handler(async ({ data }): Promise<EmailListPage> => {
    const { jmapUserCall } = await import('./jmap-user')
    const { sid, accountId } = await requireSession()
    // Les ids trash/spam (pour 'starred') et l'id du dossier viennent de Mailbox/get.
    const mbxResponses = await jmapUserCall(sid, [
      ['Mailbox/get', { accountId, ids: null, properties: ['id', 'role'] }, '0'],
    ])
    const mailboxes = mapMailboxes(mbxResponses)
    const filter = resolveFilter(data.folder, mailboxes)
    const responses = await jmapUserCall(sid, buildListMethodCalls(accountId, filter, data.position, data.limit))
    return parseListPage(responses, data.position)
  })
```

- [ ] **Step 4: Corriger l'assertion `unread` puis lancer**

Dans le 1er test `parseListPage`, remplacer `unread: false,` par `unread: true,` (l'email n'a pas `$seen`).

Run: `bunx vitest run src/server/mail-actions.test.ts`
Expected: PASS (tous).

- [ ] **Step 5: Typecheck + Commit**

Run: `bun run typecheck` → PASS

```bash
git add src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(mail): emailListFn windowed range fetch (query+get+thread, R5 starred filter)"
```

---

## Task 6: CSS + thème sur `<html>` + police Onest

**Files:**
- Create: `src/components/mail/mail.css`
- Modify: `src/routes/__root.tsx`

- [ ] **Step 1: Porter les variables + styles de la maquette**

Copier le contenu de `/tmp/wmx/webmail/project/mail.css` dans `src/components/mail/mail.css`. **Adapter uniquement** :
- garder le bloc de variables `:root` / `[data-theme='light']` / `[data-theme='dark']` (lignes ~1-78) **tel quel** ;
- conserver les sélos de structure utilisés en 4a : `.app`, `.nav`, `.nav-head`, `.brand-*`, `.account*`, `.compose-btn`, `.nav-scroll`, `.nav-section`, `.nav-item*`, `.list`, `.list-top`, `.list-toolbar`, `.list-rows`, `.list-loader`, `.row*`, `.unread-dot`, `.snippet`, `.from-name`, `.um-*` ;
- les sélecteurs liés au Reader / Composer / Settings / Calendar (hors 4a) peuvent rester (inertes, non rendus) — ne pas les supprimer pour préserver la fidélité au fil des plans suivants.

Vérifier que la 1ʳᵉ ligne du bloc variables fixe `--row-pad-y: 9px;` (défaut regular).

- [ ] **Step 2: Importer le CSS et la police, appliquer `data-theme` sur `<html>`**

Dans `src/routes/__root.tsx` :

Ajouter en tête des imports :

```tsx
import '@fontsource-variable/onest'
import { getThemeFn } from '../server/setup-theme'
```

> Vérifier le nom exact de la server fn exportée par `src/server/setup-theme.ts` (lue dans la spec : lit le cookie `stalmail_theme`). Si elle s'appelle autrement, utiliser ce nom.

Étendre le `loader` racine pour charger le thème en plus de la langue :

```tsx
  loader: async () => {
    const { lang } = await getServerLang()
    const { theme } = await getThemeFn()
    return { lang, theme }
  },
```

Dans `RootDocument`, lire le thème et le poser sur `<html>` :

```tsx
function RootDocument({ children }: { children: React.ReactNode }) {
  const { lang, theme } = Route.useLoaderData()
  const i18n = createI18n(lang)
  return (
    <html lang={lang} data-theme={theme}>
      {/* …inchangé… */}
    </html>
  )
}
```

Importer la feuille `mail.css` côté route mail (Task 15) ou globalement ici via `import mailCss from '../components/mail/mail.css?url'` ajouté aux `links`. **Choix retenu :** l'importer dans la route mail (Task 15) pour ne pas charger le CSS mail sur login/setup.

- [ ] **Step 3: Vérifier le typecheck + que l'app démarre**

Run: `bun run typecheck` → PASS
Run: `bun run dev` puis ouvrir `/login` — la page se charge, la police Onest est active, le thème (clair/sombre selon cookie) s'applique sur `<html>`. Arrêter le serveur.

- [ ] **Step 4: Commit**

```bash
git add src/components/mail/mail.css src/routes/__root.tsx
git commit -m "feat(mail): port mockup CSS, theme on <html>, self-hosted Onest font"
```

---

## Task 7: Icônes + Avatar (`mail-icons.tsx`)

**Files:**
- Create: `src/components/mail/mail-icons.tsx`
- Test: `src/components/mail/mail-icons.test.tsx`

- [ ] **Step 1: Écrire les tests (échouent)**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Icon, Avatar, initialsOf, hashColor } from './mail-icons'

describe('initialsOf', () => {
  it('prend les 2 premières initiales', () => {
    expect(initialsOf('Alice Martin')).toBe('AM')
    expect(initialsOf('Bob')).toBe('B')
    expect(initialsOf('')).toBe('?')
  })
})

describe('hashColor', () => {
  it('est stable par entrée', () => {
    expect(hashColor('a@x.fr')).toBe(hashColor('a@x.fr'))
  })
  it('renvoie une couleur CSS', () => {
    expect(hashColor('a@x.fr')).toMatch(/^(hsl|#)/)
  })
})

describe('Icon', () => {
  it('rend un svg pour un nom connu', () => {
    const { container } = render(<Icon name="inbox" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})

describe('Avatar', () => {
  it('affiche les initiales', () => {
    render(<Avatar name="Alice Martin" email="a@x.fr" />)
    expect(screen.getByText('AM')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/components/mail/mail-icons.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter `mail-icons.tsx`**

Porter `ICON_PATHS` depuis `/tmp/wmx/webmail/project/mail-icons.jsx` (au moins : `inbox, star, star-fill, clock, send, draft, archive, spam, trash, search, compose, calendar, tag, paperclip, more, moreV, chevDown, reply, replyAll, forward`).

```tsx
import type { CSSProperties } from 'react'

const ICON_PATHS: Record<string, string> = {
  inbox: '<path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M3 13h5l1.5 2.5h5L16 13h5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 17.1 6.75 19.7l1-5.86L3.5 9.66l5.9-.86z"/>',
  'star-fill': '<path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 17.1 6.75 19.7l1-5.86L3.5 9.66l5.9-.86z" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  send: '<path d="M21 4L3 11l6.5 2.5M21 4l-7 16-3.5-9M21 4L10.5 13.5"/>',
  draft: '<path d="M12 20h7M4 20h2.5l9.4-9.4a1.8 1.8 0 0 0 0-2.5l-1-1a1.8 1.8 0 0 0-2.5 0L3 16.5V20z"/>',
  archive: '<rect x="3.5" y="5" width="17" height="4" rx="1"/><path d="M5 9v8.5A1.5 1.5 0 0 0 6.5 19h11A1.5 1.5 0 0 0 19 17.5V9M9.5 13h5"/>',
  spam: '<path d="M12 3.5l8.5 4.5v4c0 4.7-3.4 7.7-8.5 9-5.1-1.3-8.5-4.3-8.5-9V8z"/><path d="M12 8.5v4M12 15.5v.01"/>',
  trash: '<path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 19L18 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.8-3.8"/>',
  compose: '<path d="M4 20h7M13.5 6.5l3 3M5 16.5l9.5-9.5a1.9 1.9 0 0 1 2.7 0l.8.8a1.9 1.9 0 0 1 0 2.7L8.5 20H5z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3.5v3.5M16 3.5v3.5"/>',
  tag: '<path d="M3.5 12.5l8-8H19a1.5 1.5 0 0 1 1.5 1.5v7.5l-8 8a1.5 1.5 0 0 1-2.1 0l-6.9-6.9a1.5 1.5 0 0 1 0-2.1z"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/>',
  paperclip: '<path d="M18 8.5l-7.6 7.6a3 3 0 0 1-4.2-4.2l8-8a4.2 4.2 0 0 1 6 6l-8 8"/>',
}

export function Icon({
  name,
  size = 18,
  style,
  className,
}: {
  name: keyof typeof ICON_PATHS | string
  size?: number
  style?: CSSProperties
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? '' }}
    />
  )
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

const PALETTE = ['#2a6fdb', '#d6336c', '#7048e8', '#0c8599', '#e8590c', '#2b8a3e', '#5f3dc4', '#c2255c']

export function hashColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function Avatar({ name, email, size = 36 }: { name: string; email: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: hashColor(email || name) }}
      aria-hidden="true"
    >
      {initialsOf(name || email)}
    </span>
  )
}
```

- [ ] **Step 4: Lancer (succès attendu)**

Run: `bunx vitest run src/components/mail/mail-icons.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/mail-icons.tsx src/components/mail/mail-icons.test.tsx
git commit -m "feat(mail): Icon + Avatar + initials/hashColor helpers"
```

---

## Task 8: Format de date FR (`format-date.ts`)

**Files:**
- Create: `src/components/mail/format-date.ts`
- Test: `src/components/mail/format-date.test.ts`

- [ ] **Step 1: Écrire les tests (échouent)**

```ts
import { describe, expect, it } from 'vitest'
import { formatThreadDate } from './format-date'

const now = new Date('2026-06-12T10:00:00')

describe('formatThreadDate', () => {
  it('aujourd’hui → heure HH:MM', () => {
    expect(formatThreadDate('2026-06-12T08:30:00', now)).toBe('08:30')
  })
  it('hier → "Hier"', () => {
    expect(formatThreadDate('2026-06-11T22:00:00', now)).toBe('Hier')
  })
  it('même semaine → jour de la semaine', () => {
    // 2026-06-08 = lundi
    expect(formatThreadDate('2026-06-08T09:00:00', now)).toBe('lun.')
  })
  it('plus ancien → JJ/MM', () => {
    expect(formatThreadDate('2026-05-02T09:00:00', now)).toBe('02/05')
  })
})
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/components/mail/format-date.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

```ts
// Format de date d'une ligne de liste (FR), aligné sur la maquette.
// `now` injecté pour des tests déterministes.
export function formatThreadDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayMs = 86_400_000
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / dayMs)

  if (diffDays <= 0) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }
  if (diffDays === 1) return 'Hier'
  if (diffDays < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' })
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}
```

> **Note d'exécution :** les formats `toLocaleTimeString`/`toLocaleDateString` dépendent de l'ICU de l'environnement. Si l'assertion `'lun.'` ou `'08:30'` diffère (espace insécable, point), ajuster l'assertion du test à la sortie réelle observée **une seule fois** (ne pas modifier la logique). Lancer d'abord pour constater la sortie exacte.

- [ ] **Step 4: Lancer (succès attendu, après calage éventuel des assertions)**

Run: `bunx vitest run src/components/mail/format-date.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/format-date.ts src/components/mail/format-date.test.ts
git commit -m "feat(mail): FR thread date formatting"
```

---

## Task 9: `ThreadRow` (read-only + skeleton)

**Files:**
- Create: `src/components/mail/thread-row.tsx`
- Test: `src/components/mail/thread-row.test.tsx`

- [ ] **Step 1: Écrire les tests (échouent)**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThreadRow } from './thread-row'
import type { AppThread } from '../../server/mail-types'

const base: AppThread = {
  id: 'e1', threadId: 't1', subject: 'Sujet', preview: 'Aperçu',
  from: [{ name: 'Alice Martin', email: 'a@x.fr' }],
  to: [{ name: 'Bob Client', email: 'b@x.fr' }],
  messageCount: 1, receivedAt: '2026-06-12T08:00:00', unread: false,
  starred: false, hasAttachment: false, mailboxIds: ['mi'],
}
const now = new Date('2026-06-12T10:00:00')

describe('ThreadRow', () => {
  it('point non-lu visible si unread', () => {
    const { container } = render(<ThreadRow thread={{ ...base, unread: true }} folder="inbox" now={now} />)
    expect(container.querySelector('.unread-dot')).toBeInTheDocument()
  })

  it('icône étoile pleine si starred', () => {
    const { container } = render(<ThreadRow thread={{ ...base, starred: true }} folder="inbox" now={now} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.querySelector('.row-star')).toBeInTheDocument()
  })

  it('trombone si hasAttachment', () => {
    const { container } = render(<ThreadRow thread={{ ...base, hasAttachment: true }} folder="inbox" now={now} />)
    expect(container.querySelector('.row-attach')).toBeInTheDocument()
  })

  it('compteur +N si messageCount > 1', () => {
    render(<ThreadRow thread={{ ...base, messageCount: 4 }} folder="inbox" now={now} />)
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('affiche l’expéditeur dans inbox', () => {
    render(<ThreadRow thread={base} folder="inbox" now={now} />)
    expect(screen.getByText('Alice Martin')).toBeInTheDocument()
  })

  it('affiche le destinataire dans sent', () => {
    render(<ThreadRow thread={base} folder="sent" now={now} />)
    expect(screen.getByText('Bob Client')).toBeInTheDocument()
  })

  it('rend un skeleton quand thread est undefined', () => {
    const { container } = render(<ThreadRow thread={undefined} folder="inbox" now={now} />)
    expect(container.querySelector('.row-skeleton')).toBeInTheDocument()
    expect(container.querySelector('.unread-dot')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/components/mail/thread-row.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter `thread-row.tsx`**

```tsx
import { Icon, Avatar } from './mail-icons'
import { formatThreadDate } from './format-date'
import type { AppThread } from '../../server/mail-types'

const RECIPIENT_FOLDERS = new Set(['sent', 'drafts'])

export function ThreadRow({
  thread,
  folder,
  selected = false,
  now,
  onOpen,
}: {
  thread: AppThread | undefined
  folder: string
  selected?: boolean
  now?: Date
  onOpen?: (id: string) => void
}) {
  if (!thread) {
    return (
      <div className="row row-skeleton" aria-hidden="true">
        <div className="row-rail">
          <span className="avatar avatar-skel" />
        </div>
        <div className="row-main">
          <div className="skel-line skel-line-1" />
          <div className="skel-line skel-line-2" />
        </div>
      </div>
    )
  }

  const lead = RECIPIENT_FOLDERS.has(folder) ? thread.to[0] : thread.from[0]
  const leadName = lead?.name || lead?.email || '—'
  const leadEmail = lead?.email || ''

  return (
    <div
      className={'row' + (thread.unread ? ' unread' : '') + (selected ? ' sel' : '')}
      onClick={() => onOpen?.(thread.id)}
    >
      <div className="row-rail">
        <span className="unread-dot" />
        <Avatar name={leadName} email={leadEmail} />
      </div>
      <div className="row-main">
        <div className="row-line1">
          <span className="from-name">{leadName}</span>
          {thread.messageCount > 1 && <span className="thread-count">{thread.messageCount}</span>}
          {thread.starred && <Icon name="star-fill" size={14} className="row-star" />}
          <span className="row-date">{formatThreadDate(thread.receivedAt, now)}</span>
        </div>
        <div className="row-line2">
          <span className="subject">{thread.subject}</span>
          <span className="snippet">{thread.preview}</span>
          {thread.hasAttachment && <Icon name="paperclip" size={14} className="row-attach" />}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Lancer (succès attendu)**

Run: `bunx vitest run src/components/mail/thread-row.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/thread-row.tsx src/components/mail/thread-row.test.tsx
git commit -m "feat(mail): read-only ThreadRow with skeleton state"
```

---

## Task 10: Hook de fenêtrage (`use-windowed-threads.ts`)

**Files:**
- Create: `src/components/mail/use-windowed-threads.ts`
- Test: `src/components/mail/use-windowed-threads.test.ts`

> Ce fichier de test est sous `src/components/**` → projet **client** (jsdom). Les helpers testés sont purs ; pas de DOM requis.

- [ ] **Step 1: Écrire les tests des helpers purs (échouent)**

```ts
import { describe, expect, it } from 'vitest'
import { pageIndexesForItems, threadAt } from './use-windowed-threads'
import type { AppThread, EmailListPage } from '../../server/mail-types'

describe('pageIndexesForItems', () => {
  it('mappe les index visibles vers les plages distinctes', () => {
    // PAGE=50 : index 48 et 51 → plages 0 et 1
    expect(pageIndexesForItems([48, 49, 50, 51], 50)).toEqual([0, 1])
  })
  it('dédoublonne', () => {
    expect(pageIndexesForItems([0, 1, 2], 50)).toEqual([0])
  })
})

describe('threadAt', () => {
  const page0: EmailListPage = {
    total: 120, position: 0,
    threads: [{ id: 'e0' } as AppThread, { id: 'e1' } as AppThread],
  }
  const pages = new Map<number, EmailListPage>([[0, page0]])

  it('résout un index chargé vers son AppThread', () => {
    expect(threadAt(pages, 1, 50)?.id).toBe('e1')
  })
  it('renvoie undefined (skeleton) si la plage n’est pas chargée', () => {
    expect(threadAt(pages, 60, 50)).toBeUndefined()
  })
  it('renvoie undefined si l’index dépasse la plage chargée', () => {
    expect(threadAt(pages, 5, 50)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/components/mail/use-windowed-threads.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter le hook + helpers**

```ts
import { useEffect, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { emailListFn } from '../../server/mail-actions'
import type { AppThread, EmailListPage } from '../../server/mail-types'

export const PAGE = 50

// Pur : index visibles → plages distinctes triées.
export function pageIndexesForItems(indexes: number[], page: number): number[] {
  const set = new Set(indexes.map((i) => Math.floor(i / page)))
  return [...set].sort((a, b) => a - b)
}

// Pur : index absolu → AppThread chargé, ou undefined (skeleton).
export function threadAt(
  pages: Map<number, EmailListPage>,
  index: number,
  page: number,
): AppThread | undefined {
  const p = pages.get(Math.floor(index / page))
  return p?.threads[index % page]
}

// Débounce d'un tableau de plages : ne propage qu'après `delay` ms de stabilité.
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  const ref = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    clearTimeout(ref.current)
    ref.current = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(ref.current)
  }, [value, delay])
  return debounced
}

export function useWindowedThreads(folder: string, visibleIndexes: number[]) {
  const needKey = pageIndexesForItems(visibleIndexes, PAGE).join(',')
  const debouncedKey = useDebounced(needKey, 120)
  const neededPages = debouncedKey === '' ? [] : debouncedKey.split(',').map(Number)

  const results = useQueries({
    queries: neededPages.map((p) => ({
      queryKey: ['threads', folder, p] as const,
      queryFn: () => emailListFn({ data: { folder, position: p * PAGE, limit: PAGE } }),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    })),
  })

  const pages = new Map<number, EmailListPage>()
  results.forEach((r, i) => {
    if (r.data) pages.set(neededPages[i], r.data)
  })

  const total = [...pages.values()][0]?.total
  const isError = results.some((r) => r.isError)

  return {
    total,
    isError,
    threadAt: (index: number) => threadAt(pages, index, PAGE),
  }
}
```

> **Note :** l'appel client d'une server fn TanStack Start est `emailListFn({ data: {...} })`. Vérifier la forme exacte attendue par le validator (cf. usage de `loginFn` dans le code login). Ajuster si l'API diffère.

- [ ] **Step 4: Lancer (succès attendu)**

Run: `bunx vitest run src/components/mail/use-windowed-threads.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/use-windowed-threads.ts src/components/mail/use-windowed-threads.test.ts
git commit -m "feat(mail): windowed threads hook (pure pageIndexes/threadAt + debounced useQueries)"
```

---

## Task 11: `ThreadList` (virtualizer sur le total)

**Files:**
- Create: `src/components/mail/thread-list.tsx`
- Test: `src/components/mail/thread-list.test.tsx`

- [ ] **Step 1: Écrire le test (échoue)**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThreadList } from './thread-list'
import type { AppThread, EmailListPage } from '../../server/mail-types'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const mk = (id: string): AppThread => ({
  id, threadId: id, subject: `Sujet ${id}`, preview: 'p', from: [{ name: 'A', email: 'a@x' }],
  to: [], messageCount: 1, receivedAt: '2026-06-12T08:00:00', unread: false, starred: false,
  hasAttachment: false, mailboxIds: ['mi'],
})

describe('ThreadList', () => {
  it('rend les threads fournis par le hook injecté et le total', () => {
    const page: EmailListPage = { total: 2, position: 0, threads: [mk('e0'), mk('e1')] }
    const useThreads = () => ({
      total: page.total,
      isError: false,
      threadAt: (i: number) => page.threads[i],
    })
    wrap(<ThreadList folder="inbox" useThreadsHook={useThreads} />)
    expect(screen.getByText('Sujet e0')).toBeInTheDocument()
    expect(screen.getByText('Sujet e1')).toBeInTheDocument()
  })

  it('affiche un message d’erreur si isError', () => {
    const useThreads = () => ({ total: 0, isError: true, threadAt: () => undefined })
    wrap(<ThreadList folder="inbox" useThreadsHook={useThreads} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
```

> **Pattern d'injection :** `ThreadList` accepte une prop optionnelle `useThreadsHook` (défaut = `useWindowedThreads`) pour rester testable sans virtualizer réel ni réseau. En prod, la prop n'est pas passée.

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/components/mail/thread-list.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter `thread-list.tsx`**

```tsx
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { ThreadRow } from './thread-row'
import { useWindowedThreads } from './use-windowed-threads'
import type { AppThread } from '../../server/mail-types'

interface ThreadsHookResult {
  total: number | undefined
  isError: boolean
  threadAt: (index: number) => AppThread | undefined
}
type ThreadsHook = (folder: string, visibleIndexes: number[]) => ThreadsHookResult

const ROW_HEIGHT = 64
const PROVISIONAL_COUNT = 30

export function ThreadList({
  folder,
  provisionalCount,
  useThreadsHook = useWindowedThreads,
}: {
  folder: string
  provisionalCount?: number // = mailbox.totalEmails passé par le parent (R2)
  useThreadsHook?: ThreadsHook
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  // 1er rendu : on ne connaît pas encore les index visibles → on déclenche au moins la plage 0.
  const fallbackCount = provisionalCount ?? PROVISIONAL_COUNT
  const probe = useThreadsHook(folder, [0])
  const count = probe.total ?? fallbackCount

  const virt = useVirtualizer({
    count,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getScrollElement: () => scrollRef.current,
  })

  const visible = virt.getVirtualItems().map((v) => v.index)
  const threads = useThreadsHook(folder, visible.length ? visible : [0])

  if (threads.isError) {
    return (
      <div className="list-error" role="alert">
        {t('mail.error')}
      </div>
    )
  }

  return (
    <div className="list-rows" ref={scrollRef}>
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((item) => (
          <div
            key={item.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: item.size,
              transform: `translateY(${item.start}px)`,
            }}
          >
            <ThreadRow thread={threads.threadAt(item.index)} folder={folder} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

> **Note jsdom :** `useVirtualizer` mesure des éléments dont la hauteur est 0 en jsdom ; le test injecte un hook simplifié et n'assert pas la virtualisation au pixel. Si aucun item n'est rendu en test (hauteur 0), forcer le `count` via le hook injecté suffit à rendre les premières lignes — sinon, dans le test, rendre directement les threads `0..total-1` via un chemin sans virtualizer gardé par `import.meta.env`. **Préférence :** garder le composant simple ; si le virtualizer ne produit pas d'items en jsdom, ajuster le test pour vérifier le rendu via `threadAt` appelé sur `0..total-1` (le composant peut, quand `getVirtualItems()` est vide mais `count>0`, rendre un fallback non-virtualisé des `count` premières lignes plafonné à 50). Implémenter ce fallback :

```tsx
  const items = virt.getVirtualItems()
  const rows = items.length
    ? items
    : Array.from({ length: Math.min(count, 50) }, (_, i) => ({ key: i, index: i, size: ROW_HEIGHT, start: i * ROW_HEIGHT }))
```

Et itérer sur `rows` au lieu de `virt.getVirtualItems()`.

- [ ] **Step 4: Lancer (succès attendu)**

Run: `bunx vitest run src/components/mail/thread-list.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/thread-list.tsx src/components/mail/thread-list.test.tsx
git commit -m "feat(mail): virtualized ThreadList over total with skeleton rows"
```

---

## Task 12: `AppSidebar`

**Files:**
- Create: `src/components/mail/sidebar.tsx`
- Test: `src/components/mail/sidebar.test.tsx`

- [ ] **Step 1: Écrire le test (échoue)**

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../../i18n/i18n'
import { AppSidebar, FOLDER_ORDER } from './sidebar'
import type { AppMailbox } from '../../server/mail-types'

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)
}

const mailboxes: AppMailbox[] = [
  { id: 'mi', name: 'Réception', role: 'inbox', unreadEmails: 3, totalEmails: 40, sortOrder: 1 },
  { id: 'ms', name: 'Envoyés', role: 'sent', unreadEmails: 0, totalEmails: 10, sortOrder: 2 },
]

describe('AppSidebar', () => {
  it('ordonne les dossiers selon FOLDER_ORDER (virtuels après inbox)', () => {
    expect(FOLDER_ORDER.slice(0, 3)).toEqual(['inbox', 'starred', 'snoozed'])
  })

  it('marque le dossier actif', () => {
    const { container } = wrap(<AppSidebar mailboxes={mailboxes} activeFolder="inbox" accountName="me@x.fr" />)
    const active = container.querySelector('.nav-item.active')
    expect(active?.textContent).toContain('Boîte de réception')
  })

  it('affiche le compteur non-lus sur inbox', () => {
    wrap(<AppSidebar mailboxes={mailboxes} activeFolder="inbox" accountName="me@x.fr" />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('bouton composer désactivé (Plan 4c)', () => {
    wrap(<AppSidebar mailboxes={mailboxes} activeFolder="inbox" accountName="me@x.fr" />)
    expect(screen.getByRole('button', { name: /nouveau message/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/components/mail/sidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter `sidebar.tsx`**

```tsx
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Icon } from './mail-icons'
import type { AppMailbox } from '../../server/mail-types'

// Ordre figé sur la maquette : virtuels intercalés après inbox (spec §2.2).
export const FOLDER_ORDER = [
  'inbox', 'starred', 'snoozed', 'sent', 'drafts', 'archive', 'spam', 'trash',
] as const

const ICON_BY_FOLDER: Record<string, string> = {
  inbox: 'inbox', starred: 'star', snoozed: 'clock', sent: 'send',
  drafts: 'draft', archive: 'archive', spam: 'spam', trash: 'trash',
}
const VIRTUAL = new Set(['starred', 'snoozed'])
const UNREAD_BADGE_ON = new Set(['inbox', 'drafts'])

export function AppSidebar({
  mailboxes,
  activeFolder,
  accountName,
}: {
  mailboxes: AppMailbox[]
  activeFolder: string
  accountName: string
}) {
  const { t } = useTranslation()
  const byRole = new Map(mailboxes.filter((m) => m.role).map((m) => [m.role!, m]))

  return (
    <nav className="nav">
      <div className="nav-head">
        <div className="account">
          <span className="avatar" aria-hidden="true">
            {accountName.slice(0, 1).toUpperCase()}
          </span>
          <span className="meta">
            <b>{accountName}</b>
            <span>{accountName}</span>
          </span>
        </div>
      </div>

      <button className="compose-btn" disabled aria-label={t('mail.compose')}>
        <Icon name="compose" size={16} />
        {t('mail.compose')}
      </button>

      <div className="nav-scroll">
        {FOLDER_ORDER.map((folder) => {
          const mbx = byRole.get(folder)
          const unread = mbx?.unreadEmails ?? 0
          return (
            <Link
              key={folder}
              to="/mail/$folder"
              params={{ folder }}
              className={'nav-item' + (folder === activeFolder ? ' active' : '')}
            >
              <Icon name={ICON_BY_FOLDER[folder]} size={18} className="ico" />
              <span className="txt">{t(`mail.${folder}`)}</span>
              {UNREAD_BADGE_ON.has(folder) && unread > 0 && <span className="count">{unread}</span>}
            </Link>
          )
        })}
        {/* Dossiers virtuels sans mailbox (starred/snoozed) : rendus via FOLDER_ORDER ci-dessus. */}
      </div>
    </nav>
  )
}

// Référence pour éviter l'avertissement d'import inutilisé si VIRTUAL non employé ailleurs.
void VIRTUAL
```

> Retirer la ligne `void VIRTUAL` et la constante `VIRTUAL` si non utilisées (YAGNI) — elles documentent juste quels dossiers n'ont pas de mailbox.

- [ ] **Step 4: Lancer (succès attendu)**

Run: `bunx vitest run src/components/mail/sidebar.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/sidebar.tsx src/components/mail/sidebar.test.tsx
git commit -m "feat(mail): AppSidebar with fixed folder order and unread badges"
```

---

## Task 13: `MailLayout` + re-exports

**Files:**
- Create: `src/components/mail/layout.tsx`
- Create: `src/components/mail/index.ts`
- Test: `src/components/mail/layout.test.tsx`

- [ ] **Step 1: Écrire le test (échoue)**

```tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MailLayout } from './layout'

describe('MailLayout', () => {
  it('rend la grille 3 colonnes avec sidebar, liste et reader', () => {
    const { container } = render(
      <MailLayout sidebar={<div data-testid="sb" />} list={<div data-testid="ls" />} />,
    )
    expect(container.querySelector('.app')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="sb"]')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="ls"]')).toBeInTheDocument()
    expect(container.querySelector('.reader-placeholder')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/components/mail/layout.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter `layout.tsx` + `index.ts`**

`src/components/mail/layout.tsx` :

```tsx
import type { ReactNode } from 'react'

export function MailLayout({ sidebar, list }: { sidebar: ReactNode; list: ReactNode }) {
  return (
    <div className="app">
      {sidebar}
      <section className="list">{list}</section>
      <section className="reader reader-placeholder" aria-hidden="true" />
    </div>
  )
}
```

`src/components/mail/index.ts` :

```ts
export { MailLayout } from './layout'
export { AppSidebar, FOLDER_ORDER } from './sidebar'
export { ThreadList } from './thread-list'
export { ThreadRow } from './thread-row'
export { Icon, Avatar } from './mail-icons'
```

- [ ] **Step 4: Lancer (succès attendu)**

Run: `bunx vitest run src/components/mail/layout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/layout.tsx src/components/mail/index.ts src/components/mail/layout.test.tsx
git commit -m "feat(mail): 3-column MailLayout + barrel exports"
```

---

## Task 14: i18n — namespace `mail`

**Files:**
- Modify: `src/i18n/resources.ts`

- [ ] **Step 1: Ajouter le bloc `mail` à `fr`**

Dans `src/i18n/resources.ts`, à l'intérieur de l'objet `fr`, après le bloc `login: { … }` (avant la fermeture `} as const`), ajouter :

```ts
  mail: {
    inbox: 'Boîte de réception',
    sent: 'Envoyés',
    drafts: 'Brouillons',
    trash: 'Corbeille',
    spam: 'Indésirables',
    archive: 'Archivés',
    starred: 'Favoris',
    snoozed: 'En attente',
    loading: 'Chargement…',
    empty: 'Aucun message',
    snoozedUnavailable: 'Disponible prochainement',
    error: 'Impossible de charger les messages.',
    today: 'Aujourd’hui',
    yesterday: 'Hier',
    labels: 'Étiquettes',
    compose: 'Nouveau message',
  },
```

- [ ] **Step 2: Ajouter le bloc `mail` à `en` (parité stricte)**

Dans l'objet `en`, ajouter le même bloc avec les valeurs anglaises :

```ts
  mail: {
    inbox: 'Inbox',
    sent: 'Sent',
    drafts: 'Drafts',
    trash: 'Trash',
    spam: 'Spam',
    archive: 'Archive',
    starred: 'Starred',
    snoozed: 'Snoozed',
    loading: 'Loading…',
    empty: 'No messages',
    snoozedUnavailable: 'Coming soon',
    error: 'Unable to load messages.',
    today: 'Today',
    yesterday: 'Yesterday',
    labels: 'Labels',
    compose: 'New message',
  },
```

- [ ] **Step 3: Lancer la parité i18n**

Run: `bunx vitest run src/i18n/resources.test.ts`
Expected: PASS (clés fr/en identiques, placeholders cohérents).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/resources.ts
git commit -m "feat(mail): i18n mail namespace (fr + en)"
```

---

## Task 15: Route `/mail/$folder` — branchement final + test d'intégration

**Files:**
- Modify: `src/routes/mail/$folder.tsx`
- Create: `src/routes/mail/$folder.test.tsx`

- [ ] **Step 1: Écrire le test d'intégration (échoue)**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createI18n } from '../../i18n/i18n'
import { MailPage } from './$folder'
import type { AppMailbox } from '../../server/mail-types'

// La route lit folder via useParams et mailboxes via loader : on teste le composant
// MailPage exporté avec props injectées (pas le routing complet).
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return { ...actual, Link: (p: { children?: React.ReactNode }) => <a>{p.children}</a> }
})

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  )
}

const mailboxes: AppMailbox[] = [
  { id: 'mi', name: 'In', role: 'inbox', unreadEmails: 2, totalEmails: 5, sortOrder: 1 },
]

describe('MailPage', () => {
  it('monte la sidebar (dossiers) et la liste pour le folder courant', () => {
    wrap(<MailPage folder="inbox" mailboxes={mailboxes} />)
    expect(screen.getByText('Boîte de réception')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /nouveau message/i })).toBeInTheDocument()
  })
})
```

> Pour rendre `MailPage` testable, l'exporter en composant **présentationnel** prenant `folder` + `mailboxes` en props ; le wrapper de route lit `useParams`/`useLoaderData` et lui passe les valeurs.

- [ ] **Step 2: Lancer (échec attendu)**

Run: `bunx vitest run src/routes/mail/$folder.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Réécrire `$folder.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { requireAuth } from '@/lib/auth-guard'
import { mailboxesFn } from '@/server/mail-actions'
import { MailLayout, AppSidebar, ThreadList } from '@/components/mail'
import type { AppMailbox } from '@/server/mail-types'
import '@/components/mail/mail.css'

export const Route = createFileRoute('/mail/$folder')({
  beforeLoad: () => requireAuth(),
  loader: async () => {
    const mailboxes = await mailboxesFn()
    return { mailboxes }
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { folder } = Route.useParams()
  const { mailboxes } = Route.useLoaderData()
  const { accountName } = Route.useRouteContext() as { accountName: string }
  return <MailPage folder={folder} mailboxes={mailboxes} accountName={accountName} />
}

// Composant présentationnel testable.
export function MailPage({
  folder,
  mailboxes,
  accountName = '',
}: {
  folder: string
  mailboxes: AppMailbox[]
  accountName?: string
}) {
  const activeMailbox = mailboxes.find((m) => m.role === folder)
  return (
    <MailLayout
      sidebar={<AppSidebar mailboxes={mailboxes} activeFolder={folder} accountName={accountName} />}
      list={<ThreadList folder={folder} provisionalCount={activeMailbox?.totalEmails} />}
    />
  )
}
```

> **Vérifier** que `requireAuth()` expose `accountName` dans le contexte de route (il retourne `{ accountName }` — cf. `auth-guard.ts`). Si `useRouteContext` ne le fournit pas tel quel, récupérer `accountName` via `sessionStatusFn` dans le loader et le retourner. Ajuster en conséquence.

- [ ] **Step 4: Lancer le test + typecheck**

Run: `bunx vitest run src/routes/mail/$folder.test.tsx` → PASS
Run: `bun run typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add 'src/routes/mail/$folder.tsx' 'src/routes/mail/$folder.test.tsx'
git commit -m "feat(mail): wire /mail/\$folder to sidebar + virtualized list"
```

---

## Task 16: Vérification finale + revue manuelle

**Files:** aucun (vérification).

- [ ] **Step 1: Suite complète**

Run: `bun run test`
Expected: tous les tests passent (server + client).

- [ ] **Step 2: Typecheck + lint + format**

Run: `bun run typecheck` → PASS
Run: `bun run lint` → PASS
Run: `bun run check` → PASS (ou `bun run format` puis re-commit si nécessaire).

- [ ] **Step 3: Revue visuelle manuelle**

Run: `bun run dev` — se connecter, ouvrir `/mail/inbox`. Vérifier contre la maquette (`/tmp/wmx/webmail/project/screenshots/01.png`) :
- grille 3 colonnes, sidebar avec dossiers dans l'ordre `inbox, Favoris, En attente, Envoyés, Brouillons, Archivés, Indésirables, Corbeille` ;
- compteur non-lus sur Réception ;
- liste qui défile (scroll), lignes avec avatar, point non-lu, expéditeur, sujet, aperçu, date, trombone/étoile ;
- navigation entre dossiers (clic) recharge la liste ;
- thème sombre via cookie `stalmail_theme` (basculer et recharger).

Documenter tout écart visuel comme tâche de suivi (hors périmètre fonctionnel 4a).

- [ ] **Step 4: Commit final éventuel (format)**

```bash
git add -A
git commit -m "chore(mail): final formatting/lint pass for plan 4a"
```

---

## Self-Review — couverture spec

| Section spec | Tâche(s) |
|---|---|
| §2.1 deps directes + SSR query | T1 |
| §2.3 fenêtrage (total, plages, débounce, skeleton, count provisoire R2) | T10, T11 |
| §2.3/§6 calculateTotal, batch query+get+thread, messageCount | T5 |
| §2.4 token Bearer / redirect | T3, T4, T5 |
| §2.5 trajectoire (couche isolée use-windowed-threads) | T10 |
| §4 types | T2 |
| §5 jmapUserCall + JmapUserError | T3 |
| §6 mailboxesFn, emailListFn, resolveFilter R5 | T4, T5 |
| §7.1 layout 3 colonnes | T13 |
| §7.2 sidebar (ordre, actif, compteurs, compose disabled) | T12 |
| §7.3 ThreadList virtualizer | T11 |
| §7.4 ThreadRow (unread/star/attach/count/destinataire sent-drafts/skeleton/date) | T8, T9 |
| §8 CSS + data-theme html + Onest fontsource | T6 |
| §9 i18n mail fr/en | T14 |
| §10 tests | chaque tâche (TDD) |

**Points laissés volontairement « à vérifier en intégration » (notés inline) :** sémantique de `total` sous `collapseThreads` ; support de la propriété `preview` (fallback bodyValues) ; forme exacte d'appel client des server fns ; exposition de `accountName` dans le contexte de route ; calage des chaînes `toLocaleDateString` selon ICU. Ces points sont signalés dans les tâches concernées et ne bloquent pas l'architecture.
