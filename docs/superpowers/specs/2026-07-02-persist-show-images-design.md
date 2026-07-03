# Stalmail — Persistance de « Afficher les images » (#70) — Design Document

**Date :** 2026-07-02
**Statut :** validé en brainstorming, prêt pour le plan d'implémentation.
**Périmètre :** persister la décision utilisateur « Afficher les images » d'un mail à image distante, à deux granularités (par message + allowlist par expéditeur), avec révocation aux deux niveaux (expéditeur : « Bloquer » l'allowlist ; message : retrait du keyword — ajouté suite au retour de test utilisateur, cf. plan revoke-show-images). Corrige [#70](https://github.com/kkzakaria/stalmail/issues/70).
**Dépendances :** lecteur 4b livré (`MessageItem`, `readThreadFn`, `buildFrameDoc`/`frameCsp`, `setFlagsFn`/`buildSetFlagsCall`, store de session `session-store.ts` servant de gabarit).

## 1. Problème

`showImages` est un `useState(false)` local à `MessageItem` (`src/components/mail/message-item.tsx:18`). Aucune persistance : à chaque (re)montage (rechargement, re-navigation, re-render du fil) il repart à `false`, et la CSP de l'iframe (`img-src data: cid:`) re-bloque les ressources distantes. La décision de l'utilisateur est perdue à chaque rechargement.

Sévérité : mineure / UX. Le défaut « bloqué » est le bon côté sécurité (anti-traceur) ; c'est la **répétition** du geste qui est pénible.

## 2. Comportement attendu

Mémoriser le choix « Afficher les images », comme les clients mail standard, à **deux granularités** :

- **Par message** : le choix « afficher pour CE message » persiste (rechargement, cross-device).
- **Par expéditeur** : allowlist d'expéditeurs de confiance (façon Gmail « Toujours afficher les images de X »).

Le tout **explicite** et **révocable** (bandeau « Bloquer », aux deux granularités) : jamais de « tout afficher » global par défaut.

## 3. Décisions architecturales

### 3.1 Deux mécanismes de stockage, tous deux côté serveur

Choix issu du brainstorming : persistance **serveur** (cross-device), pas de stockage client. La consultation de la doc Stalwart/RFC 8621 a fait émerger un mécanisme natif pour la granularité par-message.

| Granularité | Mécanisme | Justification |
|---|---|---|
| **Par message** | **Keyword JMAP custom `stalmail_showimages`** sur l'Email (`Email/set`) | Natif RFC 8621 (« Users may add arbitrary keywords to an Email »), cross-device gratuit, **disparaît avec l'email** → aucune croissance de données à gérer. |
| **Par expéditeur** | **Store maison** `image-prefs-store.ts` (`allowedSenders[]`, keyé par `accountId`) | Aucun mécanisme natif JMAP par-expéditeur (les keywords sont par-email). Petit, borné par l'utilisateur. |

Les deux restent côté serveur / cross-device, cohérent avec le choix « serveur ».

### 3.2 Keyword JMAP custom (par message)

- Nom : `stalmail_showimages` — lowercase, sans préfixe `$` (réservé aux keywords enregistrés), sans caractère exclu IMAP (`( ) { espace % * " \ ]` et contrôles). RFC 8621 autorise les keywords arbitraires.
- **Lecture** : `Email/get` récupère déjà `keywords` (`mail-actions.ts:365`). `parseThreadDetail` lit déjà `keywords.$seen`/`.$flagged` — on ajoute la lecture de `keywords.stalmail_showimages`.
- **Écriture** : réutilise le patron `buildSetFlagsCall`/`setFlagsFn` → `Email/set { update: { [id]: { "keywords/stalmail_showimages": true } } }`.
- **Révocation par-message** : `"keywords/stalmail_showimages": null` via `hideImagesFn` (bandeau « Images distantes affichées · [Bloquer] » sur l'état `message-allowed`) — ajoutée suite au retour de test utilisateur (asymétrie avec la révocation expéditeur).
- Effet de bord bénin, à documenter : le keyword est visible via IMAP (client tiers), inoffensif car advisoire (comme `$seen`).

### 3.3 Store maison pour l'allowlist expéditeurs

Nouveau `src/server/image-prefs-store.ts`, **calqué sur `session-store.ts`** : fichier JSON sur le volume app (`STALMAIL_DATA_DIR`, défaut `/var/lib/stalmail`), cache mémoire, écriture atomique (tmp + `renameSync`), mode `0o600`, `__resetCacheForTest`. Fichier : `image-prefs.json`.

```ts
interface ImagePrefsRecord {
  accountId: string
  allowedSenders: string[] // emails normalisés (lowercase/trim)
}
```

CRUD : `getPrefs(accountId)` (renvoie `{ allowedSenders: [] }` si absent), `addSender(accountId, email)`, `removeSender(accountId, email)`, `deleteAllForAccount(accountId)` (cohérence avec la purge de session).

**Borne anti-abus (revue sécu)** : `allowedSenders` est plafonné à `MAX_TRUSTED_SENDERS = 500` par compte ; au-delà, `addSender` évince le plus ancien (FIFO). Sans cap, un client authentifié pourrait faire croître `image-prefs.json` sans limite (chaque mutation réécrit le fichier entier).

Absence de fichier → allowlist vide → tout `blocked` (défaut sûr, rétro-compatible).

### 3.4 Résolution serveur autoritaire dans `readThreadFn`

Un seul point de résolution, côté serveur. `parseThreadDetail` reste **pur** et prefs-agnostique ; l'enrichissement se fait dans le handler `readThreadFn` (qui a `accountId` via `requireSession`).

### 3.5 Révocation inline (pas de page settings)

Aucune page settings n'existe (phase 4e non faite). La révocation vit **dans le bandeau du lecteur** : un expéditeur de confiance affiche « Images de {expéditeur} affichées automatiquement · [Bloquer] ». Livrable sans attendre 4e ; satisfait l'exigence sécu « révocable ».

### 3.6 Composant présentationnel

`MessageItem` reste présentationnel : il lit `message.imageDecision` et reçoit des **callbacks en props** (`onShowOnce`, `onHideImages`, `onTrustSender`, `onUntrustSender`). Pas de hooks de route dans le composant testé (convention). La route possède la query + les mutations et **invalide la query du thread** après action.

## 4. Fonctions pures (extraites et testées) — `src/server/image-prefs.ts`

Cœur de la stratégie de test : la logique vit dans des fonctions pures.

Répartition claire : `parseThreadDetail` calcule le niveau **message** (il a le keyword) ; `applyImagePrefs` **upgrade** au niveau **expéditeur** (il a les prefs). La précédence sender > message est portée par l'upgrade.

```
normalizeSender(email: string): string
  → email.trim().toLowerCase()

// upgrade par-expéditeur d'une décision message-level déjà calculée
resolveImageDecision(
  prefs: ImagePrefs, // { allowedSenders: string[] }
  message: { from: MailAddress[]; imageDecision?: ImageDecision }, // absent ⇒ blocked (cohérent §5)
): ImageDecision
  → 'sender-allowed' si normalizeSender(message.from[0]?.email) ∈ allowedSenders
  → sinon message.imageDecision inchangé ('message-allowed' ou 'blocked')
  Précédence : sender > (message | blocked).
  Seul from[0] gouverne la décision (cohérent avec l'affichage du lecteur, qui
  présente from[0]) ; le cas multi-From n'est pas géré — cf. §8.

applyImagePrefs(detail: AppThreadDetail, prefs): AppThreadDetail
  → map resolveImageDecision(prefs, m) sur chaque message
```

## 5. Types partagés — `src/server/mail-types.ts`

```ts
export type ImageDecision = "sender-allowed" | "message-allowed" | "blocked"
// AppMessage gagne un champ OPTIONNEL (absent ⇒ traité comme "blocked", défaut sûr) :
imageDecision?: ImageDecision
```

Optionnel plutôt que requis : les factories de test existantes (`message-item.test.tsx`, `reader.test.tsx`, `$folder.test.tsx`) construisent des `AppMessage` sans ce champ — un champ requis les casserait toutes sans bénéfice, le défaut `blocked` étant le comportement sûr voulu.

`parseThreadDetail` pose le niveau message directement depuis le keyword : `imageDecision = keywords.stalmail_showimages === true ? "message-allowed" : "blocked"`. `readThreadFn` applique ensuite `applyImagePrefs(parseThreadDetail(...), getPrefs(accountId))` pour l'upgrade `sender-allowed`.

## 6. Server functions — `src/server/mail-actions.ts` (Zod + `requireSession`)

`accountId` **toujours** issu de `requireSession`, jamais du client.

```
readThreadFn (modifié)
  → applyImagePrefs(parseThreadDetail(responses), getPrefs(accountId))

showImagesOnceFn({ emailIds: string[] })      // Zod: emailIdsSchema (réutilisé)
  → Email/set { update: { [id]: { "keywords/stalmail_showimages": true } } }
  (signature en tableau — réutilise emailIdsSchema, comme setFlagsFn — mais
  l'UI appelle PAR MESSAGE : onShowOnce(message.id) → emailIds: [id])

hideImagesFn({ emailIds: string[] })          // Zod: showImagesSchema (réutilisé)
  → Email/set { update: { [id]: { "keywords/stalmail_showimages": null } } }
  (révocation par-message — miroir de showImagesOnceFn, même contrôle emailSetRejections)

trustSenderFn({ sender: string })             // Zod: email normalisable, borné en longueur
  → addSender(accountId, normalizeSender(sender))

untrustSenderFn({ sender: string })
  → removeSender(accountId, normalizeSender(sender))
```

Pas d'`Email/set` générique exposé (convention sécu : enums/keywords fermés résolus côté serveur). Les schémas Zod des nouvelles fn (`senderSchema`, `showImagesSchema`) sont exportés et testés (rejet d'adresse invalide/trop longue, lot d'ids vide), comme `sendMailSchema`.

## 7. UI — `src/components/mail/message-item.tsx` + câblage route/reader

`showImages` local disparaît. `MessageItem` dérive : `const showImages = message.imageDecision !== "blocked"`, passé à `buildFrameDoc`. Le mécanisme CSP (`frameCsp`) est inchangé dans sa structure ; seul le durcissement §8 (retrait de `http:` de la variante consentie) le modifie.

Variantes de bandeau selon `message.imageDecision` :

| `imageDecision` | Bandeau |
|---|---|
| `blocked` | « Images distantes bloquées · **[Afficher les images]** **[Toujours afficher pour {expéditeur}]** » |
| `sender-allowed` | « Images de {expéditeur} affichées automatiquement · **[Bloquer]** » (révocation) |
| `message-allowed` | « Images distantes affichées · **[Bloquer]** » (révocation par-message : retire le keyword) |

Callbacks (props) → mutations dans la route → invalidation de la query du thread. Optimistic update possible (basculer `imageDecision` en cache avant refetch). Quatre callbacks : `onShowOnce(id)` (pose le keyword), `onHideImages(id)` (le retire — révocation par-message), `onTrustSender(sender)` / `onUntrustSender(sender)` (allowlist).

## 8. Sécurité (revue requise avant merge)

- Défaut `blocked` (CSP `img-src data: cid:`) tant qu'aucun consentement enregistré — **inchangé**.
- Persistance **explicite** (clic utilisateur) et **révocable** aux deux niveaux (liens Bloquer inline : expéditeur → allowlist, message → keyword).
- Identité expéditeur = **adresse exacte normalisée**, jamais le domaine (conservateur, anti-usurpation de domaine).
- Anti-traceur (à documenter dans le code) : faire confiance à un expéditeur charge automatiquement ses images distantes (pixels de tracking inclus) — choix explicite et révocable, façon Gmail.
- Store `image-prefs.json` : mode `0o600`, scopé `accountId` (issu serveur), aucune fuite inter-comptes. Allowlist plafonnée (`MAX_TRUSTED_SENDERS`, cf. §3.3).
- On n'élargit `img-src` qu'après consentement persisté — le confinement iframe sandbox (#68) reste intact. **Durcissement inclus** (revue sécu) : la CSP consentie passe de `img-src data: cid: https: http:` à `img-src data: cid: https:` — les traceurs en clair (http) exposaient l'ouverture du mail à tout intermédiaire réseau ; les rares images http-only ne se chargeront pas (défaut sûr).

**Risques résiduels acceptés** (revue sécu, à réévaluer en phase settings) :

- **Usurpation du From** : l'allowlist est keyée sur l'en-tête From affiché, falsifiable. Un mail usurpant l'adresse d'un expéditeur de confiance et passant les filtres déclencherait l'auto-chargement de ses traceurs. Impact limité à la vie privée (aucune exécution JS possible : sandbox/CSP inchangés). Durcissement futur : conditionner `sender-allowed` à un verdict DMARC pass (lecture d'`Authentication-Results` via `Email/get`) — hors périmètre ici, à ouvrir en issue de suivi.
- **Multi-From** : seul `from[0]` gouverne ; un mail `From: confiance@x, autre@y` chargerait aussi les traceurs du second (la CSP est par-message, pas par-adresse). Marginal — suppose déjà un `from[0]` de confiance.
- **Allowlist non corroborée** : `trustSenderFn` n'exige pas que l'adresse figure dans un mail réel du compte ; impact nul hors du compte lui-même.

## 9. Tests

- `src/server/image-prefs.test.ts` : `normalizeSender` ; `resolveImageDecision` (3 branches + précédence sender > message + `from` vide) ; `applyImagePrefs`.
- `src/server/image-prefs-store.test.ts` : CRUD + persistance disque + cache + `__resetCacheForTest` (miroir de `session-store.test.ts`, sur répertoire tmp).
- `src/server/mail-actions.test.ts` : validation Zod des nouvelles fn ; enrichissement `readThreadFn` (lecture keyword → `imageDecision`) ; `Email/set` du keyword custom.
- `src/components/mail/message-item.test.tsx` : les 3 variantes de bandeau selon `imageDecision` ; déclenchement des callbacks `onShowOnce`/`onHideImages`/`onTrustSender`/`onUntrustSender`.

## 10. i18n — `src/i18n/resources.ts` (clés FR)

Réutilise `mail.reader.imagesBlocked`, `mail.reader.showImages`. Nouvelles clés :

- `mail.reader.trustSender` → « Toujours afficher pour {{sender}} »
- `mail.reader.imagesFromSenderShown` → « Images de {{sender}} affichées automatiquement »
- `mail.reader.blockSender` → « Bloquer »

## 11. Hors périmètre

- Page settings de gestion de l'allowlist (phase 4e) — révocation inline suffit ici.
- Allowlist par **domaine** (volontairement écartée, trop large).
- Réglage global « toujours afficher toutes les images » (refusé, anti-traceur).
