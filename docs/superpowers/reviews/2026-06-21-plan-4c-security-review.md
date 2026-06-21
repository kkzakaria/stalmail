# Plan 4c — Composer — Audit de sécurité (design)

> Audit réalisé sur le **design** (avant implémentation), 2026-06-21.
> Cible : `docs/superpowers/specs/2026-06-21-plan-4c-composer-design.md`.
> Référentiel : OWASP Top 10 (2021). Recoupé avec `src/server/mail-actions.ts`,
> `src/server/jmap-user.ts`, `src/components/mail/email-body.ts`,
> `src/server/session-cookie.ts`, `src/server/login-rate-limit.ts`, et la revue 4b
> (F1–F8).
>
> **Statut** : findings B1–B4 et R1–R6 **intégrés au spec 4c** (révision 2026-06-21).
> Ce document conserve l'analyse de risque détaillée pour le plan et la revue de code.

## Cadrage

C'est un design : les findings portent sur des **garanties manquantes ou
sous-spécifiées** à verrouiller avant le plan. **Bloquant** = à intégrer au spec avant
le plan ; **Recommandation** = durcissement. 4c franchit pour la première fois la
frontière « HTML hostile hors de l'iframe sandbox » qui protégeait 4a/4b.

## Bloquants

### B1 — Citation reply/forward réinjectée dans le `contentEditable` sans sanitisation
- **Emplacement** : §4 `buildReplyContext` (`quotedHtml`) + §7 `RteEditor` + §3.1.
- **OWASP** : A03 – Injection (XSS).
- **Gravité** : critique.
- **Vecteur** : en 4b le HTML hostile est neutralisé car rendu **uniquement** dans
  `<iframe sandbox="">` + CSP `default-src 'none'`. En 4c, `buildReplyContext` réinjecte
  le `htmlBody` d'origine (non fiable) dans le `RteEditor`, un `contentEditable` du DOM
  de l'app (origine réelle, sans iframe ni CSP). `<img src=x onerror=…>` /
  `<svg onload=…>` s'exécute à l'ouverture du « Répondre » → vol potentiel de session,
  actions JMAP authentifiées, exfiltration.
- **Correctif** : `buildReplyContext` fait passer le HTML d'origine par
  `sanitizeComposeHtml` avant de produire `quotedHtml`. Tout HTML entrant dans le
  RteEditor (citation, collage) est sanitisé à l'injection (client) ET le corps
  re-sanitisé à l'envoi (serveur) — double barrière.

