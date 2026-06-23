# Authentification du bootstrap du wizard — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Authentifier le premier accès au wizard de setup via un jeton dédié jetable (fragment d'URL) → cookie de session setup, et garder toutes les server functions mutatrices de setup derrière ce cookie. Fermer la prise de contrôle sur instance fraîche exposée (A01/A04).

**Architecture:** Jeton de setup généré par `install.sh` (clair dans l'URL `#token=…`, **hash** seul dans `.env`/env app). `unlockSetupFn` vérifie en temps constant et pose un cookie chiffré-authentifié (réutilise `session-crypto`/`session-cookie`). `requireSetupAuth()` + `assertSameOrigin()` + `requireStep()` gardent les fns mutatrices. UI : déverrouillage auto depuis `location.hash` + `replaceState`, jeton gardé en mémoire pour reprise transparente.

**Tech Stack:** TanStack Start server fns, React 19, Vitest, Node crypto (`createHash`, `timingSafeEqual`, `randomBytes`), `@tanstack/react-start/server` (cookies/headers).

## Global Constraints

- **Spec :** `docs/superpowers/specs/2026-06-23-bootstrap-auth-design.md` (source de vérité).
- **Jeton** : CSPRNG ≥128 bits, **distinct** de `STALMAIL_SECRET`. Serveur ne détient que `STALMAIL_SETUP_TOKEN_HASH` (SHA-256). Vérif `timingSafeEqual(sha256(présenté), hash)`.
- **Invalidation** : `unlockSetupFn` refuse si `isSetupComplete()`. Jeton valide jusqu'à `finishSetup`.
- **Cookie** : `__Host-stalmail_setup` (prod) / `stalmail_setup` (dev), `httpOnly`/`secure`/`sameSite:lax`/`path:/`, valeur = `encryptToken(timestamp, 'stalmail-setup')`, **TTL 1 h glissant** (réémis à chaque action mutatrice réussie).
- **Gate mutatrices** (`requireSetupAuth`+`assertSameOrigin`+`requireStep`) : `submitBootstrapFn`, `createDnsServerFn`, `setDnsManagementFn`, `setDnsManagementManualFn`, `configureAcmeFn`, `markSslConfiguredFn`, `createAdminAccountFn`, `finishSetupFn`. **Lecture seule non gardée par requireSetupAuth** : `getStep`, `setupStatusFn`, `setupAuthStatusFn`, `dnsGridStatusFn`, `acmeStatusFn`.
- **Rate-limit** par `clientIp()` + back-off + **log de sécurité** ; **réponses génériques** (`SETUP-UNLOCK-FAILED` indistinct entre jeton faux / déjà-configuré / rate-limité).
- **Fragment-only** : JS lit `location.hash`, POST same-origin, `history.replaceState` pour nettoyer l'URL ; jeton **jamais** en query ni en log ; gardé **en mémoire** (onglet) pour reprise.
- **R6** : aucune fuite de détail interne ; erreurs via codes opaques.
- **i18n** : clés `t('...')` fr/en, parité.
- **Tests** : fonctions pures isolées, composants présentationnels (props injectées). Pre-commit (`lint && typecheck && test`) jamais contourné ; chaque commit vert.

---

## Task 1 : Codes d'erreur `SETUP-UNAUTHENTICATED` + `SETUP-UNLOCK-FAILED`

**Files:** Modify `src/server/setup-errors.ts`, `src/server/setup-errors.test.ts`, `src/i18n/resources.ts`, `src/components/setup/error-code.ts`, `src/components/setup/error-code.test.ts`.

**Interfaces:** Produces les 2 codes dans `SETUP_CODES` + `KNOWN_CODES` + clés i18n `wizard.error.codes.SETUP-UNAUTHENTICATED`/`SETUP-UNLOCK-FAILED`.

- [ ] **Step 1 :** Test — `SETUP_CODES` contient les 2 codes ; `messageKeyForCode('SETUP-UNLOCK-FAILED')` → `'wizard.error.codes.SETUP-UNLOCK-FAILED'` (pas le générique).
- [ ] **Step 2 :** Lancer → échoue.
- [ ] **Step 3 :** Ajouter les 2 codes à `SETUP_CODES` (setup-errors.ts) et à `KNOWN_CODES` (error-code.ts) ; messages génériques fr/en (`SETUP-UNAUTHENTICATED` fr: « Authentification de setup requise. » ; `SETUP-UNLOCK-FAILED` fr: « Lien de setup invalide ou expiré. »), parité.
- [ ] **Step 4 :** Tests verts (`bun run test src/server/setup-errors.test.ts src/components/setup/error-code.test.ts`).
- [ ] **Step 5 :** Commit `feat(setup): codes d'erreur auth bootstrap`.

---

## Task 2 : `setup-auth.ts` — cookie, vérif jeton, rate-limit

**Files:** Create `src/server/setup-auth.ts`, `src/server/setup-auth.test.ts`.

**Interfaces:**
- Consumes: `encryptToken`/`decryptToken` (`session-crypto`), `getCookie`/`setCookie`/`deleteCookie`/`getRequestHeader` (via un module cookie dédié calqué sur `session-cookie.ts`), `clientIp` (`session-cookie`), `isSetupComplete` (`setup-flag`), `SetupError` (`setup-errors`).
- Produces:
  - `issueSetupCookie(): void` (pose le cookie chiffré horodaté, TTL 1 h, attrs `__Host-`/httpOnly/secure/lax).
  - `isSetupAuthed(): boolean` (lit+déchiffre+contrôle d'âge ≤ 1 h).
  - `requireSetupAuth(): void` (throw `SetupError('SETUP-UNAUTHENTICATED')` si non authed).
  - `clearSetupCookie(): void`.
  - `unlockSetup(token: string): void` — `assertSameOrigin()` ; rate-limit par `clientIp()` ; refuse si `isSetupComplete()` ; `timingSafeEqual(sha256(token), envHash)` ; succès → `issueSetupCookie()` ; échec/refus → `SetupError('SETUP-UNLOCK-FAILED')` (générique, après consommation du rate-limit) ; log de sécurité.

- [ ] **Step 1 :** Tests (mock `session-crypto`, env, `clientIp`, `isSetupComplete`) :
  - `issueSetupCookie` puis `isSetupAuthed()===true` ; cookie expiré (>1 h, horodatage forcé) → `false` ; cookie absent/corrompu → `false`.
  - `requireSetupAuth` throw `SETUP-UNAUTHENTICATED` sans cookie, ne throw pas avec.
  - `unlockSetup` : bon jeton (sha256==hash) → pose cookie ; mauvais jeton → `SETUP-UNLOCK-FAILED` ; `isSetupComplete()===true` → `SETUP-UNLOCK-FAILED` (générique, pas d'oracle) ; comparaison temps-constant (assert via `timingSafeEqual` utilisé) ; au-delà du seuil rate-limit → `SETUP-UNLOCK-FAILED`.
- [ ] **Step 2 :** Lancer → échoue.
- [ ] **Step 3 :** Implémenter. Cookie : nom `__Host-stalmail_setup`/`stalmail_setup` selon `NODE_ENV` (comme `session-cookie.cookieName`). Valeur `encryptToken(String(<timestamp>), 'stalmail-setup')` ; vérif = `decryptToken` (catch→false) + âge ≤ `3600_000`. Hash env lu via `process.env.STALMAIL_SETUP_TOKEN_HASH`. `sha256 = createHash('sha256').update(token).digest()` comparé en `timingSafeEqual` au buffer du hash env (hex→Buffer ; gérer longueurs égales). Rate-limit : petit module/registre en mémoire par IP (réutiliser le pattern `send-rate-limit.ts` : fenêtre + max), clé `clientIp() ?? 'unknown'`. Log : `console.warn('[setup-auth] unlock attempt', {...})` sans le jeton.
- [ ] **Step 4 :** Tests verts (`bun run test src/server/setup-auth.test.ts`).
- [ ] **Step 5 :** Commit `feat(setup): setup-auth (cookie, vérif jeton hash, rate-limit)`.

---

## Task 3 : Server fns `unlockSetupFn`/`setupAuthStatusFn` + gardes sur les mutatrices

**Files:** Modify `src/server/setup-actions.ts`, `src/server/setup-actions.test.ts`.

**Interfaces:**
- Produces: `unlockSetupFn` (POST, validator `{ token: z.string().min(1).max(512) }`) → `unlockSetup(data.token)` → `{ ok: true }` ; `setupAuthStatusFn` (GET) → `{ authed: isSetupAuthed() }`.
- Modifie: chaque handler mutateur appelle, **avant `requireStep`**, `assertSameOrigin()` puis `requireSetupAuth()` (lazy `await import('./setup-auth')`). À chaque **succès** d'action mutatrice, réémettre le cookie (`issueSetupCookie()`) pour le TTL glissant.

- [ ] **Step 1 :** Tests (mock `setup-auth` : `requireSetupAuth`, `isSetupAuthed`, `unlockSetup`, `issueSetupCookie`) :
  - chaque fn mutatrice throw `SETUP-UNAUTHENTICATED` quand `requireSetupAuth` throw ; passe quand il ne throw pas (et `issueSetupCookie` appelé au succès) ;
  - `unlockSetupFn` appelle `unlockSetup(token)` ; `setupAuthStatusFn` renvoie `{authed}` reflétant `isSetupAuthed`.
- [ ] **Step 2 :** Lancer → échoue.
- [ ] **Step 3 :** Implémenter. Placer `assertSameOrigin()`+`requireSetupAuth()` en tête (hors du try de mapping, comme `requireStep`). Réémettre le cookie après l'action réussie. Ordre dans chaque handler : `assertSameOrigin()` → `requireSetupAuth()` → `requireStep(<étape>)` → action → `issueSetupCookie()`.
- [ ] **Step 4 :** Tests verts (`bun run test src/server/setup-actions.test.ts`) + full suite.
- [ ] **Step 5 :** Commit `feat(setup): garde requireSetupAuth sur les fns mutatrices + unlock/status`.

---

## Task 4 : UI — déverrouillage auto + reprise + câblage route

**Files:** Modify `src/components/setup/SetupWizard.tsx`, `src/components/setup/SetupWizard.test.tsx`, `src/routes/setup/index.tsx`, `src/i18n/resources.ts` (+ libellés écran « lien requis »/« expiré »). Éventuel `src/components/setup/UnlockGate.tsx` (présentationnel) + test.

**Interfaces:**
- Consumes: `unlockSetupFn`, `setupAuthStatusFn` (props injectées dans SetupWizard, câblées par la route).
- Produces: au montage, lecture de `location.hash` (`#token=…`), conservation **en mémoire** (ref), appel `unlock(token)`, `history.replaceState` pour nettoyer l'URL ; interrogation `authStatus()` ; rendu : authed → flux existant ; non authed + jeton en mémoire → spinner « Déverrouillage… » ; non authed sans jeton → écran « Lien de setup requis » (pas de champ secret) ; sur `SETUP-UNAUTHENTICATED` d'une action → re-unlock mémoire puis rejouer, sinon « Session expirée — rouvre le lien ».

- [ ] **Step 1 :** Tests (props mockées, I18nextProvider) :
  - `location.hash='#token=abc'` → `unlock` appelé avec `abc` + `history.replaceState` appelé (mock) ;
  - `authed=false` sans jeton → écran « lien requis » (pas de Welcome) ;
  - `authed=true` → flux normal (Welcome) ;
  - une action renvoyant `SETUP-UNAUTHENTICATED` avec jeton en mémoire → re-`unlock` puis avance ; sans jeton → écran « expiré ».
- [ ] **Step 2 :** Lancer → échoue.
- [ ] **Step 3 :** Implémenter (garder le build vert : la route passe `unlock`/`authStatus`). Lire `window.location.hash` côté client (guard SSR). Jeton en `useRef` ; `replaceState(null,'',location.pathname)`.
- [ ] **Step 4 :** Tests verts (`bun run test src/components/setup/SetupWizard.test.tsx`) + full suite.
- [ ] **Step 5 :** Commit `feat(setup): UI déverrouillage auto par jeton (fragment) + reprise`.

---

## Task 5 : `install.sh` + `compose.prod.yml` + `.env.example` + runbook

**Files:** Modify `install.sh`, `compose.prod.yml`, `.env.example`, `docs/superpowers/plans/2026-06-22-validation-reelle-socle.md`.

**Interfaces:** `install.sh` génère le jeton, écrit `STALMAIL_SETUP_TOKEN_HASH` dans `.env`, imprime l'URL `…/setup#token=<jeton>` ; compose passe `STALMAIL_SETUP_TOKEN_HASH` à `app`.

- [ ] **Step 1 :** Modifier `install.sh` (bloc `.env`) : `TOKEN=$(openssl rand -hex 24)` (ou fallback urandom **safe pipefail**) ; `HASH=$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')` ; écrire `STALMAIL_SETUP_TOKEN_HASH=${HASH}` dans `.env` (jamais le clair). Dans l'encadré final, imprimer `https://${IP}/setup#token=${TOKEN}`. Ne stocker le clair nulle part.
- [ ] **Step 2 :** `compose.prod.yml` : ajouter `STALMAIL_SETUP_TOKEN_HASH: "${STALMAIL_SETUP_TOKEN_HASH:?...}"` à l'env du service `app`.
- [ ] **Step 3 :** `.env.example` : documenter `STALMAIL_SETUP_TOKEN_HASH`.
- [ ] **Step 4 :** Runbook Phase 2.1 : ouvrir l'URL avec `#token` (au lieu de `/setup` nu) ; noter la régénération en cas de perte.
- [ ] **Step 5 :** Vérifier `bash -n install.sh` + un test ciblé de génération (jeton≠hash, hash = sha256(jeton)) sous `set -euo pipefail`. Commit `feat(ops): install.sh génère le jeton de setup (hash en .env, URL imprimée)`.

---

## Task 6 : Nettoyage + revue sécurité

- [ ] **Step 1 :** `grep` cohérence : tous les handlers mutateurs ont `requireSetupAuth` ; les lecture-seule ne l'ont pas.
- [ ] **Step 2 :** `bun run lint && bun run typecheck && bun run test` verts ; `bun run format` (périmètre).
- [ ] **Step 3 :** Revue `security-reviewer` du diff (gate complet, temps-constant, hash-only, fragment/replaceState, rate-limit+log, réponses génériques, cookie). Corriger les findings.
- [ ] **Step 4 :** Commit final si correctifs.

---

## Self-Review (couverture spec)

- Spec §3 (jeton dédié, fragment, hash-only) → Tasks 2, 4, 5. ✅
- Spec §4 (cycle de vie / expiration / reprise) → Task 2 (cookie TTL/âge), Task 3 (réémission glissante), Task 4 (reprise mémoire/réouverture). ✅
- Spec §5 (8 conditions) → Task 2 (CSPRNG/hash/temps-constant/rate-limit/log/cookie), Task 4 (fragment/replaceState), Task 5 (génération). ✅
- Spec §6 (gate mutatrices, lecture seule non gardée) → Task 3. ✅
- Spec §7 (codes) → Task 1. ✅
- Spec §8 (UI sans écran) → Task 4. ✅
- Spec §9 (déploiement) → Task 5. ✅
- Spec §11 tests → chaque tâche TDD. ✅
- Spec §12 revue sécurité → Task 6. ✅

**Type consistency :** `requireSetupAuth`/`issueSetupCookie`/`isSetupAuthed`/`unlockSetup` (Task 2) consommés en Task 3 ; `unlockSetupFn`/`setupAuthStatusFn` (Task 3) câblés en Task 4 ; codes (Task 1) utilisés partout ; `STALMAIL_SETUP_TOKEN_HASH` (Task 5) lu par Task 2.
