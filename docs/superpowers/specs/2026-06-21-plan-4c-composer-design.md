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

> **Note SSRF (R4)** : en 4c, le BFF ne déréférence jamais d'URL fournie par
> l'utilisateur (`href`/`mailto:` partent tels quels dans l'email). RAS sur A10. À
> recadrer dès la phase images inline / `Blob/upload` : ne jamais laisser le serveur
> fetcher une URL distante fournie par le client.

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
  'urn:ietf:params:jmap:mail']`. **Décision (R5)** : `jmapUserCall` reçoit un
  paramètre optionnel `capabilities?` (défaut = `MAIL_CAPABILITIES`).
  **`urn:ietf:params:jmap:submission`** est ajouté **uniquement** pour l'appel
  `sendMail`. Les appels de lecture existants gardent strictement leur `using`
  actuel (pas d'élargissement de surface global).

## 4. Cœur testable — fonctions pures

Conformément à la stratégie de test du projet, la logique vit dans des fonctions
pures extraites, testées isolément (pas dans les handlers ni les composants).

| Fonction | Signature (indicative) | Rôle |
|---|---|---|
| `parseAddressList` | `(raw: string) → { valid: MailAddress[]; invalid: string[] }` | Parse `Nom <a@b>, c@d` (séparé par virgules), valide chaque email **et rejette CR/LF/NUL dans le display-name** (B3) |
| `buildReplyContext` | `(thread: AppThreadDetail, mode) → ReplyContext` | Destinataires + objet (`Re:`/`Fwd:` dédupliqué) + `inReplyTo`/`references` (Message-ID validés) + citation (`quotedHtml`, `quotedText`) selon le mode. **`quotedHtml` est issu de `sanitizeComposeHtml(htmlBody d'origine)` — jamais le HTML brut du message non fiable** (B1) |
| `sanitizeComposeHtml` | `(html: string) → string` | Sanitiseur autoritaire (parseur DOM à allowlist) ; sécurité-critique (B2) |
| `htmlToPlainText` | `(html: string) → string` | Génère l'alternative `text/plain` |
| `buildSendMethodCalls` | `(input, { draftsId, sentId, identity }) → JmapMethodCall[]` | Assemble le batch Identity/Email/EmailSubmission |
| `parseSendResult` | `(responses: JmapMethodResponse[]) → SendResult` | Extrait l'id de soumission / `notCreated` / `SetError` → erreur typée |

`mode` ∈ `'compose' | 'reply' | 'replyAll' | 'forward'` (enum fermé).

**Sémantique de `buildReplyContext`** :

- `reply` : `to` = expéditeur du dernier message ; `subject` = `Re: <objet>` ; cite le message.
- `replyAll` : `to` = expéditeur ; `cc` = (`to` + `cc` d'origine) **moins l'utilisateur courant** ; `subject` = `Re:` ; cite.
- `forward` : `to` = vide ; `subject` = `Fwd: <objet>` ; inclut en-têtes d'origine + corps **cité (sanitisé)** ; pas de `inReplyTo`.

> **Citation = contenu non fiable (B1).** Le `htmlBody` du message d'origine est du
> HTML hostile par défaut (en 4b il n'est neutralisé que parce qu'il est rendu dans
> `<iframe sandbox="">` + CSP, cf. `email-body.ts`). En 4c la citation est réinjectée
> dans le `RteEditor`, un `contentEditable` du **DOM de l'application** (origine
> réelle, sans iframe ni CSP `default-src 'none'`). `buildReplyContext` **doit** donc
> faire passer ce HTML par `sanitizeComposeHtml` avant de produire `quotedHtml`.
> Règle générale : **tout** HTML entrant dans le `RteEditor` (citation, collage) est
> sanitisé à l'injection (client), et le corps est **re-sanitisé à l'envoi** (serveur)
> — double barrière.

**`sanitizeComposeHtml` — exigences (B2)** :

- **Mécanisme** : parseur **DOM réel à allowlist** (type DOMPurify / sanitize-html),
  **pas** de regex (cf. `email-body.ts` qui se déclare lui-même best-effort non
  primaire). Exécuté **côté serveur** comme barrière autoritaire (R3) ; appliqué
  aussi côté client à l'injection de citation (B1).
- **Éléments autorisés** : `b, i, strong, em, a, ul, ol, li, p, br`.
- **Attributs** : allowlist stricte — **uniquement `href` sur `a`**. Interdits
  explicites : `style`, `class`, `id`, `data-*`, `on*`, et tout autre attribut.
- **Schéma d'URL `href`** : après **décodage des entités et retrait des
  caractères de contrôle/espaces**, n'autoriser que `^(https?|mailto):`. Rejeter
  `javascript:`, `data:`, `vbscript:`, schémas relatifs douteux.
- **`mailto:`** : retirer la query-string (`?...`) pour empêcher l'injection
  d'en-têtes (`mailto:x@y?bcc=...&body=...`).
- Retrait des commentaires (y compris conditionnels) et de tout nœud hors allowlist.

## 5. Server function

`sendMail` — `createServerFn({ method: 'POST' })`, entrée **validée par Zod** :

```ts
{
  mode: 'compose' | 'reply' | 'replyAll' | 'forward',  // enum fermé
  to:  MailAddress[],                 // email validé + name sans CR/LF/NUL
  cc:  MailAddress[],
  bcc: MailAddress[],
  subject: string,                    // ≤ 998 octets, sans CR/LF/NUL
  html: string,                       // ≤ 256 Ko ; sanitisé côté serveur
  inReplyTo?: string,                 // Message-ID validé (<...@...>)
  references?: string[],              // Message-ID validés, ≤ 50 entrées
}
```

> Le client **ne transmet ni `from` ni `identityId`** (R1) : l'expéditeur est dérivé
> côté serveur de `Identity/get` (cf. §6). Aucune opération JMAP générique n'est
> exposée : seul l'enum `mode` et des champs validés transitent.

**Contraintes de validation (B3, B4)** :

- **Anti-CRLF** : `subject` et chaque `name` d'adresse rejettent `\r`, `\n`, `\x00`
  (`/^[^\r\n\x00]*$/`).
- **Bornes** : `subject` ≤ 998 octets ; `html` ≤ 256 Ko (cohérent avec
  `maxBodyValueBytes` du reader) ; `references` ≤ 50 entrées.
- **Cardinalité destinataires** : `to + cc + bcc` ≤ **100** au total.
- **Message-ID** : `inReplyTo` / `references` ne sont pas du texte libre — format
  Message-ID validé, passés via `header:In-Reply-To:asMessageIds` /
  `header:References:asMessageIds` (cf. note §3.2), jamais concaténés bruts.

Flux :

1. `requireSession` (sid + accountId) ; sur session expirée → `redirect('/login')`.
2. **Rate-limit d'envoi par session/compte (B4)** — réutilise le pattern
   `login-rate-limit.ts` ; dépassement → erreur générique i18n.
3. `withFreshAccessToken`.
4. Batch lecture : `Mailbox/get` (résolution `drafts`/`sent` par role) + `Identity/get`.
5. `sanitizeComposeHtml(html)` + `htmlToPlainText(...)`.
6. `buildSendMethodCalls(...)`.
7. `jmapUserCall(..., capabilities incluant submission)`.
8. `parseSendResult(...)` → succès (id message envoyé) ou erreur typée.

## 6. Sécurité

> Audit dédié : `docs/superpowers/reviews/2026-06-21-plan-4c-security-review.md`
> (findings B1–B4 bloquants, R1–R6 recommandations). 4c franchit pour la première
> fois la frontière « HTML hostile hors de l'iframe sandbox » qui protégeait 4a/4b.

- **Sanitisation HTML autoritaire côté serveur (B2)** : tout HTML du `RteEditor` est
  non fiable. `sanitizeComposeHtml` (parseur DOM à allowlist, **pas** de regex)
  s'exécute côté serveur avant tout `Email/set`, et côté client à l'injection de
  citation. Allowlist d'éléments + d'attributs (`href` sur `a` uniquement) et schéma
  d'URL restreints (cf. §4).
- **Citation reply/forward (B1)** : le `htmlBody` d'origine (non fiable) passe par
  `sanitizeComposeHtml` **avant** d'entrer dans le `contentEditable` ; il n'est jamais
  injecté brut dans le DOM de l'app.
- **Injection d'en-têtes / CRLF (B3)** : `subject`, display-names, `inReplyTo`,
  `references` rejettent CR/LF/NUL (Zod) ; les Message-ID passent par
  `header:*:asMessageIds`, jamais concaténés.
- **Anti-abus (B4)** : rate-limit d'envoi par session/compte (pattern
  `login-rate-limit.ts`), `to+cc+bcc` ≤ 100, `html` ≤ 256 Ko.
