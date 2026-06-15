---
name: project-conventions
description: Conventions internes de Stalmail à appliquer pendant tout travail sur ce dépôt (écriture de code, refactor, ajout de feature). Couvre Bun, le pattern server-function/BFF, le style « fonctions pures testées », l'i18n FR, et les règles de sécurité. Connaissance de fond — à appliquer sans qu'on le demande.
user-invocable: false
---

# Conventions Stalmail

Applique ces règles dès que tu écris ou modifies du code dans ce dépôt. Elles complètent `CLAUDE.md` avec le « comment faire ».

## Outillage

- **Bun uniquement** : `bun install`, `bun run dev|lint|typecheck|test|format`. Jamais `npm`/`yarn`/`pnpm`. Ne jamais éditer `bun.lock` (lancer `bun install`).
- Avant de considérer un travail terminé : `bun run lint && bun run typecheck && bun run test` doivent passer (c'est ce que vérifie le pre-commit).

## Server functions (BFF)

Pattern standard pour toute opération côté serveur (ex. action JMAP) :

1. `createServerFn({ method: 'GET' | 'POST' })`
2. `.validator((d) => schema.parse(d))` — **Zod**, bornes explicites, enums fermés.
3. `.handler` minimal : `requireSession()` → appelle des **fonctions pures** (builders/parsers) → `jmapUserCall`.
4. La logique métier (construction des `methodCalls`, parsing des réponses, résolution role→mailboxId) vit dans des **fonctions pures exportées et testées**, pas dans le handler.

Ne jamais exposer d'opération JMAP générique pilotable par le client (pas de mailbox/keyword arbitraire passé tel quel). Résoudre les cibles côté serveur depuis un enum.

## Style de test

- La logique pure (parsers, builders, résolveurs, réconciliation de cache) est extraite et **testée unitairement** (vitest). C'est la stratégie de test principale.
- Composants : séparer le présentationnel (props injectées, testable) de la liaison à la route. Tester états vide / chargé / erreur / skeleton.
- Co-localiser les tests : `xxx.ts` ↔ `xxx.test.ts`.

## Sécurité

- Aucun token/secret/`sid` côté client (props, JSON SSR, logs, messages d'erreur).
- Contenu d'email = non fiable : HTML rendu en `<iframe sandbox>` sans `allow-scripts` ; images distantes bloquées par défaut.
- `accountId`/identité viennent de la session, jamais du client.

## UI / i18n

- Pas de texte en dur : clés `t('...')` (react-i18next), libellés **français**.
- Réutiliser les primitives existantes (`Icon`, `Avatar`, helpers de `mail-actions.ts`) plutôt que dupliquer.
- Tailwind 4 + classes de la maquette déjà présentes dans `mail.css` — vérifier qu'une classe n'existe pas déjà avant d'en ajouter.

## Commits

Conventionnels (`feat|fix|docs|chore: …`). Versionnage géré par release-please — ne pas bumper manuellement. Toujours sur une branche.
