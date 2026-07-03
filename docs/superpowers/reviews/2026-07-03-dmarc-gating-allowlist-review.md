# Revue — Gating DMARC de l'allowlist images (#126)

**Date :** 2026-07-03
**Branche :** `feat/126-dmarc-gating` (`ccd45a2..cdb8638`, 10 commits : 3 docs + 7 impl/fix)
**Spec :** `docs/superpowers/specs/2026-07-03-dmarc-gating-allowlist-design.md` (révisé 2× : revue adversariale pré-plan, puis audit F1)
**Plan :** `docs/superpowers/plans/2026-07-03-dmarc-gating-allowlist.md`
**Méthode :** subagent-driven — implémenteur + relecteur frais par tâche (5/5 Approved), revue de branche (opus), audit sécurité OWASP (opus).

## Verdict

- **Revue de code finale : prête à merger.** 0 Critical / 0 Important. Chaîne bout-en-bout vérifiée (Email/get header → `parseDmarcVerdict` → `authVerdict` → gating → patch client conditionné) ; fail-closed effectif à chaque couche ; cache pré-déploiement géré dans la bonne direction.
- **Audit sécurité : SÛR À MERGER.** 0 bloqueur. Parseur non contournable (états quotes/commentaires/échappements, homoglyphes inertes, pas de ReDoS) ; exemption locale sans bypass (comparaison stricte, anti-fail-open testé) ; `localDomain` exclusivement serveur ; pas de fuite de l'A-R brut au client (réduit à l'enum) ; rate-limit atomique auto-scopé.
- Gate final : lint + typecheck + **864 tests / 86 fichiers** verts.

## Boucles de revue notables (défauts réels attrapés par le processus)

1. **Revue Task 1** : 2 Important dans le code du plan lui-même — contournement de la frontière de clause via *quoted-string* RFC 8601, et parenthèses non appariées non fail-safe → parseur réécrit en **balayage à états** (`neutralize`), structure non refermée → `fail`. Re-revue tracée instruction par instruction : Approved.
2. **Audit final F1** (convergent avec un minor de la revue de code) : « instance A-R présente mais sans clause `dmarc=` » partageait le `"none"` de « aucune instance » et ouvrait l'exemption locale (fail-open si `dmarcVerify` désactivé côté opérateur) → `"fail"` désormais ; `"none"` = strictement « aucune instance » (seul cas éligible à l'exemption). Spec §3.2 aligné. La décision utilisateur (exemption locale pour le courrier interne sans A-R) est préservée à l'identique.

## Minors triés (aucun bloquant)

Des revues par tâche : `neutralize` sans test unitaire direct (couverture exhaustive via la frontière publique) ; quoted-string bien formée « avalant » la clause → `none` (dégradation, jamais faux `pass`, suppose un Stalwart non conforme) ; ordre de l'import dynamique du rate-limit (cosmétique — l'atomicité est interne à `consumeMutationSlot`).

De la revue finale : slot de rate-limit consommé même sur mutation no-op (fail-safe, plus strict) ; staleness du cache client à la fenêtre de déploiement (corrigé au premier reload).

De l'audit : compteurs in-memory mono-process (documenté, déploiement mono-conteneur) — à déplacer vers un store partagé si scaling horizontal un jour.

## Suivis éventuels (non bloquants, tracés)

- Distinguer un éventuel 4ᵉ état si un durcissement futur veut séparer finement les cas `none` (fait partiellement par F1).
- `deleteAllForAccount` : constat documenté (aucun flux de suppression de compte in-app) — câblage à la phase settings/admin.
- Vérification finale E2E **post-déploiement** (plan §Vérification finale) : mail Gmail = `pass`, mail interne = exemption, sonde du format A-R réel via `authVerdict` en réponse réseau.

## Risques résiduels acceptés (spec §3.3, non aggravés)

Multi-domaines (autre domaine local → fail-closed) ; compte local usurpant un From local en soumission ; messages APPEND/import/Sent conservant leurs en-têtes d'origine ; domaines sans politique DMARC exclus de l'upgrade (`dmarc=none` → `fail`, consentement par-message toujours disponible).