- **Non-usurpation d'expéditeur (R1)** : `from` / `mailFrom` proviennent
  **exclusivement** de `Identity/get` sur l'`accountId` de **session** ; le client ne
  transmet ni `from` ni `identityId`. La sélection d'identité est contrainte aux
  identités du compte de session.
- **`bcc` jamais livré en en-tête (R2)** : mécanisme explicite — `bcc` est placé
  **uniquement** dans `envelope.rcptTo`, **pas** dans les propriétés de l'`Email`
  stocké/livré (le `Bcc` ne doit apparaître ni dans le message reçu ni dans le Sent).
  Un test dédié vérifie son absence (cf. §9).
- **Validation des adresses** : `to`/`cc`/`bcc` validées par Zod (format email) avant
  envoi ; enum `mode` fermé, pas de méthode JMAP arbitraire pilotable par le client.
- **Dépendance sanitiseur (R3)** : composant DOM maintenu, versionné, soumis au scan
  (`bun audit`), exécuté server-side.
- Cohérent avec la revue 4b (F1–F8) : aucun secret/token côté client, contenu non
  fiable isolé, entrées validées.

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
| Rate-limit dépassé | Toast d'erreur générique i18n |
| Session expirée | `redirect('/login')` (pattern existant) |

**Pas de fuite d'info dans les erreurs (R6)** : `parseSendResult` mappe les
`SetError`/`notCreated`/erreurs SMTP de Stalwart vers des **libellés i18n fixes**
(adresse refusée / quota / échec générique). Les `description`/`detail` JMAP/SMTP
restent côté logs serveur (`console.error`), jamais propagés au toast client — comme
le pattern générique de `mail-actions.ts` (F8 de la 4b).

