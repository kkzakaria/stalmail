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
| Pagination | **Fenêtrage à index absolu** — `useQueries` (@tanstack/react-query) : une query par **plage** `[folder, pageIndex]`, montées/démontées selon la fenêtre visible | Mémoire bornée, **saut à une position arbitraire**, base extensible à `Email/queryChanges` (live, 4d) sans réécriture |
| Virtualisation | `useVirtualizer` (@tanstack/react-virtual, à installer) sur `count = total` | Fenêtre le DOM **et** pilote les plages à charger |
| Server functions | `createServerFn` TanStack Start | Pattern existant dans le repo |
| JMAP | Batch `Email/query` + `Email/get` + `Thread/get` en un appel (par plage) | Réduit les round-trips BFF → Stalwart |

> **Pourquoi pas `useInfiniteQuery` ?** Le modèle append-only accumule toutes les pages en mémoire sans borne, ne permet pas le saut à une position arbitraire dans une grosse boîte, et dérive sur une liste vivante (offset). 4a posant **la fondation** du `ThreadList`, on fige dès maintenant le **fenêtrage à index absolu** (cf. §2.3) — retrofitter depuis l'infinite scroll en 4b/4d serait une réécriture, pas un patch. TanStack Query est **conservé** (cache, dédup, états loading/error) ; on remplace seulement `useInfiniteQuery` par un jeu de `useQueries` indexées par plage.

