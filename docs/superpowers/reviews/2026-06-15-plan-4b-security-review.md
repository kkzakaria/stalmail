# Plan 4b — Revue de sécurité du design (Reader & Actions)

**Date :** 2026-06-15
**Cible :** `docs/superpowers/specs/2026-06-15-plan-4b-reader-actions-design.md`
**Méthode :** subagent `security-reviewer` ancré OWASP Top 10 (skill `owasp-security`), recoupé avec le code existant (`mail-actions.ts`, `jmap-user.ts`, `session-cookie.ts`).
**Verdict initial :** architecture solide (BFF, Zod, role→id serveur, accountId de session, texte-d'abord), **1 décision à corriger** + points à expliciter avant le plan d'implémentation. **Tous les findings ont été intégrés au design** (révision du §2.7 et al.).

## Findings & résolutions

| # | Gravité | OWASP | Finding | Résolution dans le design |
|---|---|---|---|---|
| F1 | 🔴 | A03/A05 | §2.7 retenait `sandbox` avec `allow-same-origin` (pour mesurer la hauteur) → rétablit l'origine réelle, vecteurs non-script + combo de bypass du sandbox | §2.7 réécrit : **`sandbox=""` (origine opaque)**, `allow-same-origin` proscrit ; hauteur = **fixe + scroll interne** (décision verrouillée) |
| F2 | 🟡 | A05 | Aucune CSP ; le `srcdoc` pouvait charger CSS/fonts/`@import` distants malgré le blocage d'images | §2.7 : **`<meta CSP>` dans le `srcdoc`** `default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'` |
| F3 | 🟡 | A03 | `blockRemoteImages` présenté comme contrôle anti-XSS alors qu'il ne couvre ni CSS `url()`, ni forms, ni meta-refresh | §2.7 reformulé : `blockRemoteImages` = **anti-traceur (vie privée)** ; l'anti-XSS = sandbox + CSP (double barrière) |
| F4 | 🟡 | A03 | Politique de liens non spécifiée (tabnabbing, `javascript:`) | §2.7 : `sanitizeLinks` → `rel="noopener noreferrer"`, schémas `https:`/`mailto:` uniquement ; pas de `allow-popups`/`allow-top-navigation` |
| F5 | 🟡 | A04 | `readThreadFn` est un GET ; risque qu'une « simplification » y fasse muter `$seen` | §2.5 : **invariant read-only** explicité ; l'auto-read passe par `setFlagsFn` (POST) |
| F6 | 🔵 | A04 | `emailIds` borné en longueur mais pas en cardinalité (resource exhaustion) | §2.4/§5 : `z.array(...).min(1).max(500)` |
| F8 | 🔵 | A09 | Toasts d'erreur risquant d'exposer `JmapUserError.detail`/description | §9 : **libellés i18n fixes** ; détails JMAP confinés aux logs serveur |

## Notes (non bloquantes)

- **F7 / A10 SSRF** : RAS en 4b (pas de proxy d'image, téléchargement des pièces jointes hors-scope). À recadrer quand le download/blob arrivera : résoudre `blobId` via l'API blob authentifiée (accountId de session), jamais d'URL distante côté client.
- **Auto-read optimiste** : peut marquer lu un fil effleuré — décision produit déjà assumée (« comme la plupart des webmails »).

## Couverture OWASP

Examiné : A01 (RAS — accountId de session, role→id serveur), A02 (RAS — pas de token côté client), A03/A04/A05/A09 (corrigés ci-dessus), A06 (RAS — pas de dépendance ajoutée), A07 (RAS — `requireSession`, cookie `httpOnly`/`secure`/`sameSite=lax`), A08 (RAS — optimiste + rollback), A10 (RAS en 4b).

**Verdict après amendements :** design sûr à implémenter ; modèle de menace du lecteur verrouillé (§2.7).
