# Revue finale — Plan 4b (Reader & Actions)

**Date** : 2026-06-16
**Branche** : `feat/plan-4b-reader-actions` → `main` (PR #36)
**Périmètre** : `git diff origin/main...HEAD` (hors `docs/`).

Deux revues complémentaires, conformément au cycle projet : audit sécurité (agent OWASP, skill `owasp-security`) + CodeRabbit CLI.

---

## 1. Revue sécurité (OWASP Top 10 2021)

**Verdict : ✅ OK pour merge. Aucun point bloquant ni non-bloquant.**

Fichiers audités : `mail-actions.ts`, `email-body.ts`, `message-item.tsx`, `use-thread-actions.ts`, `$folder.tsx`, `reader.tsx`, `mail-types.ts`, `jmap-user.ts`.

Couverture :

- **A01 Broken Access Control / IDOR** — `accountId` toujours résolu serveur via `requireSession()`, jamais piloté par le client (qui ne transmet que `threadId`/`emailIds`/`folder`/`to`). Autorisation appliquée par Stalwart via le token utilisateur (`jmapUserCall` → `withFreshAccessToken`).
- **A02 Cryptographic Failures** — aucun token/`sid`/secret ne franchit vers le client ; absent des types `App*`, des props et des messages d'erreur.
- **A03 Injection / XSS** — HTML d'email rendu uniquement en `<iframe srcDoc>` sandboxé **sans `allow-scripts`/`allow-same-origin`/`allow-forms`** + CSP `default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'`. Aucun `dangerouslySetInnerHTML`. `subject`/`from`/`to`/`cc` issus de l'email hostile rendus en texte React auto-échappé. Enums fermés (`MoveTarget`, `MailFlag`), cible role→id résolue serveur.
- **A04 Insecure Design** — BFF strict ; `buildMovePatch` = patch ciblé préservant les labels (role===null) ; invariant read-only de `readThreadFn` respecté (aucun `Email/set`).
- **A05 Security Misconfiguration** — `<base>` de l'email strippé avant injection de notre `<base target="_blank">` (anti détournement de liens relatifs) ; `maxBodyValueBytes: 256000` (anti-DoS mémoire).
- **A07 Auth Failures** — `requireAuth()` en `beforeLoad` ; chaque server function `requireSession()` → `redirect('/login')` ; `isRedirect(e)` re-throw dans tous les `catch`.
- **A08 Data Integrity** — toutes les entrées validées par Zod (bornes + enums) : `readThreadSchema` (≤64), `setFlagsSchema` (emailIds 1..500, id ≤64), `moveSchema`, `emailListSchema` (limit ≤200) ; borne `?thread` ≤64 re-validée serveur.
- **A09 Logging Failures** — erreurs JMAP loggées serveur, renvoyées génériques au client (`mail action failed` / `t("mail.actions.error")`), pas de fuite de détail JMAP.
- **A10 SSRF** — aucun proxy d'image ni fetch d'URL contrôlée ; images distantes bloquées navigateur par la CSP.

**Relâchement sandbox pour liens externes** (`allow-popups allow-popups-to-escape-sandbox`) : justifié et non exploitable — sans `allow-scripts` aucun popup auto, `rel="noopener noreferrer"` forcé coupe `window.opener`, le contexte échappé est nécessaire pour que l'onglet externe ne soit pas opaque/cassé.

**Observations mineures (déjà neutralisées, aucune action)** :
- 🔵 Sanitizers regex (`blockRemoteImages`/`sanitizeLinks`) best-effort, contournables — mais la barrière réelle (sandbox sans scripts + CSP) rend cela non exploitable. Documenté dans le code.
- 🔵 `style-src 'unsafe-inline'` — exfiltration CSS théorique neutralisée par `img-src data: cid:` + `default-src 'none'`. Acceptable pour un rendu fidèle d'email.

---

## 2. Revue CodeRabbit

### 2a. CLI (`coderabbit review --base main --type committed`) — 2 findings

| # | Sévérité | Emplacement | Statut |
|---|----------|-------------|--------|
| C1 | Critical | `thread-list.tsx:77` | ✅ Corrigé (`d2911e2`) |
| C2 | Major | `email-body.ts:5` | ❌ Rejeté (faux positif) |

**C1 — Garde `selectedId`** : `selected={threadAt(i)?.id === selectedId}` valait `true` quand les deux étaient `undefined` (pas de sélection + ligne skeleton). Bénin en pratique (le skeleton de `ThreadRow` sort tôt et n'applique pas `.sel`, et une ligne chargée a un `id` string ≠ undefined), mais garde ajoutée par robustesse/anti-régression : `selectedId != null && …`.

**C2 — Export de `FRAME_CSP`** : faux positif. `FRAME_CSP` n'est consommé que dans `email-body.ts` (encapsulé par `buildFrameDoc`) ; `message-item.tsx` appelle `buildFrameDoc`, pas `FRAME_CSP`. Conservé privé.

### 2b. Bot GitHub (PR #36) — 5 findings sur le code

Récupérés via `gh api`. Triagés contre le code courant.

| # | Sévérité | Emplacement | Statut |
|---|----------|-------------|--------|
| 1 | Major | `email-body.ts` — CSP bloque les images même après « Afficher les images » | ✅ Corrigé (`736dc7b~1`) |
| 2 | Minor | `mail.css` — bandeau ne wrap pas sur mobile | ✅ Corrigé |
| 3 | Major | `reader.tsx` — boutons icônes sans `aria-label` | ✅ Corrigé |
| 4 | Major | `use-thread-actions.ts` — rollback écrase une maj concurrente | ↪️ Différé → issue #38 |
| 5 | Major | `$folder.tsx` — `MailPage` utilise `useNavigate` | ✅ Corrigé (`736dc7b`) |

**#1** était un **vrai bug fonctionnel** : la CSP figée `img-src data: cid:` bloquait les images distantes côté navigateur même quand l'utilisateur cliquait « Afficher les images ». CSP désormais élargie à `https: http:` quand `showImages=true` (toujours sans `allow-scripts`). **#5** sort `useNavigate` de `MailPage` (navigation injectée via prop `onOpenThread` depuis `RouteComponent`). **#4** (cas limite double-action + échec serveur) différé en issue #38.

Les 3 autres commentaires du bot portaient sur le **doc de plan** (noms de fonctions, contrat `ThreadList`, cleanup toast) — obsolètes, déjà alignés dans le code final.

### 2c. Bot GitHub — re-revue incrémentale (après corrections) — 1 finding

Revue auto-suspendue par CodeRabbit (`auto_pause_after_reviewed_commits`, afflux de commits) puis redéclenchée via `@coderabbitai review`.

| # | Sévérité | Emplacement | Statut |
|---|----------|-------------|--------|
| 6 | Major | `email-body.ts` — `sanitizeLinks` | ✅ Corrigé (`cc66887`) |

**#6** : une ancre `<a target="_self">` d'un email outrepassait le `<base target="_blank">` injecté et rouvrait le lien **dans l'iframe du reader**. `sanitizeLinks` strippe désormais les `target`/`rel` fournis par l'email (quotés et non quotés) et force `target="_blank" rel="noopener noreferrer"`. Complément du strip de `<base>` (#1 de la passe sécurité). Préfixe `\s` conservé (épargne `data-*`).

---

## Conclusion

Phase 4b validée pour merge. Sécurité : RAS. CodeRabbit : 5 correctifs appliqués (dont le bug fonctionnel « Afficher les images »), 1 faux positif rejeté, 1 cas limite différé.

Restes différés :
- Issue **#37** — configurer `defaultFolders` Stalwart pour provisionner le dossier Archive nativement (l'action Archiver échoue tant que le compte n'a pas de mailbox role `archive`).
- Issue **#38** — rollback optimiste ciblé pour éviter l'écrasement entre actions concurrentes.