> **`@tanstack/react-query`** est présent dans `node_modules` (v5.101.0) mais **uniquement comme dépendance transitive** de `@tanstack/react-router-ssr-query` — il n'est pas déclaré dans `package.json`. On l'ajoute en dépendance **directe** (un bump du lockfile pourrait sinon le faire disparaître).
>
> **Intégration SSR :** le repo a déjà `@tanstack/react-router-ssr-query` (aujourd'hui non branché). Plutôt qu'un `QueryClientProvider` nu dans `__root.tsx`, on passe le `QueryClient` via le **contexte du routeur + `setupRouterSsrQueryIntegration`** (`router.tsx`) — hydratation SSR-safe, évite le double-fetch et les mismatches d'hydratation.

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
| **Favoris** | Virtual — `Email/query` filtre `$flagged` **AND NOT (inMailbox trash OR spam)** | Pas de role JMAP standard — RFC 8621 §4.4. Exclusion corbeille/spam = décision produit alignée Gmail (cf. §6, R5) |
| **En attente** | Masqué en 4a — affiché vide + mention i18n | Aucun équivalent JMAP standard — Plan 4d |

Source : RFC 8621 §2.1 (Mailbox roles) + §4.4 (Email/query filter hasKeyword).
Stalwart crée automatiquement au 1er login les mailboxes standard avec leurs rôles.

### 2.3 Fenêtrage à index absolu

Le `ThreadList` virtualise **sur le total** (`count = total`), pas sur les lignes déjà chargées. Les données sont récupérées par **plages de taille fixe**, à la demande, selon la fenêtre visible — pas d'empilement append-only.

- **Taille de plage :** 50 threads (`PAGE = 50`). Une plage `p` couvre les index `[p*50, p*50+50)`.
- **`total`** vient de la 1ʳᵉ plage chargée (`Email/query` + `calculateTotal: true`). Avant son arrivée : `count` provisoire = **`mailbox.totalEmails`** (déjà chargé par `Mailbox/get` via la sidebar) — borne supérieure exacte (avec `collapseThreads`, threads ≤ emails), recalage minime à l'arrivée de la 1ʳᵉ plage au lieu d'un saut de scrollbar. Dossiers virtuels (`starred`) sans mailbox → estimation par défaut.
- **Plages à charger :** dérivées de la fenêtre du virtualizer (`virtualItems` → indices visibles + overscan) → ensemble de `pageIndex` requis → `useQueries` monte une query par plage manquante.
- **Lignes sans donnée chargée :** rendues en **skeleton** (la ligne existe — index connu — mais son `AppThread` n'est pas encore hydraté).
- **Éviction mémoire :** `gcTime` react-query évince les plages hors-fenêtre depuis longtemps → mémoire bornée même sur 100k mails. *(Option `maxPages` non pertinente ici : on n'est plus en infinite query.)*
- **Saut arbitraire :** `scrollToIndex(n)` repositionne le virtualizer → la plage couvrant `n` est montée et fetchée à la volée. Aucun scroll intermédiaire requis.
- **Tri :** `[{ property: "receivedAt", isAscending: false }]` (plus récents d'abord).
- **`collapseThreads: true`** sur `Email/query` — un résultat par thread.
- **`calculateTotal: true`** sur `Email/query` — **obligatoire** (RFC 8621 §5.5 : défaut `false`, sinon `total` absent/0 → virtualisation impossible).
- **Sémantique de `total` avec `collapseThreads: true` :** ambiguë selon les implémentations (emails vs threads). À **valider en intégration** contre Stalwart ; au besoin recaler `count` sur le nombre de threads réellement renvoyés.
- **Indépendant du cap serveur :** chaque plage est un `Email/query {position, limit}` borné — pas de dépendance à une éventuelle limite Stalwart sur la taille d'une id-list complète.

**Stabilité — dette assumée jusqu'à 4d.** Le fenêtrage reste du `position`/`limit` serveur : entre 4a et 4d (sans `Email/queryChanges`), un mail entrant décale toutes les positions → deux plages fetchées à `staleTime` d'intervalle peuvent montrer un **doublon ou un trou à la frontière de plage**. C'est borné (les plages s'auto-corrigent au refetch/éviction, pas d'accumulation d'état incohérent comme en append-only) et **acceptable en read-only**. La stabilité réelle n'arrive qu'en 4d. Mitigations peu coûteuses dès 4a :
- `refetchOnWindowFocus: true` sur les queries de plages ;
- invalidation de `['threads', folder]` au changement de dossier.

**Couture pour le live (4d) — cible : index d'ids maintenu par `queryChanges`.** La résolution `pageIndex → ids` passe par une couche isolée (`use-windowed-threads.ts`, §3). La cible 4d **n'est pas** « `queryChanges` + invalidation de plages offset » (version laborieuse) mais la **bascule de cette couche vers un index d'ids client** (snapshot ordonné du dossier) maintenu par les deltas `added`/`removed` de `Email/queryChanges` — cf. §2.5. La bascule se fait **derrière l'interface**, sans toucher `ThreadList` ni `ThreadRow`.
- **Politique de cohérence du `queryState` (à implémenter en 4d) :** chaque plage capture son `queryState` ; deux plages fetchées à des moments différents peuvent diverger. Règle : state de référence = le plus récent ; tout mismatch inter-plages → invalidation globale du dossier puis re-snapshot.

### 2.4 Token Bearer

Chaque server function récupère le `sid` via `readSid()` (cookie), obtient l'access token
via `withFreshAccessToken(sid)`. Si le token est `null` (session expirée), la fonction lance
`redirect({ to: '/login' })` — même comportement que `requireAuth()`.

### 2.5 Alternatives de pagination écartées & non-goals

4a pose **la fondation** du `ThreadList` ; changer de modèle ensuite serait une réécriture, pas un patch. La décision est donc figée ici et tracée pour ne pas être re-litiguée en 4b/4d.

| Approche | Complexité | Mémoire | Stable / live | Saut arbitraire | Offline | Décision |
|---|---|---|---|---|---|---|
| Infinite scroll (`useInfiniteQuery`) | ⭐ | ❌ non bornée | ❌ dérive offset | ❌ | ❌ | **Écartée** |
| **Fenêtrage à index absolu** (2a) | ⭐⭐ | ✅ bornée | 🟡 dérive mitigée, **stabilité réelle en 4d** | ✅ | ❌ | ✅ **Retenue (4a)** |
| Index d'ids client (snapshot) | ⭐⭐⭐ | ✅ bornée | ✅ natif (`queryChanges`) | ✅ | ❌ | **Différée — cible 4d** |
| Local-first / sync-engine | ⭐⭐⭐⭐⭐ | ✅ (IndexedDB) | ✅ natif | ✅ | ✅ | **Non-goal (différée)** |

**Pourquoi pas l'infinite scroll (append-only).** Mémoire non bornée (react-query garde toutes les pages), aucun saut à une position arbitraire dans une grosse boîte, et dérive de l'offset sur une liste vivante (mail entrant → duplication/saut aux frontières de page). Acceptable pour un POC, pas pour une fondation.

**Pourquoi pas le local-first (différé, pas abandonné).** « Meilleure UX » sur les axes scroll/offline/live, mais le pire sur tous les autres axes au stade actuel :
- **Coût disproportionné** vs une liste read-only : moteur de sync, schéma IndexedDB, sync initiale 100k+ messages, sync incrémentale, quotas/éviction, migrations — un sous-système à part entière.
- **Décision d'architecture produit, pas d'écran** : touche toute la couche données, l'offline et les migrations ; mérite sa propre spec + brainstorming.
- 🔴 **Sécurité/vie privée — rédhibitoire pour un mail auto-hébergé.** Le modèle actuel est un BFF : rien de sensible ne persiste côté client au-delà du cookie httpOnly. Stocker le contenu des emails en clair dans IndexedDB change le modèle de menace (un XSS exfiltre toute la boîte ; persistance après logout ; postes partagés). Exigerait chiffrement au repos + purge au logout. Régression pour un public qui choisit Stalwart par confidentialité.
- **YAGNI** : l'offline/latence-zéro sont des features premium non validées ; la 2a couvre déjà les grosses boîtes (mémoire bornée + saut arbitraire).

**Ce qu'on ne perd pas.** La 2a **est** la fondation d'un éventuel local-first : la couche `use-windowed-threads` + `Email/queryChanges` (4d) est exactement la source de sync qu'un store local consommerait. Basculer plus tard se greffe **derrière** cette couche, sans toucher au rendu.

**Trajectoire 4d figée — index d'ids client.** L'évolution naturelle de la 2a n'est pas le local-first mais l'**index d'ids côté client** (pattern des clients JMAP matures type Fastmail) : snapshot ordonné des ids du dossier (`Email/query` seul, par chunks si cap serveur ; ~20 o/id → 100k ≈ 2 Mo), `total` exact = `ids.length`, et résolution `index → id → Email/get` sur la seule fenêtre visible. Avantage décisif : `Email/queryChanges` (deltas `added`/`removed` avec positions) est **conçu pour maintenir exactement ce snapshot** → dérive nulle par construction, contre une invalidation de plages offset laborieuse. C'est la **cible 4d** ; la bascule se fait derrière `use-windowed-threads`, sans toucher au rendu. *(Note : `anchor`/`anchorOffset` n'est pas une 3ᵉ voie — il supprime la dérive autour d'un point connu mais est incompatible avec le saut arbitraire à la scrollbar, qui exige `count = total`.)*

**Conditions de réouverture du sujet local-first :** offline et latence-zéro deviennent des requis produit explicites **ET** le cœur du webmail est validé **ET** le modèle de sécurité (chiffrement au repos, purge, postes partagés) est tranché dans une spec dédiée. Pas avant.

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
  src/components/mail/use-windowed-threads.ts — hook fenêtrage : total + useQueries par plage + threadAt(index) (couture queryChanges 4d)
  src/components/mail/use-windowed-threads.test.ts
  src/components/mail/thread-list.tsx — ThreadList (virtualizer sur total + skeletons)
  src/components/mail/thread-row.tsx  — ThreadRow read-only (pixel-perfect maquette) + état skeleton
  src/components/mail/mail-icons.tsx  — icônes mail (Lucide + SVG custom)
  src/components/mail/index.ts      — re-exports
  src/routes/mail/$folder.test.tsx  — tests d'intégration route

Modifier :
  src/routes/mail/$folder.tsx       — remplace placeholder, branche loaderFn + composants
  src/router.tsx                    — QueryClient dans le contexte routeur + setupRouterSsrQueryIntegration
  src/routes/__root.tsx             — applique data-theme sur <html> (cf. §8) + chargement police Onest
  src/i18n/resources.ts             — namespace `mail` (fr + en)
  package.json                      — ajouter @tanstack/react-virtual, @tanstack/react-query (dep directe), @fontsource-variable/onest
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
  id: string              // id de l'email représentatif du thread (résultat collapsé Email/query)
  threadId: string
  subject: string
  preview: string         // extrait texte brut (cf. §6 — fallback bodyValues si Stalwart n'expose pas `preview`)
  from: { name: string; email: string }[]
  to: { name: string; email: string }[]   // requis pour Envoyés/Brouillons (maquette : on affiche le destinataire)
  messageCount: number    // taille du thread (Thread/get → emailIds.length) — compteur de la maquette si > 1
  receivedAt: string      // ISO 8601
  unread: boolean         // !keywords['$seen']
  starred: boolean        // keywords['$flagged'] === true
  hasAttachment: boolean
  mailboxIds: string[]
}

export interface EmailListPage {
  threads: AppThread[]
  total: number           // total d'emails correspondant à la query (calculateTotal: true)
  position: number        // index du premier résultat de cette plage
  queryState?: string     // Email/query queryState — non utilisé en 4a, réservé pour Email/queryChanges (4d)
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
  - 'starred' → { operator: 'AND', conditions: [
        { hasKeyword: '$flagged' },
        { operator: 'NOT', conditions: [ { inMailbox: <trash-id> }, { inMailbox: <spam-id> } ] }
    ] }
    // R5 — décision produit (alignée Gmail) : un favori en corbeille/spam ne remonte pas.
    // Coût marginal : trash-id / spam-id déjà connus via mailboxesFn.
  - autre → { inMailbox: <id mailbox dont le role correspond> }

Batch JMAP (3 méthodes en un seul appel) :
  ["Email/query", {
    accountId, collapseThreads: true, calculateTotal: true, filter,
    sort: [{ property: "receivedAt", isAscending: false }],
    position, limit
  }, "0"]
  ["Email/get", {
    accountId,
    "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
    properties: ["id","threadId","mailboxIds","keywords",
                 "from","to","subject","preview","receivedAt","hasAttachment"]
  }, "1"]
  ["Thread/get", {
    accountId,
    "#ids": { resultOf: "1", name: "Email/get", path: "/list/*/threadId" }
  }, "2"]   // back-ref sur Email/get (porte threadId) ; → emailIds.length alimente AppThread.messageCount

Retour : EmailListPage { threads, total, position, queryState? }
```

> `emailListFn` est un **fetch de plage** (`position`/`limit`), pas un curseur append-only : appelé une fois par plage visible via `useQueries` (§7.3). On capture `queryState` (champ de retour d'`Email/query`) dès maintenant — inutilisé en 4a, il évite un changement de contrat quand `Email/queryChanges` arrivera (4d).

- **`calculateTotal: true`** est obligatoire (cf. §2.3) — sans lui la pagination est cassée.
- **`to`** est nécessaire pour Envoyés/Brouillons : la maquette (`mail-views.jsx` `Row`) affiche le **destinataire** et non l'expéditeur dans ces dossiers.
- **`Thread/get`** fournit `emailIds` → `messageCount = emailIds.length` (le compteur « +N » de la maquette pour les threads > 1). `Email/query collapseThreads` seul ne renvoie qu'un email représentatif et ne connaît pas la taille du thread.

**Sur la propriété `preview` :** elle n'est **pas** standard RFC 8621 (c'est une extension serveur). **Vérifier en intégration que Stalwart la renvoie.** Si non, fallback : retirer `preview` des `properties`, ajouter `fetchTextBodyValues: true` + `bodyProperties`/`maxBodyValueBytes` à `Email/get`, et dériver l'extrait depuis `bodyValues`.

**Note `accountId` :** résolu une fois au login via `fetchJmapAccount` (Plan 3a) et **toujours** stocké dans la session — `currentSession(readSid())` le renvoie systématiquement. Pas de branche « si absent » à prévoir.

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
- **Liste dossiers** : ordre **figé sur la maquette** (`mail-data.jsx` `FOLDERS`), pas le `sortOrder` JMAP brut — les dossiers virtuels sont **intercalés après `inbox`** : `inbox`, **`starred`**, **`snoozed`**, `sent`, `drafts`, `archive`, `spam`, `trash`. Construire la liste via un ordre de rôles prédéfini, en piochant l'`AppMailbox` correspondant par `role`. Dossier actif = `folder` param URL. Compteur non-lus sur `inbox` et `drafts` uniquement.
- **Section étiquettes** : structure HTML prête, données statiques en 4a (Plan 4d pour les keywords JMAP dynamiques)
- **Section Espaces** : entrée Calendrier désactivée (Plan 4e)

### 7.3 ThreadList (`thread-list.tsx`)

Logique encapsulée dans le hook `use-windowed-threads.ts` (§3), consommée par `ThreadList`.

```
// 1. Virtualizer sur le TOTAL (pas sur les lignes chargées)
const virt = useVirtualizer({
  count: total ?? mailbox?.totalEmails ?? PROVISIONAL_COUNT,  // borne sup. exacte avant 1ʳᵉ plage (R2)
  estimateSize: () => rowHeightByDensity[density],            // compact 56 | regular 64 | comfy 72
  overscan: 8,
  getScrollElement: () => scrollRef.current,
})

// 2. Dériver les plages requises — DEBOUNCÉ pour ne pas fetcher pendant un fling-scroll (R3)
const visible = virt.getVirtualItems()
const neededPages = useDebouncedPageIndexes(visible, PAGE, 120)  // plages stables après ~120ms d'arrêt

// 3. Une query par plage manquante — montées/démontées avec la fenêtre
const pages = useQueries({
  queries: neededPages.map((p) => ({
    queryKey: ['threads', folder, p],
    queryFn: () => emailListFn({ folder, position: p * PAGE, limit: PAGE }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,        // évince les plages quittées depuis 5 min → mémoire bornée
    refetchOnWindowFocus: true, // re-synchronise après absence — mitige la dérive d'offset (R1)
  })),
})

// 4. total = premier résultat arrivé ; threadAt(index) → AppThread | undefined (undefined = skeleton)
// Au changement de `folder` : invalider ['threads', folder] (R1).
```

- **Pas de sentinel, pas de `fetchNextPage`** : le chargement est piloté par la fenêtre du virtualizer, pas par une ligne déclencheuse en bas.
- **`count` provisoire = `mailbox.totalEmails`** (R2) : déjà chargé par la sidebar avant la liste, c'est une borne supérieure exacte (threads ≤ emails) → recalage minime, pas de saut de scrollbar. Dossiers virtuels (`starred`) → `PROVISIONAL_COUNT` par défaut.
- **Débounce des plages** (R3) : pendant un scroll rapide sur une grosse boîte, le virtualizer traverse des dizaines de plages ; ne déclencher `Email/query` que sur les plages **stables après arrêt du scroll** — les skeletons couvrent l'intervalle. Évite la tempête de requêtes vers Stalwart.
- `threadAt(index)` mappe un index absolu vers son `AppThread` via la plage `Math.floor(index / PAGE)` ; `undefined` → `ThreadRow` en skeleton.

**Hauteur de ligne :** `estimateSize` fixe par densité suppose des lignes à hauteur constante (sujet + preview **tronqués sur 1 ligne**, cf. §7.4). Garantir cette troncature en CSS ; sinon (wrap possible) brancher `measureElement` sur chaque `ThreadRow` pour une hauteur dynamique mesurée. Valeurs `rowHeightByDensity` à recaler sur le rendu réel de la maquette une fois le CSS intégré.

### 7.4 ThreadRow (`thread-row.tsx`)

Read-only, fidèle à la maquette :
- Avatar coloré (initiales, couleur stable par email hash)
- Point non-lu (`.unread-dot` visible si `thread.unread`)
- **Nom affiché** : expéditeur (`from[0]`) dans la plupart des dossiers ; **destinataire (`to[0]`)** dans `sent` et `drafts` (comportement maquette `Row`)
- **Compteur messages** « +N » si `thread.messageCount > 1` (alimenté par `Thread/get`, cf. §6)
- Sujet + preview sur **1 ligne tronquée** (troncature CSS garantie — cf. §7.3 hauteur de ligne)
- Heure/date (formatée en FR : "Aujourd'hui", "Hier", jour de la semaine, date)
- Icône trombone si `hasAttachment`
- Ligne surlignée si sélectionnée (navigation au clic → `?thread=id` sur la route)
- **État skeleton** : si l'`AppThread` de l'index n'est pas encore chargé (`threadAt(index) === undefined`, cf. §7.3), rendre un placeholder à la **même hauteur** que la ligne pleine (avatar/lignes grisés) — pas de saut de layout pendant le fetch de la plage
- **Pas de boutons d'action** (Plan 4b)

---

## 8. CSS et thème

`mail.css` est converti en variables CSS intégrées au thème Tailwind v4 existant :
- Variables `--bg`, `--surface`, `--ink`, `--muted`, `--accent` reprises telles quelles
- **`data-theme` sur `<html>` : à câbler — ce n'est PAS encore en place.** Aujourd'hui `data-theme` n'est appliqué que sur des conteneurs scopés (`.stalmail-wizard`, `.login-shell`), via le cookie `stalmail_theme` (`setup-theme.ts`). Il faut l'appliquer sur `<html>` dans `__root.tsx`. **Décision de cohérence :** réutiliser le **cookie `stalmail_theme` (SSR, évite le flash de thème)** comme pour le reste du repo, plutôt que d'introduire un mécanisme localStorage divergent.
- Densité via `--row-pad-y` (compact: 8px, **regular: 9px** — défaut maquette, comfy: 13px) — préférence locale (localStorage acceptable ici, purement client).
- Police via `--ui-font` : **Onest auto-hébergée via `@fontsource-variable/onest`** (convention du repo, cf. `@fontsource-variable/geist|inter`) — **pas** un `<link>` Google Fonts CDN (dépendance réseau externe / vie privée, à proscrire pour un serveur mail auto-hébergé). Inter Tight / Newsreader de la maquette ne sont pas requis au périmètre 4a (liste).

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
| `mail-actions.test.ts` | `emailListFn` : mapping folder→filter, `starred`→ `$flagged` **AND NOT (trash, spam)** (R5), `calculateTotal: true` présent dans la requête, pagination position/limit, batch JMAP (Email/query + Email/get + Thread/get) mocké, `messageCount` dérivé de Thread/get, total/position dans le retour |
| `mail-actions.test.ts` | `mailboxesFn` : tri par sortOrder, mapping vers AppMailbox[] |
| `thread-row.test.tsx` | unread dot visible/caché ; starred icon ; hasAttachment ; preview tronqué ; **compteur « +N » si messageCount > 1** ; **nom = destinataire en `sent`/`drafts`, expéditeur sinon** ; **skeleton si AppThread absent** ; format date FR |
| `use-windowed-threads.test.ts` | `uniquePageIndexes` : fenêtre visible → bon ensemble de plages ; **débounce** : pas de fetch pendant le scroll, plages stables après arrêt (R3) ; `threadAt(index)` mappe vers la bonne plage et renvoie `undefined` (skeleton) si non chargé ; `total` pris sur la 1ʳᵉ plage arrivée ; **`count` provisoire = `mailbox.totalEmails`, fallback estimation pour dossiers virtuels** (R2) |
| `thread-list.test.tsx` | virtualise sur `count = total` ; lignes non chargées en skeleton ; ne monte que les queries des plages visibles |
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