## 9. Tests

- **Pures** : `parseAddressList` (dont rejet CR/LF/NUL dans le name — B3),
  `buildReplyContext` (3 modes **+ citation sanitisée** — B1), `sanitizeComposeHtml`
  (vecteurs XSS : `script`, `on*`, `javascript:`, `data:`, `style`, attributs hors
  allowlist, `mailto:?bcc=` — B2), `htmlToPlainText`, préfixe `Re:`/`Fwd:`,
  `buildSendMethodCalls` (dont **`bcc` absent des en-têtes / propriétés Email** — R2 ;
  Message-ID via `header:*:asMessageIds` — B3), `parseSendResult` (succès,
  `notCreated`, **erreurs mappées en libellés i18n sans détail JMAP** — R6).
- **Validation** : schéma Zod `sendMail` (CRLF rejeté, bornes taille/cardinalité — B3/B4).
- **Composants** : `RteEditor`, `Composer` (présentationnel), quick-reply du Reader.
- **Intégration** : `useComposer` / mutation `sendMail` (sur le modèle du test
  `useThreadActions` de la 4b).

## 10. Références

- **Audit sécurité 4c** (findings B1–B4, R1–R6) : `docs/superpowers/reviews/2026-06-21-plan-4c-security-review.md`
- Plan 4b — Reader & Actions (design) : `docs/superpowers/specs/2026-06-15-plan-4b-reader-actions-design.md` (§11 hors scope → 4c)
- Revue sécurité 4b : `docs/superpowers/reviews/2026-06-15-plan-4b-security-review.md`
- Design global : `docs/superpowers/specs/2026-06-08-stalmail-design.md` (§6 envoi, §7 JMAP)
- Capture API Stalwart : `docs/superpowers/specs/2026-06-09-stalwart-api-capture.md` (capabilities `submission`, scopes)
- Maquette : `webmail.zip` → `project/mail-views.jsx` (`Composer`, `Reader` quick-reply, `MessageItem`)
- RFC 8621 (JMAP Mail) §4 (`Email/get`, `Email/set`), §7 (`EmailSubmission`) ; RFC 8620 (`Identity`)