### B2 — `sanitizeComposeHtml` est la seule barrière : durcir l'allowlist et imposer un parseur DOM
- **Emplacement** : §4 / §6, allowlist `b,i,strong,em,a[href],ul,ol,li,p,br`.
- **OWASP** : A03 – Injection (XSS) ; A08 – Data Integrity.
- **Gravité** : critique.
- **Vecteur** : le corps composé n'est jamais ré-isolé en iframe ; il est rendu par le
  destinataire (et re-rendu côté Sent). Une sanitisation regex (comme le best-effort de
  `email-body.ts`, qui se déclare non primaire) est contournable (mXSS, entités,
  attributs malformés). Points faibles : `mailto:?bcc=…` (injection d'en-têtes),
  absence d'allowlist d'attributs (`style`/`class`/`id`), schémas d'URL non normalisés
  (`java\tscript:`, `&#106;avascript:`).
- **Correctif** : parseur **DOM à allowlist** (DOMPurify / sanitize-html), pas de regex,
  server-side autoritaire. Allowlist d'attributs : `href` sur `a` seulement. URL :
  décodage + trim contrôles puis `^(https?|mailto):`. `mailto:` : strip de la query.

### B3 — Injection d'en-têtes (CRLF) via `subject`, Message-ID, display-names
- **Emplacement** : §3.2, §5 (Zod), §4 `parseAddressList`.
- **OWASP** : A03 – Injection (header injection / SMTP).
- **Gravité** : moyen.
- **Vecteur** : `subject` et display-names (`Nom <a@b>`) sont libres ; un `\r\n` peut
  injecter des en-têtes (`Bcc:`, `Content-Type`). Zod ne bornait ni longueur ni
  caractères de contrôle ; `references` non borné.
- **Correctif** : rejeter CR/LF/NUL sur `subject` et `name` ; bornes (`subject` ≤ 998
  octets) ; `references` ≤ 50 ; `inReplyTo`/`references` = Message-ID validés passés via
  `header:*:asMessageIds`, jamais concaténés.

### B4 — Anti-abus absent (rate-limit, taille corps, nb destinataires)
- **Emplacement** : §5, §6, §8.
- **OWASP** : A04 – Insecure Design ; A05 – Misconfiguration.
- **Gravité** : moyen.
- **Vecteur** : `sendMail` émet via SMTP. Sans bornes : spam sortant (réputation IP
  brûlée), `rcptTo` arbitraire, `html` énorme (DoS BFF au sanitize/`Email/set`).
- **Correctif** : `to+cc+bcc` ≤ 100 ; `html` ≤ 256 Ko ; rate-limit d'envoi par
  session/compte (réutiliser `login-rate-limit.ts`), erreur générique.

## Recommandations

### R1 — `from`/`mailFrom` : verrouiller la non-usurpation
Dériver `from`/`mailFrom` exclusivement de `Identity/get` sur l'`accountId` de session ;
le client ne transmet ni `from` ni `identityId`. Identités contraintes au compte de
session. (Le schéma §5 n'expose pas ces champs — à garder verrouillé.)

### R2 — `bcc` hors en-têtes : préciser le mécanisme + test
Placer `bcc` **uniquement** dans `envelope.rcptTo`, pas dans les propriétés de l'`Email`
stocké. Test dédié : absence de `Bcc` dans le message stocké/Sent.

### R3 — Dépendance de sanitisation à ajouter
`package.json` n'a aujourd'hui aucun sanitizer. Choisir un composant maintenu,
versionné, soumis au scan (`bun audit`), exécuté server-side.

### R4 — SSRF : RAS en 4c, à recadrer aux phases blob/images
Aucun fetch d'URL utilisateur côté serveur en 4c. Ne jamais laisser le BFF
déréférencer une URL client lors de l'arrivée des images inline / `Blob/upload`.

### R5 — Capability `submission` confinée
`jmapUserCall(sid, calls, capabilities?)`, défaut = `MAIL_CAPABILITIES` ; `submission`
ajouté **uniquement** par `sendMail`. Ne pas élargir le `using` des lectures.

### R6 — Pas de fuite d'info dans les erreurs d'envoi
`parseSendResult` mappe `SetError`/`notCreated`/erreurs SMTP vers des libellés i18n
fixes ; `description`/`detail` JMAP restent en logs serveur (pattern `mail-actions.ts`,
F8 de la 4b).

## Couverture OWASP

| Catégorie | Statut |
|---|---|
| A01 Broken Access Control | RAS sur IDOR (accountId session, role→id serveur, enum `mode`). R1 à verrouiller. |
| A02 Cryptographic Failures | RAS (aucun token/`sid` côté client ; cookie `__Host-`/HttpOnly/Secure/SameSite=lax). |
| A03 Injection (XSS + headers) | **B1, B2, B3.** |
| A04 Insecure Design | **B4** + R1, R2. |
| A05 Misconfiguration | R5 ; contribue à B4. |
| A06 Vulnerable Components | R3. |
| A07 Identification & Auth | RAS (`requireSession` + `withFreshAccessToken`, redirect `/login`). |
| A08 Data Integrity | Couvert via B2. |
| A09 Logging Failures | R6. |
| A10 SSRF | RAS en 4c (R4) ; recadrer aux phases blob/images. |

## Verdict (audit du spec)

**Avant le plan** : intégrer B1–B4 au design (fait — révision spec 2026-06-21). R1–R6
sont des durcissements (intégrés). B1 et B2 sont les plus sérieux : le composer franchit
pour la première fois la frontière « HTML hostile hors de l'iframe sandbox ».

---

# Plan — Audit du code d'implémentation

> Second passage, sur `docs/superpowers/plans/2026-06-21-plan-4c-composer.md` (code réel
> TDD). Vérifie que le code porte bien les garanties du spec et ne réintroduit pas de
> risque par ses choix concrets. **Statut** : P1, P2 + durcissements **intégrés au plan**
> (révision 2026-06-21).

## Bloquants (corrigés)

### P1 — Sanitisation du RteEditor à chaque frappe : curseur cassé → tentation de désactiver la barrière ; + import depuis `src/server` côté client
- **Emplacement** : Task 10 (`rte-editor.tsx`), Task 1 (`compose-html.ts`).
- **OWASP** : A04 – Insecure Design (robustesse de la barrière B1) ; A03.
- **Risque** : `onChange(sanitizeComposeHtml(innerHTML))` à chaque `onInput` + réinjection
  `el.innerHTML` font sauter le curseur (DOMPurify re-sérialise) → un implémenteur
  désactiverait la sanitisation, supprimant la défense B1 au collage. De plus le composant
  client importait depuis `src/server/` (frontière BFF).
- **Correctif intégré** : frappe = émet le HTML **brut** (serveur autoritaire B2) ;
  sanitisation uniquement au **collage** (`onPaste`) et à l'**injection de citation**
  (drapeau `lastInjected`, une seule fois). `compose-html.ts` déplacé dans **`src/lib/`**.

### P2 — `currentSession(sid)?.email` inexistant : clé de rate-limit vide → throttle global au lieu de par-compte
- **Emplacement** : Task 9 (`sendMailFn`).
- **OWASP** : A04 – Insecure Design (anti-abus B4).
- **Risque** : `currentSession` renvoie `{ accountId, accountName }` (vérifié, `session.ts:83`).
  `?.email` → `undefined` → clé `""` partagée par tous les comptes (DoS croisé / quota
  partagé). La « Décision » inline ne suffisait pas : le code écrit doit être déterministe.
- **Correctif intégré** : clé de rate-limit = **`accountId`** ; `pickSendIdentity(_, "")`
  (→ première identité du compte, scopée par `Identity/get`) ; suppression de
  `currentSession`/`accountEmail`.

## Recommandations (intégrées ou actées)

- **R-A** — `htmlToPlainText` ne sert que de corps `text/plain`, jamais d'en-tête (aucun
  vecteur d'injection) ; noté en commentaire.
- **R-B** — regex de `parseAddressList` resserrée (rejette `<>` dans le name et les
  adresses à doubles chevrons) + test ajouté.
- **R-C** — tests `mailto:` supplémentaires ; note sur le hook DOMPurify **global au
  process** (inoffensif aujourd'hui, `email-body.ts` n'utilise pas DOMPurify).
- **R-D** — R1 correctement implémenté : `from` et `mailFrom` dérivent tous deux de
  l'identité serveur. RAS.
- **R-E** — `parseSendResult` échoue **fermé** sur une erreur JMAP niveau méthode
  (`["error",…]`) : aucun faux succès. Test fail-closed ajouté.
- **R-F** — garde synchrone `useRef` anti-double-soumission dans `useComposer`.
- **R-G** — le serveur revalide intégralement (Zod) ; la confiance n'est pas côté client. RAS.
- **R-H** — rate-limit 30/h/compte, fenêtre glissante ; limite in-memory mono-process
  assumée (notée dans les limites connues du plan). `bun audit` ajouté en Task 1 (R3).

## Verdict (audit du plan)

Pas de XSS exécutable garanti dans le code proposé (B1/B2/B3 portés ; bcc hors en-tête ;
identité serveur ; fail-closed). Les deux pièges concrets — sanitisation couplée à la
frappe (P1) et clé de rate-limit fantôme (P2) — sont corrigés dans le plan avant écriture
du code.
