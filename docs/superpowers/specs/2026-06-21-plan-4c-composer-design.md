# Plan 4c — Composer (rédaction & envoi) — Design

> Statut : validé en brainstorming (2026-06-21).
> Phase précédente : 4b (Lecteur & Actions). Phase suivante : 4d (live / labels).

## 1. Contexte

La 4b a rendu la boîte **lisible et modifiable** : on ouvre un fil dans le lecteur,
on lit la conversation et on agit dessus (favori, lu/non-lu, archiver, corbeille,
spam). La rédaction restait explicitement hors scope (cf. 4b §11).

La 4c ajoute la première capacité d'**émission** de l'utilisateur : composer un
nouveau message et répondre / répondre à tous / transférer depuis un fil. C'est la
première fois que l'application appelle `EmailSubmission/set` (envoi réel via SMTP
côté Stalwart), au-delà des `Email/set` « en place » de la 4b.

## 2. Périmètre

### Dans le scope

| Élément | Détail |
|---|---|
| Actions | Nouveau message, Répondre, Répondre à tous, Transférer |
| Éditeur | **HTML minimal** (gras, italique, lien, listes), composant RTE **partagé** |
| Corps | `multipart/alternative` : `text/html` + alternative `text/plain` |
| Surfaces UI | (a) barre quick-reply inline dans le Reader ; (b) Composer flottant (nouveau message), modes réduit / normal / plein écran |
| Envoi JMAP | `Identity/get` → `Email/set` (brouillon) → `EmailSubmission/set` (+ `onSuccessUpdateEmail`) |
| IA | Bouton « Générer un brouillon » = **stub** (non câblé à un modèle) |

### Hors scope 4c

- **Auto-save / reprise de brouillon** (`Email/set` debounce dans Drafts) → phase ultérieure
- **Pièces jointes / images inline** (`Blob/upload`) → phase dédiée
- **Mise en forme avancée** (polices, couleurs, tailles, alignement, emoji) → ultérieur
- **Signature gérée** (édition, activation par défaut) → ultérieur ; pas de signature insérée en 4c
- **Envoi programmé / annuler l'envoi (undo send)** → ultérieur
- **Multi-identités / choix de l'adresse d'expédition dans l'UI** → ultérieur (identité primaire en 4c)
- **IA réelle de rédaction** → hors scope produit (stub)

## 3. Décisions architecturales

### 3.1 Éditeur HTML minimal, composant partagé

Un seul composant `RteEditor` (présentationnel) est embarqué dans les **deux**
surfaces (barre inline du Reader et Composer flottant). Il expose un `contentEditable`
avec une toolbar réduite : **gras, italique, lien, liste à puces, liste numérotée**.
Cela garantit un corps `text/html` + `text/plain` cohérent partout et une seule
logique d'édition à tester.

L'éditeur produit du HTML « brut navigateur » : il n'est **jamais** considéré comme
sûr. La sanitisation autoritaire a lieu **côté serveur** (cf. §6).

### 3.2 Chaîne JMAP d'envoi

Un seul batch `methodCalls` (chaînage par back-reference `#id`) :

| # | Méthode | Rôle |
|---|---|---|
| 1 | `Identity/get` (`ids: null`) | Identité d'expédition : on retient celle dont `email` correspond au compte ; à défaut la première |
| 2 | `Email/set` *create* | Crée le brouillon |
| 3 | `EmailSubmission/set` *create* | Soumet l'email et met à jour son état au succès |

**`Email/set` create** :

```jsonc
{
  "mailboxIds": { "<draftsId>": true },
  "keywords": { "$draft": true, "$seen": true },
  "from": [{ "name": "<identity.name>", "email": "<identity.email>" }],
  "to":  [/* MailAddress[] */],
  "cc":  [/* MailAddress[] */],
  "bcc": [/* MailAddress[] */],
  "subject": "<subject>",
  // threading (reply / forward uniquement)
  "inReplyTo":  ["<message-id-original>"],
  "references": ["<...refs...>", "<message-id-original>"],
  "bodyValues": {
    "html":  { "value": "<html sanitisé>" },
    "plain": { "value": "<texte>" }
  },
  "htmlBody": [{ "partId": "html",  "type": "text/html" }],
  "textBody": [{ "partId": "plain", "type": "text/plain" }]
}
```

