# Test E2E — Composer (envoi & réponse) — Design

> **Statut : REPORTÉ (2026-06-22).** Cette automatisation Playwright + stack Docker
> éphémère est mise de côté au profit d'une **validation en conditions réelles** sur
> serveur Hetzner + vrai domaine (voir `2026-06-22-validation-reelle-socle-design.md`).
> À reconsidérer plus tard pour une couverture E2E automatisée en CI.
>
> Contexte initial : la phase 4c (Composer) est mergée (`feat(4c)`, PR #41). Avant la
> 4d, on veut une garantie de bout en bout que l'envoi et la réponse fonctionnent
> contre un Stalwart réel.

## 1. Objectif

Valider, de bout en bout et contre une **instance Stalwart réelle**, que le composer
permet d'**envoyer** et de **répondre** à un mail. Approche **hybride** : le parcours
utilisateur est piloté dans un **navigateur (Playwright)**, et l'état résultant est
vérifié par des **assertions JMAP** côté serveur (le BFF/Stalwart fait foi).

Ce test comble le trou entre les tests d'intégration (Vitest, server functions et
composants isolés/mockés) et le comportement réel du système assemblé.

## 2. Périmètre — scénarios

| # | Scénario | Pilotage UI (Playwright) | Assertion JMAP |
|---|---|---|---|
| **S1** | Nouveau message à soi-même | Login → « Nouveau message » → À/Objet/corps → Envoyer | Email présent dans **Sent** ET livré dans **Inbox** |
| **S2** | Répondre (threading) | Ouvrir le message reçu (Inbox) → Répondre → Envoyer | La réponse porte **In-Reply-To** / **References** = Message-ID de l'original |
| **S3** | Transférer | Ouvrir un message → Transférer → saisir destinataire → Envoyer | Email envoyé avec objet préfixé `Fwd:`, corps cité présent |
| **S4** | Répondre à tous | Message reçu avec plusieurs destinataires → Répondre à tous → Envoyer | `cc` contient les autres destinataires, **pas** l'expéditeur courant (auto-exclusion) |
| **S5** | Adresse invalide | Nouveau message → À = chaîne invalide → Envoyer | Toast d'erreur affiché ; **aucun** nouvel Email créé (assertion négative JMAP) |
| **S6** | Rate-limit | Envoyer jusqu'au dépassement du seuil (abaissé, cf. §6) | Dernier envoi : toast d'erreur générique ; nombre d'Email envoyés borné au seuil |

### Hors scope
- Autres vues (liste, lecteur — déjà couvertes en intégration Vitest).
- Pièces jointes / images inline (hors scope produit 4c).
- Multi-navigateurs (chromium seul), responsive/mobile.
- Tests E2E du wizard de setup (couverts par les smoke scripts existants).

## 3. Outillage & infrastructure

- **Playwright** (`@playwright/test`), **chromium headless** uniquement. Nouvelle
  devDependency. Config `playwright.config.ts`.
- **Stack Docker éphémère** dédiée (projet Compose `stalmaile2e`), montée par le
  `globalSetup` de Playwright et démontée par le `globalTeardown` (avec trap de
  sécurité). Réutilise la topologie de `compose.yml` et la logique d'attente de
  readiness des scripts `smoke-*.sh`.
- **Assertions JMAP** : helpers appelant directement Stalwart (HTTP/JMAP, Bearer)
  depuis le code de test pour interroger l'état réel (Email/query sur Sent/Inbox,
  lecture des en-têtes via `Email/get`), sur le modèle des smoke tests.

Pas de mock : le test exerce le vrai chemin navigateur → server functions (BFF) →
JMAP → Stalwart.

## 4. Provisioning de l'environnement et du compte

1. **Bootstrap Stalwart** dans la stack éphémère sur un **domaine jetable**
   (`e2e.test`), via la même chaîne que le wizard / `smoke-setup-backend.sh`
   (bootstrap → mode normal).
2. **Création d'un compte mailbox de test à mot de passe connu** (`user@e2e.test` /
   mot de passe de test) via l'**API de management Stalwart**, authentifiée avec le
   **recovery admin** (`STALWART_RECOVERY_ADMIN`). Le détail exact des appels (endpoint
   de création de principal / mot de passe) sera tranché au plan en s'appuyant sur
   `docs/superpowers/specs/2026-06-09-stalwart-api-capture.md`, `src/server/stalwart-account.ts`
   et `src/server/stalwart-user.ts`.
3. **S1 envoie à soi-même** (`user@e2e.test`) : le message apparaît à la fois dans
   **Sent** et, par livraison locale, dans **Inbox** — ce qui permet S2 (répondre au
   message reçu) sans second compte.

