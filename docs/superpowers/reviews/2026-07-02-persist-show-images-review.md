# Revue — Persistance « Afficher les images » (#70)

**Date :** 2026-07-02
**Branche :** `feat/persist-show-images` (`de0f68b..8125cd3`, 10 commits : 3 docs + 7 implémentation)
**Spec :** `docs/superpowers/specs/2026-07-02-persist-show-images-design.md`
**Plan :** `docs/superpowers/plans/2026-07-02-persist-show-images.md`
**Méthode :** subagent-driven — implémenteur + relecteur frais par tâche (7/7 Spec ✅ / Approved), puis revue de branche (opus) et audit sécurité (security-reviewer, opus).

## Verdict

- **Revue de code finale : prête à merger, aucun fix requis.** 0 Critical / 0 Important. Chaîne bout-en-bout vérifiée sans rupture (clic → `Email/set` keyword → rechargement → `Email/get` → `parseThreadDetail` → `applyImagePrefs` → `imageDecision` → CSP). Optimistic client et résolution serveur convergent (même `normalizeSender` des deux côtés).
- **Audit sécurité : SÛR À MERGER.** 0 Critical / 0 Important. Les 8 points de vérification du design confirmés conformes (A01 session-scoped, A03 clé keyword constante + Zod, confinement iframe/CSP intact, store 0600 atomique fail-safe, fail-closed partout, erreurs génériques, pas de bypass durable du patch optimiste).
- Gate final : lint + typecheck + **822 tests / 84 fichiers** verts.

## Points forts relevés

- Séparation pure/effet exemplaire (`image-prefs.ts` pur testé isolément ; enrichissement `sender-allowed` isolé dans `readThreadFn`, seul détenteur d'`accountId`).
- `parseThreadDetail` reste pur et prefs-agnostique ; invariant READ-ONLY de `readThreadFn` préservé.
- Durcissement CSP livré (`img-src` consenti sans `http:`) avec test discriminant (piège de sous-chaîne `http:;`/`https:;` vérifié).
- Parité i18n fr/en garantie au compile-time (`DeepRecord<typeof fr>`).

## Minors triés (aucun bloquant — décision revue finale)

Des revues par tâche (8) : valeur du keyword verrouillée de fait par les tests de `buildShowImagesCall` ; type d'entrée de `resolveImageDecision` plus large que nécessaire ; `MAX_TRUSTED_SENDERS` en milieu de fichier ; dir 0700 non asserté (gap hérité de session-store) ; littéral keyword en fixture (voulu, verrou de contrat) ; test message-allowed sans assertion srcDoc (couvert par email-body.test) ; test untrustSender sans assertion d'absence de patch ; flaky `DnsStep.test.tsx` sans rapport (vert en isolation).

De la revue finale (3) : divergence inter-threads du cache après trust/untrust (corrigée à tout refetch, `staleTime` 30 s) ; « Bloquer » ne retire pas un keyword message-level préexistant (documenté dans le hook, hors périmètre) ; précédence sender>message non testée dans `applyImagePrefs` (couverte via `resolveImageDecision`).

De l'audit sécurité (3, mineurs/informatifs) : pas de rate-limit sur les mutations d'allowlist (impact borné : dédup sans écriture + cap FIFO 500) ; cache store mono-process (multi-worker → périmé fail-safe vers blocked) ; `deleteAllForAccount` exporté mais non câblé (orphelins à la suppression de compte).

## Suivis à ouvrir (post-merge)

1. **Gating DMARC** du `sender-allowed` (risque « From usurpé » accepté, spec §8) : conditionner à `Authentication-Results` pass via `Email/get`.
2. Câbler `deleteAllForAccount` à la suppression de compte ; envisager un rate-limit des mutations d'allowlist et une invalidation large `["thread"]` si la divergence inter-threads devient visible.
3. Flaky `DnsStep.test.tsx` (1er run complet, hors périmètre) si récurrent.

## Risques résiduels acceptés (spec §8, non aggravés par l'implémentation)

From usurpé (→ suivi DMARC), multi-From (`from[0]` seul gouverne), allowlist non corroborée par un mail réel (impact self-scoped).
