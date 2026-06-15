# Stalmail — Guide projet

Webmail auto-hébergé : shell **TanStack Start** (React 19, SSR + server functions faisant office de BFF) devant un serveur mail **Stalwart** via **JMAP**. Conteneurisé (Docker app + stalwart).

## Gestionnaire de paquets : Bun (jamais npm/yarn/pnpm)

CI et le hook pre-commit utilisent Bun. Toujours :

```bash
bun install            # installer
bun run dev            # serveur de dev
bun run lint           # eslint
bun run typecheck      # tsc --noEmit
bun run test           # vitest run
bun run format         # prettier --write
```

Ne pas éditer `bun.lock` à la main (lancer `bun install`).

## Cycle de travail (superpowers)

Chaque phase suit `spec → plan → implémentation → revue`, documentée sous `docs/superpowers/` :

- `docs/superpowers/specs/AAAA-MM-JJ-<sujet>-design.md` — design validé en brainstorming
- `docs/superpowers/plans/AAAA-MM-JJ-<sujet>.md` — plan d'implémentation détaillé
- `docs/superpowers/reviews/AAAA-MM-JJ-<sujet>-review.md` — revue

Les phases sont numérotées (3a auth, 4a liste, 4b lecteur+actions, 4c composer, 4d live/labels, 4e settings/calendar). Le périmètre « hors scope » d'une phase indique la phase suivante.

## Architecture

- **Server functions = BFF** (`src/server/`). Le navigateur ne parle jamais à Stalwart directement ; tout passe par des server functions qui détiennent les tokens.
- **Auth** : `requireAuth` (guard de route, `beforeLoad`), `requireSession` (server-only, récupère `sid` + `accountId`). `withFreshAccessToken` rafraîchit le token. Session expirée → `redirect('/login')`.
- **JMAP** : `jmap.ts` (Bearer admin), `jmap-user.ts` (`jmapUserCall` avec Bearer utilisateur). Les appels sont des batchs de `methodCalls` (chaînage par `#ids`/`resultOf`).
- **Types partagés** entre server et UI dans `src/server/mail-types.ts`.
- **Données client** : TanStack Query (cache keyé), TanStack Virtual (listes), TanStack Router (routes typées, params/search).

## Conventions de code

- **Fonctions pures extraites et testées isolément** : parsers (`parseListPage`), builders de requêtes (`buildListMethodCalls`), résolveurs (`resolveFilter`). C'est le cœur de la stratégie de test — la logique vit dans des fonctions pures, pas dans les handlers ni les composants.
- **Composants présentationnels** : props injectées, pas de hooks de route dans le composant testé (cf. `MailPage` séparé de `RouteComponent`).
- **Validation** : toute entrée de server function est validée par **Zod**. Pas d'opération JMAP générique exposée au client (enums fermés résolus côté serveur).
- **Sécurité** : aucun secret/token côté client ; contenu non fiable (HTML d'email) isolé (iframe sandbox).
- **i18n** : `react-i18next`, libellés en **français** via clés `t('...')`, jamais de texte en dur.
- **Style** : Prettier + ESLint (`@tanstack/eslint-config`) appliqués automatiquement ; le pre-commit (`lint && typecheck && test`) ne doit pas être contourné.

## Commits & versions

Commits **conventionnels** (`feat:`, `fix:`, `docs:`, `chore:`). Le versionnage et le CHANGELOG sont gérés par **release-please** — ne pas bumper la version manuellement. Toujours travailler sur une branche, jamais committer directement la release.

## Réponses

Répondre en **français**.
