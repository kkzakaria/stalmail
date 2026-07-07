# Transfert véritable (issue #79) — Design

**Date** : 2026-07-06
**Issue** : [#79 — « Transférer » ne produit pas un vrai transfert (en-tête + pièces jointes) + périmètre à définir](https://github.com/kkzakaria/stalmail/issues/79)
**Statut** : validé en brainstorming

## Problème

« Transférer » se comporte aujourd'hui comme une réponse : `buildReplyContext`
(mode `forward`, `src/server/compose-build.ts`) réutilise le même bloc cité que
reply (`<p><br></p><blockquote>…</blockquote>`), sans en-tête de transfert
(De / Date / Objet / À de l'original) et sans reprise des pièces jointes. Le
transfert n'est pas réellement utilisable comme transfert.

## Décisions produit

1. **Transfert par message** (option C de l'issue) : chaque message du fil
   porte sa propre action de transfert — un bouton icône ↪ dans l'en-tête du
   message, visible quand le message est ouvert.
2. **Le bouton « Transférer » de la barre d'actions du fil est retiré**
   (`QuickReply`). La barre conserve « Répondre » (action principale) et
   « Répondre à tous ».
3. **Pièces jointes de l'original reprises automatiquement et retirables**
   individuellement dans le composer (référence `blobId`, aucun re-upload).
4. **Upload de nouvelles pièces jointes : hors périmètre** — issue séparée à
   créer (endpoint JMAP `uploadUrl`, proxy BFF, limites de taille).
5. **En-tête de transfert en français via i18n** : bloc
   « ---------- Message transféré ---------- » avec De / Date / Objet / À
   (+ Cc si présent), libellés fournis par des clés `t('...')`.

## Approche retenue

**Étendre le pipeline client existant** (approche 1). Le contexte de transfert
se construit côté client — comme reply/replyAll — à partir du
`AppThreadDetail` déjà chargé par `readThreadFn`, qui contient tout le
nécessaire (`from`, `to`, `cc`, `receivedAt`, `htmlBody`, `attachments` avec
`blobId`).

Alternatives écartées :

- **Server function dédiée (`forwardContextFn`)** : aucun gain de sécurité réel
  (la barrière autoritaire est à l'envoi dans les deux cas), un round-trip et
  un état de chargement en plus, i18n serveur à plomber, asymétrie avec
  reply/replyAll. Deviendrait pertinente si les corps de fil cessaient d'être
  chargés en entier ou si le transfert devenait accessible sans ouvrir le fil.
- **Pièce jointe `.eml` (message/rfc822)** : fidèle et minimal mais UX faible ;
  ne répond pas au format demandé par l'issue.

## Architecture

### 1. Fonction pure `buildForwardContext` (`src/server/compose-build.ts`)

```ts
interface ForwardLabels {
  forwarded: string // "Message transféré"
  from: string // "De"
  date: string // "Date"
  subject: string // "Objet"
  to: string // "À"
  cc: string // "Cc"
}

interface ForwardContext {
  subject: string
  quotedHtml: string
  attachments: AppAttachment[]
}

function buildForwardContext(
  message: AppMessage,
  threadSubject: string,
  labels: ForwardLabels,
  locale: string // Intl.DateTimeFormat — date absolue localisée
): ForwardContext
```

- **Libellés injectés en paramètre** (fournis par `t('...')` à l'appel) : la
  fonction reste pure et testable isolément, l'i18n reste dans la couche UI.
- **Sujet** : `prefixSubject(threadSubject, "Fwd")` (existant, ne double pas
  le préfixe).
- **Corps généré** — uniquement des balises autorisées par
  `sanitizeComposeHtml` (`p`, `br`, plus `blockquote` **ajouté à l'allowlist**
  au cours de l'implémentation — il n'y figurait pas et la citation reply
  perdait silencieusement sa balise ; balise inerte, sans attribut) :

  ```html
  <p><br /></p>
  <p>
    ---------- Message transféré ----------<br />
    De : Jean Dupont &lt;jean@exemple.fr&gt;<br />
    Date : jeu. 2 juillet 2026 à 14:32<br />
    Objet : Rapport trimestriel<br />
    À : moi@mondomaine.fr
  </p>
  <!-- + ligne Cc si présente -->
  <blockquote>…corps original sanitisé…</blockquote>
  ```

- **Échappement HTML systématique** des valeurs issues du message (noms,
  adresses, sujet) avant interpolation. Double motif : sécurité (un expéditeur
  nommé `<script>` ne doit rien injecter) et correction (les adresses
  `<jean@exemple.fr>` seraient sinon avalées comme des balises par DOMPurify).
- Le corps original passe par `sanitizeComposeHtml` (barrière B1) ; repli sur
  `textBody` échappé si le message n'a pas de HTML.
- **Pièces jointes** : `message.attachments` renvoyé tel quel
  (`{blobId, name, type, size}`) — état initial retirable du composer.
- Pas d'`inReplyTo` ni `references` en forward (comportement actuel, correct).
- **Nettoyage** : la branche `forward` de `buildReplyContext` est supprimée et
  son paramètre `mode` se rétrécit à `"reply" | "replyAll"` — le type garantit
  qu'on ne repasse plus par l'ancien chemin. `ComposeMode` conserve
  `"forward"` (utilisé par `ComposerDraft.mode`).

### 2. UI

**Bouton par message** (`src/components/mail/message-item.tsx`) :

- Nouvelle prop `onForward?: (message: AppMessage) => void`.
- Bouton icône ↪ dans l'en-tête du message, affiché quand le message est
  ouvert, `stopPropagation` (ne replie pas le message au clic),
  `aria-label`/`title` via la clé existante `mail.compose.forward`.

**État du brouillon remonté** :

- Le déclencheur du forward vit désormais dans `MessageItem`, composant frère
  de `QuickReply` : l'état du brouillon remonte dans le parent (`reader.tsx`)
  via un hook dédié `useQuickReplyDraft(detail, selfEmail)` exposant `draft`,
  `openReply(mode)`, `openForward(message)` (appelle `buildForwardContext`
  avec les libellés `t(...)`), `patch`, `close`.
- `QuickReply` devient pleinement présentationnel (`draft` + callbacks en
  props), aligné sur la convention du projet ; ses tests s'adaptent.

**Éditeur de transfert** (éditeur inline existant réutilisé) :

- Champ « À » éditable existant ; en forward il s'ouvre vide.
- **Rangée de pièces jointes** entre l'en-tête et l'éditeur : une puce par
  pièce (nom + taille, style dérivé de `.attach` du lecteur) avec un bouton ×
  qui la retire du brouillon. Rangée absente si aucune pièce.

**Barre du bas** (`quick-reply.tsx`) : bouton « Transférer » retiré.

### 3. Envoi

Pas de nouvelle server function — extension de la chaîne existante :

- `ComposerDraft` (`use-composer.ts`) gagne `attachments: AppAttachment[]`
  (vide par défaut ; le composer « nouveau message » n'en met jamais).
- `sendMailSchema` (`mail-actions.ts`) gagne un champ `attachments` avec des
  **contraintes par champ obligatoires** (audit sécurité F1 : `name` et `type`
  finissent dans les en-têtes MIME `Content-Disposition`/`Content-Type` de la
  part — sans re-traitement serveur au-delà de Zod, ce schéma EST le contrôle
  autoritaire contre l'injection d'en-têtes CRLF, au même titre que
  `isCleanHeaderValue` sur le sujet et les adresses) :

  ```ts
  attachments: z
    .array(
      z.object({
        blobId: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
        name: z.string().max(255).refine(isCleanHeaderValue),
        type: z.string().max(127).regex(/^[\w.+-]+\/[\w.+-]+$/),
        size: z.number().int().nonnegative(),
      })
    )
    .max(50)
    .default([])
  ```

  La limite de 50 est un garde-fou de forme ; la taille réelle est vérifiée
  par Stalwart à la soumission (le `size` client n'est pas une donnée de
  confiance, le serveur mail recalcule).
- `buildSendMethodCalls` (`compose-build.ts`) ajoute, quand la liste est non
  vide, la propriété de commodité RFC 8621 sur le `Email/set` :

  ```ts
  attachments: data.attachments.map((a) => ({
    blobId: a.blobId,
    type: a.type,
    name: a.name,
    disposition: "attachment",
  }))
  ```

  Aucun re-upload : les blobs existants du compte sont référencés. `size` est
  accepté par le schéma (forme de `AppAttachment`, affichage des puces) mais
  volontairement absent du payload JMAP — Stalwart le calcule lui-même.

## Sécurité

Un audit de conception (`security-reviewer`, OWASP Top 10) a été passé sur ce
design le 2026-07-06. Synthèse :

Les deux barrières existantes couvrent le nouveau flux :

- **B1 (client, défense en profondeur)** : échappement des champs interpolés
  + `sanitizeComposeHtml` du bloc complet dans `buildForwardContext`.
  L'audit confirme l'absence de risque mXSS/double-décodage : l'ordre
  échapper → concaténer → sanitiser est correct et l'allowlist DOMPurify est
  restrictive (pas de `svg`/`math`/`style`/`template`).
- **B2 (serveur, autoritaire)** : `sendMailFn` re-sanitise le HTML reçu, quoi
  qu'ait fait le client. Pour les métadonnées d'attachment (`name`, `type`),
  le contrôle autoritaire est le schéma Zod durci ci-dessus (F1) — seule
  entrée de `sendMailFn` qui ne subit pas de re-traitement au-delà de Zod.
- **Blobs (hypothèse vérifiée dans le code)** : tout le flux d'envoi passe
  par `jmapUserCall` (Bearer utilisateur, `jmap-user.ts`) avec l'`accountId`
  issu de `requireSession` — jamais du client, jamais le Bearer admin
  (`jmap.ts` n'est pas référencé par `mail-actions.ts`). Un `blobId` forgé
  pointant vers un autre compte est donc rejeté par Stalwart
  (`blobNotFound` → échec d'envoi propre, sans fuite). **Dépendance de
  sécurité explicite** : ce modèle repose sur l'ACL blob par-compte de
  Stalwart ; un test de non-régression « blobId d'un autre compte → envoi
  échoue » est à prévoir.
- **Injection JSON via `blobId`** : impossible, le batch JMAP est sérialisé
  par `JSON.stringify` ; la regex Zod sert de durcissement.
- **Taille (F2)** : `.max(50)` borne le nombre, pas la taille agrégée (50×
  le même gros blob = amplification). La limite autoritaire est le
  `max-message-size` de Stalwart — prérequis de configuration à documenter ;
  le rate-limit d'envoi existant (30/h/compte) borne la fréquence.
- **Parts inline reprises (F3)** : `message.attachments` (RFC 8621) inclut
  les parts inline (`cid:`, pixels). Elles sont ré-attachées par défaut —
  acceptable car la rangée de puces les rend toutes visibles et retirables
  avant envoi ; ce point motive l'affichage exhaustif des puces.
- Second passage du sous-agent `security-reviewer` en fin d'implémentation.

## Erreurs et limites connues

- **Blob introuvable/expiré** à l'envoi → `Email/set` échoue → chemin d'échec
  d'envoi existant (message d'échec, brouillon conservé).
- **Images inline `cid:`** dans le corps original : la sanitisation ne laisse
  passer que `https`/`mailto`, elles sont retirées du HTML cité mais restent
  transportées en pièces jointes (JMAP les liste dans `attachments`).
  Limitation documentée, acceptable pour cette phase.
- Message sans corps HTML → repli sur `textBody` échappé.

## Tests

Fonctions pures d'abord (stratégie du projet, vitest) :

- `buildForwardContext` : champs de l'en-tête (De/Date/Objet/À), ligne Cc
  conditionnelle, échappement d'un expéditeur/sujet hostile (`<script>`,
  `<img onerror>`), non-doublement `Fwd:`, repli `textBody`, passage des
  attachments.
- `buildSendMethodCalls` : présence et forme de `attachments[]`
  (`disposition: "attachment"`), absence quand la liste est vide.
- `sendMailSchema` : rejet des métadonnées hostiles — `name` avec CR/LF
  (injection d'en-tête MIME), `type` hors forme `type/subtype`, `blobId`
  hors alphabet autorisé (F1).
- Non-régression scoping blob : envoi avec un `blobId` étranger au compte →
  échec propre (test d'intégration ou test contractuel sur le mapping
  d'erreur `parseSendResult`).
- `buildReplyContext` : rétrécissement de `mode` ; les tests forward
  existants migrent vers `buildForwardContext`.
- Composants : `MessageItem` (bouton ↪ présent quand ouvert, `onForward`
  appelé, pas de repli au clic), `QuickReply` (puces affichées, retrait d'une
  pièce, barre sans bouton Transférer), hook `useQuickReplyDraft`.

## Hors périmètre

- Upload de nouvelles pièces jointes depuis le composer (issue séparée).
- Transfert de tout le fil (option B de l'issue) — non retenu.
- Transfert depuis la liste des conversations sans ouvrir le fil.
- Rendu des images inline `cid:` dans le corps transféré.
