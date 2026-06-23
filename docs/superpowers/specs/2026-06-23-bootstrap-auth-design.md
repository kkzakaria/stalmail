# Authentification du bootstrap du wizard de setup

> Design validé en brainstorming le 2026-06-23, avec avis de l'agent sécurité (Option 1 durcie). Cycle : spec → plan → implémentation → revue (dont revue sécurité).

## 1. Contexte & menace

Sur une instance **fraîche exposée** sur Internet (`https://<ip>/setup`, cert auto-signé, pré-DNS, mode bootstrap), le **tout premier acteur** qui atteint l'instance peut piloter le setup — poser le domaine, **créer le compte admin (takeover)**, reconfigurer DNS/ACME — car rien n'authentifie ce premier acteur. Le durcissement déjà en place (`requireStep` côté serveur) bloque les appels **hors séquence** et **post-setup**, mais **pas la course du premier acteur** sur instance fraîche.

**Objectif** : prouver que l'appelant est **l'opérateur qui a déployé** (= a un accès shell/fichiers au serveur), avant toute action de setup.

Audit sécurité (OWASP) : faille **A01 Broken Access Control** + **A04 Insecure Design**. Option retenue après avis de l'agent sécurité : **Option 1 durcie** — jeton de setup **dédié, jetable**, transmis via le **fragment d'URL**, jamais le secret maître `STALMAIL_SECRET` (qui est aussi le recovery-admin Stalwart + la clé de chiffrement des sessions ; l'exposer violerait le moindre privilège).

## 2. Objectif & non-objectifs

**Objectif** : authentifier le premier accès au wizard via un jeton de setup dédié → cookie de session setup ; garder **toutes** les server functions mutatrices de setup derrière ce cookie (en plus de `requireStep` + `assertSameOrigin`).

**Non-objectifs** :
- Pas de restriction réseau (localhost/tunnel) — contredit l'accès wizard par IP depuis un navigateur distant.
- Pas de réutilisation de `STALMAIL_SECRET` comme secret de déverrouillage.
- Pas de changement du modèle de session **applicative** (login post-setup, `requireSession`) — inchangé.

## 3. Approche (Option 1 durcie)

`install.sh` génère un **jeton de setup** dédié et imprime l'URL `https://<ip>/setup#token=<JETON>`. L'opérateur ouvre cette URL ; le **JS client** lit le **fragment `#`** (jamais envoyé au serveur, ni logs ni `Referer`), le POST à `unlockSetupFn`, qui le vérifie et pose un **cookie de session setup** signé/chiffré. Toutes les fns mutatrices exigent ce cookie. **Aucun écran de saisie, aucun copier-coller.**

Le serveur ne connaît **que le hash** du jeton (le clair n'existe que dans l'URL côté opérateur et la sortie d'`install.sh`).

## 4. Cycle de vie & expiration (décision)

Deux artefacts :

- **Jeton de setup** (`STALMAIL_SETUP_TOKEN`, dans l'URL) : valable **jusqu'à l'achèvement du setup**. Pas d'expiration murale propre ; `unlockSetupFn` le **refuse dès que `isSetupComplete()`** est vrai. C'est le **filet de récupération durable**.
- **Cookie de session setup** : **TTL court** (1 h) **glissant** — réémis à chaque action de setup réussie → n'expire en pratique qu'après une **vraie inactivité**.

**Expiration du cookie avant la fin du setup** :
1. La prochaine action mutatrice échoue avec `SETUP-UNAUTHENTICATED`.
2. Le client **re-déverrouille de façon transparente** s'il détient encore le jeton **en mémoire JS** (cf. §8) ; sinon il affiche « Session de setup expirée — rouvre le lien de setup ».
3. L'opérateur **rouvre la même URL `…#token=…`** (jeton toujours valide) → nouveau cookie.
4. **Reprise exacte** : la progression est **côté serveur** (`deriveSetupStep` re-dérive l'étape ; DNS/SSL/Compte déjà faits conservés). **Aucune perte, aucun lockout.**

**Jeton/URL perdus** (cas rare) : régénération via une commande documentée (`docker compose exec` réimprimant le lien, ou rerun idempotent d'`install.sh`). Seul cas nécessitant un retour au serveur.

**Cohérence sécurité** : conforme à l'enveloppe de l'agent (condition 3, branche « invalider au plus tard au `finishSetup` »). La fenêtre d'exposition du jeton = la fenêtre de setup (de toute façon, après `finishSetup` : jeton mort + `/setup` redirige + `requireStep` bloque).

## 5. Conditions de durcissement (non négociables — agent sécurité)

1. **Génération** : `STALMAIL_SETUP_TOKEN` via CSPRNG ≥ 128 bits (`openssl rand`), **strictement distinct** de `STALMAIL_SECRET`.
2. **Côté serveur, seul le HASH** : `install.sh` écrit `STALMAIL_SETUP_TOKEN_HASH` (SHA-256 du jeton) dans `.env` (`chmod 600`) ; l'app **ne détient jamais le clair**. Vérification = `timingSafeEqual(sha256(présenté), hash_env)` (**temps constant**).
3. **Invalidation** : `unlockSetupFn` refuse si `isSetupComplete()`. (Jeton mort post-setup.)
4. **TTL court** sur le cookie (1 h, glissant).
5. **Rate-limit par IP** (`clientIp()`) + back-off sur `unlockSetupFn` ; **log d'événement de sécurité** (succès/échec, IP, UA) ; **réponses génériques** (ne pas distinguer jeton faux / setup déjà fait / rate-limité → même `SETUP-UNLOCK-FAILED`).
6. **Fragment-only** : le JS lit `location.hash`, POST same-origin (`assertSameOrigin`), puis **`history.replaceState`** pour effacer `#token` de l'URL. Jamais le jeton en query string ni en log.
7. **Cookie** `__Host-stalmail_setup` (prod) / `stalmail_setup` (dev), `httpOnly`, `secure`, `sameSite:lax`, `path:/`, valeur **chiffrée-authentifiée** via `encryptToken`/`decryptToken` (AES-GCM, clé `STALMAIL_SECRET`) avec timestamp pour le contrôle d'âge.
8. **Erreurs client génériques** (« lien de setup invalide ou expiré ») — aucun détail interne (R6).

## 6. Surface serveur (gate)

- **Fns mutatrices** (gardées par `requireSetupAuth()` **+** `assertSameOrigin()` **+** `requireStep()`) : `submitBootstrapFn`, `createDnsServerFn`, `setDnsManagementFn`, `setDnsManagementManualFn`, `configureAcmeFn`, `markSslConfiguredFn`, `createAdminAccountFn`, `finishSetupFn`.
- **Fns lecture seule NON gardées par `requireSetupAuth`** (nécessaires avant déverrouillage / pour poller) : `getStep`, `setupStatusFn`, `setupAuthStatusFn`, `dnsGridStatusFn`, `acmeStatusFn`. Elles ne fuient rien de sensible pré-déverrouillage (pas encore de domaine ; `dnsGridStatus` vide).
- **Nouvelles fns** :
  - `unlockSetupFn(token)` (POST) : `assertSameOrigin` + rate-limit + refuse si `isSetupComplete()` ; `timingSafeEqual(sha256(token), hash)` ; succès → pose le cookie + renvoie `{ ok: true }` ; échec → `SETUP-UNLOCK-FAILED` (générique).
  - `setupAuthStatusFn()` (GET) : `{ authed: boolean }` (lit/vérifie le cookie).

`requireSetupAuth()` lit le cookie, déchiffre/vérifie l'âge ; absent/invalide/expiré → `SetupError('SETUP-UNAUTHENTICATED')`. Placé **avant** le bloc `try/catch` de mapping (le `SetupError` traverse opaque).

## 7. Codes d'erreur (table fermée)

Ajouts à `SETUP_CODES` (`setup-errors.ts`) + i18n `wizard.error.codes.*` (fr/en) + `KNOWN_CODES` (`error-code.ts`) :
- `SETUP-UNAUTHENTICATED` : action mutatrice sans cookie valide (ne devrait pas arriver via l'UI ; défend l'appel direct).
- `SETUP-UNLOCK-FAILED` : déverrouillage refusé (jeton faux / déjà configuré / rate-limité) — message **générique**.

## 8. UI (sans écran de saisie)

`SetupWizard` (déjà piloté par l'état serveur) :
- **Au montage** : si `location.hash` contient un `token`, le **conserver en mémoire JS** (variable de session du composant, **pas** dans l'URL ni le storage), appeler `unlockSetupFn(token)`, puis `history.replaceState` pour **nettoyer l'URL**.
- Interroger `setupAuthStatusFn` → `{authed}`. **authed** → flux normal (Welcome → … existant). **non authed** :
  - si un jeton est en mémoire → tentative de déverrouillage (spinner « Déverrouillage… ») ;
  - sinon → écran **« Lien de setup requis »** expliquant de rouvrir l'URL fournie par `install.sh` (pas de champ secret).
- **Sur `SETUP-UNAUTHENTICATED`** d'une action (cookie expiré) : re-déverrouiller **silencieusement** depuis le jeton en mémoire si présent (puis rejouer) ; sinon afficher « Session expirée — rouvre le lien de setup ».
- Échec de déverrouillage → `SetupErrorBox(SETUP-UNLOCK-FAILED)` générique.

Le jeton en mémoire (durée de vie = l'onglet) permet la reprise transparente sans re-coller l'URL, tout en gardant l'URL **nettoyée** (pas d'artefact d'historique). Onglet fermé/rechargé → rouvrir le lien d'origine (sortie `install.sh`).

## 9. Déploiement (`install.sh` / compose / runbook)

- `install.sh` : génère `STALMAIL_SETUP_TOKEN` (CSPRNG), calcule son SHA-256, **écrit `STALMAIL_SETUP_TOKEN_HASH` dans `.env`** (pas le clair), et **imprime l'URL** `https://<ip>/setup#token=<JETON>` dans l'encadré final (le clair n'est jamais stocké). Génération **safe sous `pipefail`** (pas de `… | head` qui casse).
- `compose.prod.yml` : passer `STALMAIL_SETUP_TOKEN_HASH` à l'env du service `app`.
- `.env.example` : documenter `STALMAIL_SETUP_TOKEN_HASH`.
- Runbook de validation (`2026-06-22-validation-reelle-socle.md`) : Phase 2.1 ouvre l'**URL avec le `#token`** (plus `/setup` nu).

## 10. Fichiers impactés

- **Serveur** : `src/server/setup-auth.ts` *(nouveau : cookie issue/verify/clear, `requireSetupAuth`, `isSetupAuthed`, `unlockSetup` avec hash+timingSafeEqual+gate isSetupComplete)* ; un rate-limiter (réutiliser/étendre le pattern `send-rate-limit.ts`, clé `clientIp()`) ; `setup-actions.ts` (unlockSetupFn, setupAuthStatusFn, garde `requireSetupAuth`+`assertSameOrigin` sur les mutatrices) ; `setup-errors.ts` (+2 codes).
- **Client** : `setup-actions` route wiring (`src/routes/setup/index.tsx`) ; `SetupWizard.tsx` (auto-unlock hash + replaceState + mémoire + état non-authed/expiré) ; `error-code.ts` (+2 codes dans `KNOWN_CODES`) ; i18n `resources.ts` (unlock/expired + codes, fr/en).
- **Orchestration** : `install.sh`, `compose.prod.yml`, `.env.example` ; doc runbook.

## 11. Stratégie de test

- **`setup-auth.ts`** (pur, isolé) : `sha256`+`timingSafeEqual` (bon/mauvais jeton), émission/vérif/expiration du cookie, `requireSetupAuth` rejette (absent/invalide/expiré), `isSetupAuthed`, `unlockSetup` refusé si `isSetupComplete`, rate-limit (seuil + back-off), réponse générique.
- **`setup-actions.test.ts`** : chaque fn mutatrice → `SETUP-UNAUTHENTICATED` sans cookie, OK avec ; `unlockSetupFn` succès/échec/rate-limit/post-setup ; `setupAuthStatusFn`.
- **UI** (`SetupWizard.test.tsx`) : auto-unlock depuis `location.hash` + `replaceState` appelé ; non-authed sans jeton → écran « lien requis » ; `SETUP-UNAUTHENTICATED` → re-unlock mémoire ou « expiré ». Props injectées, pas de hooks de route.
- **`install.sh`** : génération jeton + hash (distinct de `STALMAIL_SECRET`), URL imprimée, safe `pipefail` (test shell ciblé ou validation manuelle documentée).

## 12. Sécurité (revue dédiée)

Revue par l'agent `security-reviewer` **au plan** (modèle de menace du gate) et **après implémentation** (diff). Points de contrôle : temps constant, hash-only côté serveur, fragment-only + replaceState, rate-limit + log, réponses génériques (pas d'oracle), cookie `__Host-`/httpOnly/secure/chiffré, gate sur **toutes** les mutatrices, lecture seule non sensible, pas de fuite R6.

## 13. Critères d'acceptation

- Sur instance fraîche, une action mutatrice **sans** cookie de setup → refusée (`SETUP-UNAUTHENTICATED`), y compris en appel HTTP direct (pas seulement via l'UI).
- Ouvrir `…/setup#token=<bon>` → déverrouillage **automatique** (sans écran), URL nettoyée, flux normal.
- `…/setup#token=<faux>` ou `/setup` nu sans jeton → refus générique + écran « lien requis ».
- Le serveur ne détient **jamais** le jeton en clair (seulement `STALMAIL_SETUP_TOKEN_HASH`).
- Expiration du cookie en cours de setup → reprise sans perte (re-unlock mémoire ou réouverture du lien), progression serveur conservée.
- Après `finishSetup` : `unlockSetupFn` refuse, `/setup` redirige, `requireStep` bloque.
- Rate-limit effectif + log sur les tentatives ; réponses génériques (pas d'oracle setup-fait/jeton-faux).
- Tests verts (lint, typecheck, vitest) ; fonctions pures (`setup-auth`) et UI couvertes.
