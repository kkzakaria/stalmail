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

## 2. Revue CodeRabbit CLI

`coderabbit review --base main --type committed` — 2 findings.

| # | Sévérité | Emplacement | Statut |
|---|----------|-------------|--------|
| 1 | Critical | `thread-list.tsx:77` | ✅ Corrigé (`d2911e2`) |
| 2 | Major | `email-body.ts:5` | ❌ Rejeté (faux positif) |

**#1 — Garde `selectedId`** : `selected={threadAt(i)?.id === selectedId}` valait `true` quand les deux étaient `undefined` (pas de sélection + ligne skeleton). Bénin en pratique (le skeleton de `ThreadRow` sort tôt et n'applique pas `.sel`, et une ligne chargée a un `id` string ≠ undefined), mais garde ajoutée par robustesse/anti-régression : `selectedId != null && …`.

**#2 — Export de `FRAME_CSP`** : faux positif. `FRAME_CSP` n'est consommé que dans `email-body.ts` (encapsulé par `buildFrameDoc`) ; `message-item.tsx` appelle `buildFrameDoc`, pas `FRAME_CSP`. L'exporter exposerait inutilement un détail interne — conservé privé.

---

## Conclusion

Phase 4b validée pour merge. Sécurité : RAS. CodeRabbit : 1 correctif appliqué, 1 faux positif rejeté.

Reste différé : issue **#37** (configurer `defaultFolders` Stalwart pour provisionner le dossier Archive nativement) — l'action Archiver échoue tant que le compte n'a pas de dossier role `archive`.
