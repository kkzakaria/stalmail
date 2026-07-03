# Révocation par-message de « Afficher les images » — Mini-plan

**Date :** 2026-07-02
**Origine :** retour de test utilisateur post-livraison #70 (PR #125, v0.1.42) : « Toujours afficher pour X » offre [Bloquer], mais « Afficher les images » n'offre aucun chemin de retour — asymétrie ressentie. Comble le hors-périmètre acté au spec (§11, retiré) et l'edge relevé en revue finale (un message trusted + keyword ne se révoquait qu'à moitié).
**Spec :** amendements dans `2026-07-02-persist-show-images-design.md` (§Périmètre, §2, §3.2, §6, §7, §8, §11).
**Goal :** l'état `message-allowed` affiche « Images distantes affichées · [Bloquer] » qui retire le keyword `stalmail_showimages` (`Email/set … null`) et re-bloque le message.

## Changements (1 tâche TDD)

- `src/server/mail-actions.ts` : `buildShowImagesCall(accountId, emailIds, value: boolean)` généralisé (`true` → pose, `false` → `null`, patron `buildSetFlagsCall`) ; call site `showImagesOnceFn` passe `true` ; nouvelle `hideImagesFn` (miroir : `showImagesSchema`, `requireSession`, `emailSetRejections`).
- `src/server/mail-actions.test.ts` : test builder mis à jour (arg `true`) + cas `false` → patch `null`.
- `src/i18n/resources.ts` : clé `mail.reader.imagesShown` (fr « Images distantes affichées. » / en « Remote images shown. ») ; `blockSender` réutilisé.
- `src/components/mail/message-item.tsx` : prop `onHideImages?: (emailId: string) => void` ; bandeau `remote && decision === "message-allowed"` : note + [Bloquer] → `onHideImages(message.id)`.
- `src/components/mail/message-item.test.tsx` : le test « message-allowed : pas de bandeau » devient « message-allowed : bandeau affiché + Bloquer déclenche onHideImages ».
- `src/components/mail/use-image-actions.ts` : `hideImages(emailId)` via `runOptimistic((m) => m.id === emailId, "blocked", () => hideImagesFn(...))` — déterministe (si l'expéditeur était trusted, l'état serait `sender-allowed`, pas `message-allowed`).
- `src/components/mail/use-image-actions.test.tsx` : test succès (patch `blocked` + payload serveur).
- `src/components/mail/reader.tsx` + `src/routes/mail/$folder.tsx` : pass-through + câblage `onHideImages`.

## Sécurité

Aucune surface nouvelle : keyword constante serveur, `showImagesSchema` réutilisé, `accountId` de session, retrait de keyword = direction fail-safe (re-bloque). CSP inchangée.