Pour S4 (répondre à tous), un message d'amorce multi-destinataires est injecté
directement via JMAP (ou un second destinataire local est provisionné) — décision
d'implémentation tranchée au plan ; l'invariant testé est l'auto-exclusion + dédup.

## 5. Architecture du test (unités isolées)

```
e2e/
  harness/stack.ts       # up/down de la stack éphémère + attente readiness
  harness/provision.ts   # bootstrap Stalwart + création du compte de test
  harness/jmap.ts        # helpers d'assertion JMAP (query Sent/Inbox, lecture headers)
  composer.spec.ts       # scénarios S1–S6 (Playwright UI + assertions JMAP)
playwright.config.ts     # baseURL = app éphémère ; globalSetup / globalTeardown
```

- **`stack.ts`** : ce qu'il fait — monte/démonte la stack Docker `stalmaile2e` et
  attend que l'app et Stalwart soient prêts. Dépend de Docker Compose. Interface :
  `setupStack()`, `teardownStack()`.
- **`provision.ts`** : bootstrap + création du compte de test à mot de passe connu.
  Dépend de l'API Stalwart (recovery admin). Interface : `provisionTestAccount() →
  { email, password }`.
- **`jmap.ts`** : assertions sur l'état mail réel. Dépend du token JMAP utilisateur.
  Interface : `queryMailbox(role)`, `getEmail(id)`, `countEmails(filter)`.
- **`composer.spec.ts`** : orchestre login + actions UI (Playwright) puis assertions
  via `jmap.ts`.

## 6. Rate-limit (S6)

`src/server/send-rate-limit.ts` expose `MAX_PER_ACCOUNT = 30` en dur. Pour rendre S6
testable sans envoyer 30+ mails, on rend ce plafond **configurable par variable
d'environnement** : `STALMAIL_SEND_RATE_MAX` (entier, **défaut 30** — comportement de
production strictement inchangé). La stack E2E fixe `STALMAIL_SEND_RATE_MAX=2` : le
test envoie 2 messages acceptés puis le 3ᵉ déclenche le toast d'erreur générique
(`mail.compose.error`), et une assertion JMAP confirme que le nombre d'emails envoyés
est borné au seuil.

C'est l'unique modification de code applicatif induite par ce test ; elle est
défensive (lecture d'env avec valeur par défaut) et couverte par un test unitaire
ajouté à `send-rate-limit.test.ts`.

## 7. Intégration CI

- **Nouveau workflow** `.github/workflows/e2e.yml` : déclencheurs `workflow_dispatch`
  (manuel) et `schedule` (nightly). Étapes : checkout, setup Bun, `bun install`,
  installation des navigateurs Playwright, `bun run test:e2e` (qui monte la stack,
  exécute les scénarios, démonte). **Pas** déclenché sur `pull_request` / `push` —
  la CI PR (`ci.yml` : lint/typecheck/test) reste rapide et inchangée.
- **Script local** : `bun run test:e2e` (= `playwright test`) lançable à la demande.

## 8. Gestion des erreurs & robustesse

- `globalTeardown` + trap : la stack éphémère est **toujours** démontée (même en cas
  d'échec/timeout), pour ne pas laisser de conteneurs/volumes orphelins.
- Attentes explicites de readiness (healthz Stalwart, app HTTP) avant de lancer les
  scénarios — pas de `sleep` arbitraire (sur le modèle des smoke scripts).
- En cas d'échec d'un scénario : capture d'écran + trace Playwright pour le diagnostic.

## 9. Sécurité / données

- Domaine (`e2e.test`) et compte (`user@e2e.test`) **jetables**, dans la stack
  éphémère uniquement ; mot de passe de test **non sensible** (pas un secret réel).
- Aucun token/secret de production ; le recovery admin de la stack E2E est une valeur
  de test dédiée. Conforme aux conventions du projet (isolation, pas de secret en clair
  hors test jetable).

## 10. Références

- Composer 4c : `docs/superpowers/specs/2026-06-21-plan-4c-composer-design.md`,
  `docs/superpowers/plans/2026-06-21-plan-4c-composer.md`
- Smoke tests existants : `scripts/smoke-compose.sh`, `scripts/smoke-setup-backend.sh`,
  `scripts/dev-reset.sh`
- Capture API Stalwart : `docs/superpowers/specs/2026-06-09-stalwart-api-capture.md`
- Stack dev : `compose.dev.yml`, `compose.yml`
- Server modules pertinents : `src/server/send-rate-limit.ts`, `src/server/stalwart-account.ts`,
  `src/server/stalwart-user.ts`, `src/server/jmap-user.ts`
