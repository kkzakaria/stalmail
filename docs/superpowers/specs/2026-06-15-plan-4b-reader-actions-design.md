# Stalmail Plan 4b — Reader & Actions — Design Document

**Date :** 2026-06-15
**Statut :** validé en brainstorming, prêt pour le plan d'implémentation.
**Périmètre :** lecteur de fil (3ᵉ colonne) en lecture seule + 5 actions de mail (favori, lu/non-lu, archiver, corbeille, spam/retirer-du-spam).
**Dépendances :** Plan 4a livré (layout 3 colonnes, sidebar, liste virtualisée, `jmapUserCall`, `emailListFn`, `useWindowedThreads`, types `mail-types.ts`).

## 1. Vision

La 4a affiche une liste de fils en lecture seule. La 4b la rend **vivante** : on ouvre un fil dans la 3ᵉ colonne (le lecteur), on lit la conversation complète, et on agit dessus (favori, lu/non-lu, archiver, corbeille, spam). C'est la première itération où l'utilisateur **modifie** l'état de sa boîte. La rédaction (répondre/transférer/composer) reste pour la 4c ; les étiquettes dynamiques, le snooze et le live mail pour la 4d.

## 2. Décisions architecturales

### 2.1 Périmètre des actions

5 actions, validées en brainstorming :

| Action | Mécanisme JMAP | Nature |
|---|---|---|
| Favori (★) | `Email/set` → `keywords/$flagged` | en place |
| Lu / non-lu | `Email/set` → `keywords/$seen` | en place |
| Archiver | `Email/set` → `mailboxIds` (→ role `archive`) | appartenance |
| Corbeille | `Email/set` → `mailboxIds` (→ role `trash`) | appartenance |
| Spam / Retirer du spam | `Email/set` → `mailboxIds` (→ role `junk` / `inbox`) | appartenance |

**Auto-marquage lu** : ouvrir un fil non-lu marque automatiquement tous ses emails non-lus comme lus (`$seen`), de façon optimiste, comme la plupart des webmails.

**Hors périmètre 4b (rendu mais `disabled`, ou non rendu) :** répondre / répondre à tous / transférer (4c), étiquettes (4d), snooze (4d), épingler / imprimer / bloquer l'expéditeur (4d), résumé IA (stub visuel uniquement — le composant `AISummary` de la maquette n'est pas porté en 4b, son emplacement reste vide).

### 2.2 Surface d'action : reader-bar uniquement

Les actions vivent **exclusivement dans la barre du lecteur** (`.reader-bar`). Les lignes de la liste (`ThreadRow`) restent en lecture seule : pas d'actions au survol ni au swipe (reportées). Cela garde la 4b focalisée et évite de dupliquer la logique de mutation sur deux surfaces.

### 2.3 Actions au niveau du **fil**, pas de l'email isolé

Cohérent avec une UI thread-centrée (modèle Gmail) : archiver / marquer lu / favori agissent sur **tous les emails du fil**, pas seulement l'email représentatif. Le lecteur charge déjà la liste des `emailIds` du fil (via `Thread/get`), il les transmet donc aux server functions.

Conséquence : les actions ne sont déclenchables que **depuis le lecteur** (qui a les `emailIds` chargés). C'est cohérent avec 2.2 (reader-bar uniquement).

### 2.4 Server functions typées (pas d'`Email/set` générique)

On n'expose **pas** un `Email/set` générique côté BFF (écriture arbitraire de mailbox = risque). Deux server functions typées et validées par Zod :

```
setFlagsFn({ emailIds: string[], flag: '$seen' | '$flagged', value: boolean })
  → Email/set { update: { [id]: { ['keywords/' + flag]: value || null } } }

moveThreadFn({ emailIds: string[], to: 'archive' | 'trash' | 'junk' | 'inbox' })
  → 1. Mailbox/get (id, role) pour résoudre to → mailboxId (réutilise mailboxRefs/mailboxIdByRole de 4a)
  → 2. Email/set { update: { [id]: { mailboxIds: { [targetId]: true } } } }
```