> Note : `inReplyTo` / `references` sont des en-têtes ; en JMAP on les passe via les
> propriétés d'en-tête appropriées (`header:In-Reply-To:asMessageIds`,
> `header:References:asMessageIds`) plutôt que des propriétés `Email` de premier
> niveau. Le détail exact (propriété vs header set) est tranché au plan, en
> s'appuyant sur la capture API et RFC 8621 §4.1.

**`EmailSubmission/set` create** :

```jsonc
{
  "emailId": "#<emailCreateId>",      // back-reference vers l'Email créé en #2
  "identityId": "<identity.id>",
  "envelope": {
    "mailFrom": { "email": "<identity.email>" },
    "rcptTo":   [{ "email": "<to/cc/bcc...>" }]   // bcc inclus dans l'enveloppe
  }
}
```

avec `onSuccessUpdateEmail` au niveau de l'appel `EmailSubmission/set` :

```jsonc
"onSuccessUpdateEmail": {
  "#<submissionCreateId>": {
    "keywords/$draft": null,
    "mailboxIds/<draftsId>": null,
    "mailboxIds/<sentId>": true
  }
}
```

→ au succès de l'envoi : retire le keyword `$draft`, sort le message de Drafts et le
place dans Sent.

### 3.3 Résolution des mailbox & capabilities

- Les ids des dossiers `drafts` et `sent` sont résolus par **`role`** (réutilise le
  pattern existant `mailboxRefs` / `resolveFilter` de `mail-actions.ts`).
- `jmap-user.ts` n'utilise aujourd'hui que `['urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail']`. Les appels d'envoi doivent ajouter
  **`urn:ietf:params:jmap:submission`** au tableau `using`. On introduit donc un jeu
  de capabilities dédié à l'envoi (ou un paramètre optionnel de `jmapUserCall`),
  sans modifier les appels de lecture existants.

## 4. Cœur testable — fonctions pures

Conformément à la stratégie de test du projet, la logique vit dans des fonctions
pures extraites, testées isolément (pas dans les handlers ni les composants).

| Fonction | Signature (indicative) | Rôle |
|---|---|---|
| `parseAddressList` | `(raw: string) → { valid: MailAddress[]; invalid: string[] }` | Parse `Nom <a@b>, c@d` (séparé par virgules), valide chaque email |
| `buildReplyContext` | `(thread: AppThreadDetail, mode) → ReplyContext` | Destinataires + objet (`Re:`/`Fwd:` dédupliqué) + `inReplyTo`/`references` + citation (`quotedHtml`, `quotedText`) selon le mode |
| `sanitizeComposeHtml` | `(html: string) → string` | **Allowlist stricte** ; sécurité-critique |
| `htmlToPlainText` | `(html: string) → string` | Génère l'alternative `text/plain` |
| `buildSendMethodCalls` | `(input, { draftsId, sentId, identity }) → JmapMethodCall[]` | Assemble le batch Identity/Email/EmailSubmission |
| `parseSendResult` | `(responses: JmapMethodResponse[]) → SendResult` | Extrait l'id de soumission / `notCreated` / `SetError` → erreur typée |

`mode` ∈ `'compose' | 'reply' | 'replyAll' | 'forward'` (enum fermé).

**Sémantique de `buildReplyContext`** :

