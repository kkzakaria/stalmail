# Stalmail Plan 4a — Mail List — Design Document

**Date :** 2026-06-12
**Statut :** validé en brainstorming, prêt pour le plan d'implémentation.
**Périmètre :** layout webmail, sidebar dossiers JMAP, liste de threads virtualisée (read-only).
**Dépendances :** Plan 3a livré (auth BFF, session, `requireAuth`, `withFreshAccessToken`, `stalwartUserFetch`).

---

## 1. Vision

Remplacer le placeholder `/mail/$folder` par le premier écran fonctionnel du webmail :
une sidebar de navigation et une liste de threads défilante, en **lecture seule**. L'utilisateur
peut voir ses emails, naviguer entre dossiers et faire défiler une liste potentiellement longue
sans aucun blocage réseau. Les actions (étoile, archive, suppression) et le Reader sont laissés
au Plan 4b.

**Maquette de référence :** `webmail.zip` à la racine — fichiers `mail-app.jsx`, `mail-views.jsx`,
`mail-data.jsx`, `mail.css`. L'implémentation doit reproduire fidèlement le rendu visuel
(layout, Row, Sidebar, thème clair/sombre, densité, accents).

---

## 2. Décisions architecturales

### 2.1 Stack de données

| Couche | Choix | Raison |
|--------|-------|--------|
| Pagination | `useInfiniteQuery` (@tanstack/react-query, déjà installé) | Cache par `[folder]`, stale-while-revalidate, gestion des états loading/error gratuite |
| Virtualisation | `useVirtualizer` (@tanstack/react-virtual, à installer) | Cohérence écosystème TanStack, dynamic row height |
| Server functions | `createServerFn` TanStack Start | Pattern existant dans le repo |
| JMAP | Batch request `Email/query` + `Email/get` en un appel | Réduit les round-trips BFF → Stalwart |

### 2.2 Dossiers : mapping JMAP → sidebar

Les dossiers de la maquette sont mappés comme suit :

| Dossier maquette | Mapping JMAP | Note |
|---|---|---|
| Boîte de réception | `Mailbox` role `"inbox"` | Standard RFC 8621 |
| Envoyés | `Mailbox` role `"sent"` | Standard RFC 8621 |
| Brouillons | `Mailbox` role `"drafts"` | Standard RFC 8621 |
| Corbeille | `Mailbox` role `"trash"` | Standard RFC 8621 |
| Indésirables | `Mailbox` role `"spam"` | Standard RFC 8621 |
| Archivés | `Mailbox` role `"archive"` | Standard RFC 8621 |
| **Favoris** | Virtual — `Email/query { filter: { hasKeyword: "$flagged" } }` | Pas de role JMAP standard — RFC 8621 §4.4 |
| **En attente** | Masqué en 4a — affiché vide + mention i18n | Aucun équivalent JMAP standard — Plan 4d |

Source : RFC 8621 §2.1 (Mailbox roles) + §4.4 (Email/query filter hasKeyword).
Stalwart crée automatiquement au 1er login les mailboxes standard avec leurs rôles.

### 2.3 Chargement paginé