`to` étant un enum fermé résolu **côté serveur** en mailboxId, le client ne peut pas écrire dans une mailbox arbitraire. `flag` est aussi un enum fermé (`$seen` | `$flagged`).

> **Plafond de lot (anti-DoS, A04)** : `emailIds` est borné **en cardinalité** autant qu'en longueur — `z.array(z.string().min(1).max(64)).min(1).max(500)` — pour éviter un `Email/set` géant (cf. `limit ≤ 200` de `emailListFn` en 4a).

> **Note `keywords/$flag`** : JMAP (RFC 8621 §4.6) accepte le patch par référence `keywords/$seen: true|null`. Mettre `null` retire le keyword. On utilise `value ? true : null`.

> **Note `mailboxIds`** : on **remplace** l'ensemble des mailboxIds par `{ [targetId]: true }` (déplacement, pas copie). Suffisant pour la 4b où un email n'est dans qu'un dossier role à la fois.

### 2.5 Chargement du lecteur

```
readThreadFn({ threadId: string }) → AppThreadDetail
  Batch JMAP :
    [0] Thread/get { ids: [threadId] }                       → emailIds ordonnés
    [1] Email/get  { '#ids': resultOf [0] /list/0/emailIds,  → corps + headers
          properties: ['id','mailboxIds','keywords','from','to','cc',
                       'subject','receivedAt','hasAttachment',
                       'textBody','htmlBody','bodyValues','attachments'],
          fetchTextBodyValues: true, fetchHTMLBodyValues: true,
          maxBodyValueBytes: 256000 }
```

Un seul aller-retour réseau (Thread/get + Email/get chaînés par référence). `maxBodyValueBytes` borne le poids des corps. Le dernier message est ouvert par défaut, les précédents repliés (fidèle à la maquette `MessageItem`).

> **Invariant (read-only)** : `readThreadFn` est un **GET strictement en lecture** — aucun `Email/set` dans ce handler. L'auto-marquage lu (§2.1) n'y est PAS fait : il passe par `setFlagsFn` (POST) déclenché côté client après ouverture. Un GET ne doit jamais muter `$seen`.

### 2.6 Réconciliation du cache (hybride)

Le fenêtrage 4a utilise des pages offset keyées `['threads', folder, page]`. Stratégie :

- **Actions en place (star, read/unread)** → patch optimiste :
  - Liste : parcourir les pages en cache, trouver l'`AppThread` dont `threadId` correspond, patcher `starred` / `unread`. Rollback (restaurer le snapshot) si la mutation échoue.
  - Détail lecteur : patcher l'`AppThreadDetail` en cache (`keywords` des messages).