- `reply` : `to` = expéditeur du dernier message ; `subject` = `Re: <objet>` ; cite le message.
- `replyAll` : `to` = expéditeur ; `cc` = (`to` + `cc` d'origine) **moins l'utilisateur courant** ; `subject` = `Re:` ; cite.
- `forward` : `to` = vide ; `subject` = `Fwd: <objet>` ; inclut en-têtes d'origine + corps ; pas de `inReplyTo`.

**`sanitizeComposeHtml` — allowlist** : `b, i, strong, em, a[href], ul, ol, li, p, br`.
Tout autre élément/attribut est retiré (en particulier `script`, `style`, `on*`,
`javascript:`...). Les `href` sont restreints à `http(s):` / `mailto:`.

## 5. Server function

`sendMail` — `createServerFn({ method: 'POST' })`, entrée **validée par Zod** :

```ts
{
  mode: 'compose' | 'reply' | 'replyAll' | 'forward',  // enum fermé
  to:  MailAddress[],
  cc:  MailAddress[],
  bcc: MailAddress[],
  subject: string,
  html: string,                 // HTML brut du RTE, sanitisé côté serveur
  inReplyTo?: string,           // threading (reply / forward)
  references?: string[],
}
```

Flux :

1. `requireSession` (sid + accountId) ; sur session expirée → `redirect('/login')`.
2. `withFreshAccessToken`.
3. Batch lecture : `Mailbox/get` (résolution `drafts`/`sent` par role) + `Identity/get`.
4. `sanitizeComposeHtml(html)` + `htmlToPlainText(...)`.
5. `buildSendMethodCalls(...)`.
6. `jmapUserCall(..., capabilities incluant submission)`.
7. `parseSendResult(...)` → succès (id message envoyé) ou erreur typée.

Aucune opération JMAP générique n'est exposée au client : seul l'enum `mode` et des
champs validés transitent.

## 6. Sécurité

- **Sanitisation HTML côté serveur** : le HTML du `RteEditor` est traité comme non
  fiable. `sanitizeComposeHtml` applique une allowlist avant tout `Email/set`.
- **Validation des adresses** : toutes les adresses (`to`/`cc`/`bcc`) validées par
  Zod (format email) avant envoi.
- **`bcc`** : présent dans l'`envelope.rcptTo` (pour la livraison) mais **jamais**
  exposé dans les en-têtes du message stocké/livré.
- **Enum `mode` fermé** ; pas de méthode JMAP arbitraire pilotable par le client.
- Cohérent avec la revue de sécurité 4b (findings F1–F8) : pas de secret côté client,
  contenu non fiable contenu, entrées validées.

## 7. UI

- `RteEditor` (présentationnel, partagé) : `contentEditable` + toolbar minimale
  (gras / italique / lien / listes). Props `value`, `onChange`, `placeholder`.
- `Composer` (flottant, présentationnel) : champs À / Cc / Cci / Objet + `RteEditor`
  + actions Envoyer / Fermer ; modes `min` / `normal` / `max`. Déclenché par le
  bouton « Nouveau message » de la sidebar (`onCompose`).
- **Reader quick-reply** : `RteEditor` pré-rempli via `buildReplyContext`, modes
  reply / replyAll / forward.
- `useComposer` + mutation TanStack Query `sendMail` ; toast succès/échec (composant
  `toast` existant) ; invalidation des queries fil / liste après envoi.
- **i18n** : tous les libellés via clés `t('...')` en français, aucun texte en dur.

## 8. Gestion des erreurs

| Cas | Comportement |
|---|---|
| Adresse invalide | Erreur de champ inline, envoi bloqué (pré-validation client + Zod serveur) |
| Échec `Email/set` / `EmailSubmission/set` | Toast d'erreur ; **composer conservé** (contenu non perdu) |
| Session expirée | `redirect('/login')` (pattern existant) |

## 9. Tests

- **Pures** : `parseAddressList`, `buildReplyContext` (3 modes), `sanitizeComposeHtml`
  (vecteurs XSS : `script`, `on*`, `javascript:`...), `htmlToPlainText`, préfixe
  `Re:`/`Fwd:`, `buildSendMethodCalls`, `parseSendResult` (succès + `notCreated`).
- **Composants** : `RteEditor`, `Composer` (présentationnel), quick-reply du Reader.
- **Intégration** : `useComposer` / mutation `sendMail` (sur le modèle du test
  `useThreadActions` de la 4b).

## 10. Références

- Plan 4b — Reader & Actions (design) : `docs/superpowers/specs/2026-06-15-plan-4b-reader-actions-design.md` (§11 hors scope → 4c)
- Revue sécurité 4b : `docs/superpowers/reviews/2026-06-15-plan-4b-security-review.md`
- Design global : `docs/superpowers/specs/2026-06-08-stalmail-design.md` (§6 envoi, §7 JMAP)
- Capture API Stalwart : `docs/superpowers/specs/2026-06-09-stalwart-api-capture.md` (capabilities `submission`, scopes)
- Maquette : `webmail.zip` → `project/mail-views.jsx` (`Composer`, `Reader` quick-reply, `MessageItem`)
- RFC 8621 (JMAP Mail) §4 (`Email/get`, `Email/set`), §7 (`EmailSubmission`) ; RFC 8620 (`Identity`)