- **Taille de page :** 50 threads
- **Curseur :** `position` (entier, index JMAP) — `getNextPageParam = (last) => last.position + 50 < last.total ? last.position + 50 : undefined`
- **Tri :** `[{ property: "receivedAt", isAscending: false }]` (plus récents d'abord)
- **`collapseThreads: true`** sur `Email/query` — un résultat par thread

### 2.4 Token Bearer

Chaque server function récupère le `sid` via `readSid()` (cookie), obtient l'access token
via `withFreshAccessToken(sid)`. Si le token est `null` (session expirée), la fonction lance
`redirect({ to: '/login' })` — même comportement que `requireAuth()`.

---

## 3. Structure des fichiers

```
Créer :
  src/server/jmap-user.ts           — jmapUserCall() : JMAP batch Bearer utilisateur
  src/server/jmap-user.test.ts
  src/server/mail-types.ts          — AppMailbox, AppThread, EmailListPage (types partagés)
  src/server/mail-actions.ts        — mailboxesFn, emailListFn (server functions)
  src/server/mail-actions.test.ts
  src/components/mail/layout.tsx    — grille 3 colonnes (sidebar | liste | placeholder reader)
  src/components/mail/sidebar.tsx   — AppSidebar (dossiers JMAP + compteurs)
  src/components/mail/thread-list.tsx — ThreadList (infinite query + virtualizer)
  src/components/mail/thread-row.tsx  — ThreadRow read-only (pixel-perfect maquette)
  src/components/mail/mail-icons.tsx  — icônes mail (Lucide + SVG custom)
  src/components/mail/index.ts      — re-exports
  src/routes/mail/$folder.test.tsx  — tests d'intégration route

Modifier :
  src/routes/mail/$folder.tsx       — remplace placeholder, branche loaderFn + composants
  src/routes/__root.tsx             — QueryClientProvider (si absent)
  src/i18n/resources.ts             — namespace `mail` (fr + en)
  package.json                      — ajouter @tanstack/react-virtual
```

---

## 4. Types partagés (`mail-types.ts`)

```ts
export interface AppMailbox {
  id: string
  name: string
  role: string | null   // 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | null
  unreadEmails: number
  totalEmails: number
  sortOrder: number
}

// Virtual folders that have no real JMAP mailbox
export type VirtualFolder = 'starred' | 'snoozed'

export interface AppThread {
  id: string              // id du dernier email du thread (représente le thread dans la liste)
  threadId: string
  subject: string
  preview: string         // extrait texte brut
  from: { name: string; email: string }[]
  receivedAt: string      // ISO 8601
  unread: boolean         // !keywords['$seen']
  starred: boolean        // keywords['$flagged'] === true
  hasAttachment: boolean
  mailboxIds: string[]
}

export interface EmailListPage {
  threads: AppThread[]
  total: number           // total d'emails correspondant à la query
  position: number        // index du premier résultat de cette page
}
```

---

## 5. Couche JMAP utilisateur (`jmap-user.ts`)

Miroir de `src/server/jmap.ts` (admin) mais avec Bearer utilisateur.

```
jmapUserCall(sid, accountId, methodCalls) → JmapMethodResponse[]

Flux :
  1. withFreshAccessToken(sid) → accessToken | null
  2. Si null → throw redirect({ to: '/login' })
  3. stalwartUserFetch('/jmap/', accessToken, { method: 'POST', body: JSON.stringify({
       using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
       methodCalls
     }) })
  4. Parse + retourne methodResponses[]
```

Erreurs :
- HTTP non-2xx → `JmapUserError` (sous-classe de Error)
- Réponse JMAP avec `["error", ...]` → `JmapUserError` avec `type` et `detail`
- Token null → `redirect` (logout propre)

---

## 6. Server functions (`mail-actions.ts`)

### `mailboxesFn()`

```
POST /jmap/
  ["Mailbox/get", { accountId, ids: null,
    properties: ["id","name","role","unreadEmails","totalEmails","sortOrder"] }, "0"]

Retour : AppMailbox[] trié par sortOrder
Côté client : utilisé dans le loaderFn de la route + sidebar
```

### `emailListFn({ folder, position, limit })`

```
folder : string — nom du dossier URL ('inbox', 'sent', ...) ou 'starred'
position : number — index de départ (pagination JMAP)
limit : number — taille de page (défaut 50)

Résolution du filtre :
  - 'starred' → { hasKeyword: '$flagged' }
  - autre → { inMailbox: <id mailbox dont le role correspond> }

Batch JMAP (2 méthodes en un seul appel) :
  ["Email/query", {
    accountId, collapseThreads: true, filter,
    sort: [{ property: "receivedAt", isAscending: false }],
    position, limit
  }, "0"]
  ["Email/get", {
    accountId,
    "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
    properties: ["id","threadId","mailboxIds","keywords",
                 "from","subject","preview","receivedAt","hasAttachment"]
  }, "1"]

Retour : EmailListPage { threads, total, position }
```

**Note :** le `accountId` est résolu une fois au login via `fetchJmapAccount` (Plan 3a) et
stocké dans la session. `mailboxesFn` peut aussi le résoudre si absent.

---

## 7. Composants UI

### 7.1 Layout (`layout.tsx`)

CSS Grid 3 colonnes : `nav(240px) | list(var(--list-w, 392px)) | 1fr`.
Sur tablette : sidebar en tiroir overlay (`nav-open` class, comme la maquette).
Sur mobile : panneau actif prend 100%.
Variables CSS reprises de `mail.css` : `--list-w`, `--row-pad-y`, `--accent`, `--bg`, `--surface`, etc.

### 7.2 AppSidebar (`sidebar.tsx`)

- **Header compte** : avatar + nom + email (depuis `currentSession`) + menu utilisateur (logout → `logoutFn`, Plan 3a)
- **Bouton "Nouveau message"** : désactivé (Plan 4c) — rendu mais `disabled`
- **Liste dossiers** : itère sur `AppMailbox[]` + dossiers virtuels. Dossier actif = `folder` param URL. Compteur non-lus sur `inbox` et `drafts` uniquement.
- **Section étiquettes** : structure HTML prête, données statiques en 4a (Plan 4d pour les keywords JMAP dynamiques)
- **Section Espaces** : entrée Calendrier désactivée (Plan 4e)

### 7.3 ThreadList (`thread-list.tsx`)

```
useInfiniteQuery({
  queryKey: ['threads', folder],
  queryFn: ({ pageParam = 0 }) => emailListFn({ folder, position: pageParam, limit: 50 }),
  getNextPageParam: (last) =>
    last.position + 50 < last.total ? last.position + 50 : undefined,
  staleTime: 30_000,   // 30s avant de considérer stale
})

useVirtualizer({
  count: allThreads.length + (hasNextPage ? 1 : 0),  // +1 pour le sentinel
  estimateSize: () => rowHeightByDensity[density],   // compact 56 | regular 64 | comfy 72
  overscan: 5,
})
```

Sentinel (dernière ligne virtuelle) : déclenche `fetchNextPage()` quand il entre dans le viewport.

### 7.4 ThreadRow (`thread-row.tsx`)

Read-only, fidèle à la maquette :
- Avatar coloré (initiales, couleur stable par email hash)
- Point non-lu (`.unread-dot` visible si `thread.unread`)
- Nom expéditeur + compteur messages si thread > 1
- Sujet + preview sur 1 ligne tronquée
- Heure/date (formatée en FR : "Aujourd'hui", "Hier", jour de la semaine, date)
- Icône trombone si `hasAttachment`
- Ligne surlignée si sélectionnée (navigation au clic → `?thread=id` sur la route)
- **Pas de boutons d'action** (Plan 4b)

---

## 8. CSS et thème

`mail.css` est converti en variables CSS intégrées au thème Tailwind v4 existant :
- Variables `--bg`, `--surface`, `--ink`, `--muted`, `--accent` reprises telles quelles
- `data-theme="dark"` sur `<html>` contrôle le thème sombre (existant)
- Densité via `--row-pad-y` (compact: 8px, regular: 10px, comfy: 13px) — préférence stockée en localStorage
- Police via `--ui-font` : Onest (chargée via Google Fonts dans `__root.tsx`)

---

## 9. i18n

Namespace `mail` ajouté dans `src/i18n/resources.ts` (fr + en, parité stricte) :

```ts
mail: {
  // Dossiers
  inbox: 'Boîte de réception',
  sent: 'Envoyés',
  drafts: 'Brouillons',
  trash: 'Corbeille',
  spam: 'Indésirables',
  archive: 'Archivés',
  starred: 'Favoris',
  snoozed: 'En attente',
  // États
  loading: 'Chargement…',
  loadingMore: 'Chargement de la suite…',
  empty: 'Aucun message',
  snoozedUnavailable: 'Disponible prochainement',
  error: 'Impossible de charger les messages.',
  // Dates
  today: 'Aujourd\'hui',
  yesterday: 'Hier',
  // Labels section
  labels: 'Étiquettes',
  // Compose
  compose: 'Nouveau message',
}
```

---

## 10. Tests

| Fichier | Couverture |
|---|---|
| `jmap-user.test.ts` | `jmapUserCall` : appel Bearer correct ; token null → redirect ; erreur HTTP → JmapUserError ; erreur JMAP method → JmapUserError |
| `mail-actions.test.ts` | `emailListFn` : mapping folder→filter, `starred`→hasKeyword, pagination position/limit, batch JMAP mocké, total/position dans le retour |
| `mail-actions.test.ts` | `mailboxesFn` : tri par sortOrder, mapping vers AppMailbox[] |
| `thread-row.test.tsx` | unread dot visible/caché ; starred icon ; hasAttachment ; preview tronqué ; format date FR |
| `thread-list.test.tsx` | `getNextPageParam` : retourne undefined quand `position + 50 >= total` |
| `$folder.test.tsx` | route monte sans crash, sidebar reçoit les mailboxes du loader, ThreadList reçoit le bon folder |
| Suite i18n + typecheck | parité fr/en namespace `mail`, `npx tsc --noEmit` vert |

---

## 11. Hors scope Plan 4a

- **Actions** (star, archive, trash, mark read) → Plan 4b
- **Reader** (lecture d'un thread) → Plan 4b
- **Composer / Reply** → Plan 4c
- **Étiquettes JMAP dynamiques** (keywords custom) → Plan 4d
- **SSE / live mail** → Plan 4d
- **Dossier "En attente" (Snoozé)** → Plan 4d
- **Recherche full-text** → Plan 4d
- **SettingsView** → Plan 4e
- **CalendarView** → Plan 4e

---

## 12. Références

- RFC 8621 (JMAP Mail) — §2 Mailbox, §3 Thread, §4 Email : https://www.rfc-editor.org/rfc/rfc8621
- Stalwart JMAP overview : https://stalw.art/docs/http/jmap/
- Stalwart Push/EventSource : https://stalw.art/docs/http/jmap/push
- Plan 3a spec : `docs/superpowers/specs/2026-06-11-plan-3a-auth-session-design.md`
- Maquette de référence : `webmail.zip` (racine du projet) — `mail-views.jsx`, `mail-app.jsx`, `mail.css`
- @tanstack/react-virtual : https://tanstack.com/virtual/latest
- @tanstack/react-query : https://tanstack.com/query/latest