- **Actions d'appartenance (archive/trash/junk/inbox)** → invalidation :
  - `queryClient.invalidateQueries({ queryKey: ['threads', folder] })` → refetch des pages. On **n'essaie pas** de retirer l'item des pages offset à la main (raviverait la dérive d'offset R1, traitée en 4d).
  - Le lecteur se ferme : `navigate({ search: { thread: undefined } })`.
- **Compteurs sidebar** : `mailboxesFn` est dans le loader de route ; après archive/trash/spam ou changement de lu, on invalide aussi la donnée mailboxes (via `router.invalidate()` ou refetch du loader) pour rafraîchir les compteurs non-lus.
- **Toast** sur chaque action (succès et erreur), via le système de toast existant.

### 2.7 Rendu du corps de l'email (sécurité)

Le HTML d'un email est du **contenu non fiable** (XSS, traqueurs, CSS qui fuit). Stratégie « texte d'abord, sinon iframe sandbox **opaque** + CSP » — l'anti-XSS repose sur **deux barrières indépendantes** (sandbox *et* CSP), jamais sur la seule neutralisation d'images.

1. S'il existe un `textBody` non vide → l'afficher en clair (`<p>` par paragraphe / `white-space: pre-wrap`). **Cas par défaut, le plus sûr.**
2. Sinon, rendre le `htmlBody` dans une **`<iframe srcdoc=…>` avec `sandbox=""` (aucun flag)** : origine **opaque**, ni script, ni same-origin, ni formulaire, ni navigation top, ni popup. Contenu totalement isolé du DOM et des cookies de l'app.
   **On n'utilise JAMAIS `allow-same-origin`** : même sans `allow-scripts`, il rétablit l'origine réelle (exfiltration CSS, `<meta refresh>`, `<form>`) et constitue le combo classique de contournement du sandbox.
3. **CSP du `srcdoc`** (défense en profondeur, indépendante du sandbox) : préfixer le document d'une balise
   `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'">`.
   Bloque par construction CSS/fonts distants, `@import`, `url()` réseau, formulaires et `meta refresh` vers le réseau.
4. **Images distantes bloquées par défaut** — contrôle **anti-traceur (vie privée)**, *pas* anti-XSS (l'anti-XSS = sandbox + CSP). Avant injection, neutraliser les `src`/`background` distants ; bandeau « Afficher les images » → réinjecte le HTML original. `data:`/`cid:` autorisés **uniquement** en `img-src` (cf. CSP), jamais sur des éléments actifs.
5. **Liens** : pré-traiter tous les `<a>` → ajout de `rel="noopener noreferrer"`, n'autoriser que les schémas `https:` / `mailto:` (neutraliser `javascript:`, `data:`, `vbscript:` sur `href`). Pas de `allow-popups`/`allow-top-navigation` sur l'iframe.

Module pur `email-body.ts` (testable sans DOM) :
```
pickBody(detail) → { kind: 'text' | 'html', content: string }   // texte prioritaire
blockRemoteImages(html) → string                                 // anti-traceur : src/background distants neutralisés
sanitizeLinks(html) → string                                     // <a> : rel noopener noreferrer + schémas https/mailto
buildFrameDoc(html, { showImages }) → string                     // assemble le srcdoc : <meta CSP> + sanitizeLinks + (blockRemoteImages si !showImages)
```

**Hauteur de l'iframe — décision verrouillée :** avec `sandbox=""` le parent ne peut pas lire `contentDocument`. On retient **une hauteur fixe raisonnable + scroll interne** (option zéro-script, zéro-surface). On **n'ouvre pas** `allow-same-origin` pour mesurer la hauteur. (Si une auto-hauteur devenait indispensable plus tard, la seule voie acceptable serait `sandbox="allow-scripts"` + un script de mesure **maison** renvoyant la hauteur par `postMessage`, en origine opaque — **jamais** `allow-same-origin`.)

## 3. Structure des fichiers

```
src/server/
  mail-types.ts        [MOD] + AppThreadDetail, AppMessage, MailBodyPart
  mail-actions.ts      [MOD] + readThreadFn, setFlagsFn, moveThreadFn
                             + parsers purs : parseThreadDetail, buildSetFlagsCall,
                               buildMoveCall (résolution role→id)
src/components/mail/
  reader.tsx           [NEW] Reader (reader-bar + thread-head + liste MessageItem + reply-bar disabled)
  message-item.tsx     [NEW] MessageItem (en-tête repliable, corps, pièces jointes)
  email-body.ts        [NEW] pickBody, blockRemoteImages, sanitizeLinks, buildFrameDoc (purs) — §2.7
  use-thread-actions.ts[NEW] hook mutations optimistes (star, read, move) + réconciliation cache
  mail-icons.tsx       [MOD] + icônes manquantes (archive, trash2, mailOpen, moreV, chevLeft,
                             spam, reply, replyAll, forward, download, chevDown, x, clock, pin, send)
  layout.tsx           [MOD] slot reader : prop `reader?: ReactNode` (au lieu du placeholder figé)
  index.ts             [MOD] export Reader, MessageItem
src/routes/mail/
  $folder.tsx          [MOD] lecture `?thread`, montage Reader + readThreadFn, fermeture
src/i18n/               [MOD] clés mail.reader.* / mail.actions.*
src/components/mail/mail.css [MOD] minimal : bandeau images bloquées + style iframe
```

## 4. Types partagés (`mail-types.ts`)

```ts
export interface MailBodyPart {
  partId?: string
  type: string          // 'text/plain' | 'text/html' | …
  value?: string        // depuis bodyValues
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
  receivedAt: string
  unread: boolean
  hasAttachment: boolean
  textBody: string | null
  htmlBody: string | null
  attachments: AppAttachment[]
}

export interface AppThreadDetail {
  threadId: string
  subject: string
  messages: AppMessage[]     // ordre chronologique
  emailIds: string[]         // pour les actions au niveau fil
  starred: boolean           // agrégat ($flagged sur un email du fil)
  unread: boolean            // agrégat
}
```

## 5. Server functions (`mail-actions.ts`)

Toutes via `createServerFn`, `requireSession()` (déjà en 4a), `jmapUserCall`. Parsers purs extraits et testés isolément.

- `readThreadFn({ threadId })` (GET) → `parseThreadDetail(responses)`
- `setFlagsFn({ emailIds, flag, value })` (POST) → `buildSetFlagsCall(accountId, emailIds, flag, value)`
- `moveThreadFn({ emailIds, to })` (POST) → résout `to` via `Mailbox/get` (réutilise `mailboxRefs` + `mailboxIdByRole`), puis `buildMoveCall(accountId, emailIds, targetId)`

Validation Zod : `emailIds` = `z.array(z.string().min(1).max(64)).min(1).max(500)` (longueur **et** cardinalité bornées, cf. §2.4) ; `flag` ∈ {`$seen`,`$flagged`} ; `to` ∈ {`archive`,`trash`,`junk`,`inbox`} ; `threadId` string ≤ 64.

## 6. Composants UI

### 6.1 Reader (`reader.tsx`)
- **État vide** : `?thread` absent → placeholder maquette (`.empty`, icône `mailOpen`, « Aucune conversation sélectionnée »).
- **Chargement** : skeleton pendant le fetch de `readThreadFn`.
- **reader-bar** : retour (mobile), **archiver**, **corbeille**, snooze *(disabled, 4d)*, **spam/retirer-spam** (selon dossier courant), étiqueter *(disabled, 4d)*, **favori** (toggle), menu « Plus » → **marquer non-lu** (actif), épingler/imprimer/bloquer *(disabled, 4d)*.
- **thread-head** : sujet, nombre de messages. Section étiquettes *(disabled, 4d)*.
- **messages** : `MessageItem` × N, dernier ouvert.
- **reply-bar** : rendue mais **`disabled`** (4c).
- Auto mark-read à l'ouverture (effet sur `thread.id`).

### 6.2 MessageItem (`message-item.tsx`)
- En-tête repliable : avatar, expéditeur, destinataires (À/Cc dépliables), date/heure.
- Corps : via `email-body.ts` (texte, ou `<iframe sandbox="">` opaque + CSP via `buildFrameDoc`, cf. §2.7), bandeau images si HTML distant.
- Pièces jointes : liste `.attach` (icône type, nom, taille). Bouton télécharger rendu **`disabled`** (téléchargement réel hors 4b, cf. §11).
- Bouton « Répondre » par message *(disabled, 4c)*.

### 6.3 use-thread-actions (`use-thread-actions.ts`)
Hook exposant `star(value)`, `markRead(value)`, `move(to)` opérant sur le fil courant (emailIds). Encapsule les mutations react-query + réconciliation cache (§2.6).

## 7. CSS et thème

Les classes du lecteur (`.reader`, `.reader-bar`, `.reader-scroll`, `.reader-inner`, `.msg*`, `.thread-head`, `.thread-subject`, `.thread-meta`, `.attach*`, `.reply-bar`, `.recip-*`) sont **déjà présentes** dans `mail.css` (CSS maquette intégral importé en 4a). Ajouts 4b minimes :
- bandeau « Afficher les images » (`.img-block-banner`)
- conteneur iframe (`.msg-html-frame`)
- état `disabled` cohérent sur les boutons reportés (4c/4d).

## 8. i18n

Nouvelles clés sous `mail.reader.*` (titre vide, libellés boutons, « Afficher les images », « X messages », À/Cc/De/Date) et `mail.actions.*` (toasts : archivé, supprimé, spam signalé, retiré du spam, marqué lu/non-lu, ajouté/retiré des favoris ; erreurs). FR (+ structure prête pour autres locales si présentes en 4a).

## 9. Gestion des erreurs

| Cas | Comportement |
|---|---|
| Échec mutation (star/read) | Rollback optimiste + toast d'erreur **générique** |
| Échec move (archive/trash/spam) | Pas de fermeture du lecteur + toast d'erreur **générique** (l'invalidation ne s'applique qu'au succès) |
| Échec `readThreadFn` | État d'erreur dans le lecteur + bouton « Réessayer » |
| Session expirée (401) | `redirect /login` (déjà géré par `jmapUserCall`) |
| HTML email malveillant | Double barrière : `<iframe sandbox="">` (origine opaque) **+** CSP `default-src 'none'` dans le `srcdoc` ; images distantes et liens assainis (§2.7) |

> **Messages d'erreur (A09)** : les toasts affichent des **libellés i18n fixes** (« L'action a échoué », « Impossible d'ouvrir le message »). On **n'expose jamais** `JmapUserError.message`/`description`/`detail` au client (ids internes, état serveur) — ces détails restent côté serveur (logs).

## 10. Tests

**Purs (vitest, sans DOM) :**
- `email-body` :
  - `pickBody` (texte prioritaire, repli html, vides) ;
  - `blockRemoteImages` (src/background distants neutralisés, `data:`/`cid:` préservés) ;
  - `sanitizeLinks` (`<a>` reçoivent `rel="noopener noreferrer"` ; `javascript:`/`data:`/`vbscript:` neutralisés ; `https:`/`mailto:` conservés) ;
  - `buildFrameDoc` (préfixe bien la balise `<meta CSP>` ; applique `blockRemoteImages` si `showImages=false` et pas si `true`).
- `parseThreadDetail` : ordre messages, agrégats starred/unread, emailIds, corps depuis bodyValues.
- `buildSetFlagsCall` (`true`→true / `false`→null), `buildMoveCall` (role→id, MATCH_NONE si role absent).

**Composants (testing-library) :**
- Reader : états vide / chargé / erreur ; boutons reportés `disabled` ; clic actions → appelle le hook.
- MessageItem : repli/dépli, pièces jointes, choix corps texte vs iframe.
- use-thread-actions : optimiste + rollback (mock mutation qui échoue), invalidation sur move.

## 11. Hors scope Plan 4b

- **Répondre / Répondre à tous / Transférer / Composer** → Plan 4c
- **Étiquettes dynamiques (keywords custom)** → Plan 4d
- **Snooze (dossier En attente)** → Plan 4d
- **Épingler / Imprimer / Bloquer l'expéditeur** → Plan 4d
- **SSE / live mail** → Plan 4d
- **Téléchargement des pièces jointes** → ultérieur (bouton non câblé en 4b)
- **Actions au survol/swipe sur les lignes de liste** → ultérieur
- **Résumé IA réel** → hors scope produit (stub)
- **SettingsView / CalendarView** → Plan 4e

## 12. Références

- Plan 4a — Mail List (design + revue) : `docs/superpowers/specs/2026-06-12-plan-4a-mail-list-design.md`
- **Revue de sécurité 4b** (findings F1–F8, OWASP) : `docs/superpowers/reviews/2026-06-15-plan-4b-security-review.md`
- Maquette webmail : `webmail.zip` → `project/mail-views.jsx` (`Reader`, `MessageItem`, `AISummary`), `project/mail.css`
- RFC 8621 (JMAP Mail) §4 (Email/get, Email/set), §3 (Thread/get)
- Design global : `docs/superpowers/specs/2026-06-08-stalmail-design.md` §7 (JMAP), §8 (features), §9 (erreurs)
