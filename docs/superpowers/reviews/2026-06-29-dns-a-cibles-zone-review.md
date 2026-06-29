# A/AAAA dérivés de la zone + rôle — Revue

- **Date** : 2026-06-29
- **Issue** : #61 (affinage)
- **Branche** : `feat/dns-a-zone-targets`
- **Spec** : `docs/superpowers/specs/2026-06-29-dns-a-cibles-zone-design.md`
- **Plan** : `docs/superpowers/plans/2026-06-29-dns-a-cibles-zone.md`
- **Exécution** : subagent-driven (implémenteur + revue spec/qualité par tâche, puis revue finale + revue sécurité).

## Résultat

Branche **prête à merger**. 752 tests verts, lint + typecheck propres. Ancré sur l'inspection
d'une instance Stalwart v0.16 réelle (zone publiée confirmant que MX/SRV/CNAME pointent tous
l'hôte du serveur mail = `serverHostname`, et que le SPF de l'hôte utilise le mécanisme `a`).

## Tâches (4) — toutes revues clean

| # | Livrable | Commits |
|---|---|---|
| 1 | `collectHostTargets` + `buildHostRecords` (cibles zone, rôle, A+AAAA) | `83e7c20..3694823` |
| 2 | `hostAddressStatusHandler` parse `dnsZoneFile`, type `HostAddressRecord` (role) | `..ed6fa1f` |
| 3 | i18n `wizard.dns.hostAddress.role.{mail,apex,webmail}` (fr+en) | `..2c6e868` |
| 4 | `HostAddressSection` groupé par rôle + élargissement des types | `..78f317e` |
| + | Améliorations finales (test collapse, commentaires) | `..8ab00fd` |

### Correctifs de tâche
- T1 : `zoneRecords` rendu requis (était optionnel → trou de type) + Set dedup + tests webmail/AAAA & hostname vide.
- T4 : test du chemin `apexNote` restauré + assertion `toHaveBeenCalledTimes(1)` + `ROLES` au scope module.

## Revue finale de branche (opus) — « Ready to merge: Yes »

0 Critical, 0 Important. Minors / suivi (non bloquants) :
- **Repli zone-vide** : l'hôte PUBLIC_URL y est étiqueté `webmail` (pas `mail`) — intentionnel, testé, et de fait inatteignable dans le flux wizard (la zone est peuplée au moment de l'étape DNS). Commentaire ajouté.
- **Cibles taguées `mail`** : toute cible MX/SRV/CNAME devient `mail` — correct pour la zone générée par Stalwart (commentaire d'hypothèse ajouté).
- Recommandation appliquée : test « collapse » d'une vraie zone (MX+CNAME×2+SRV) → hôte unique.

## Revue sécurité (security-reviewer, opus) — « SÛR À MERGER »

0 finding bloquant. Vérifié :
- **Source des noms** : `dnsZoneFile` vient de Stalwart (admin JMAP, server-only) ; le client ne fournit que l'IP, re-validée `isIpv4`/`isIpv6`. Aucune donnée client dans la dérivation.
- **Validation** : Zod (`max(45)`) + re-validation IP serveur-side ; durcissement `collectHostTargets` (FQDN requis).
- **Garde** : `assertSameOriginStrict()` en tête du handler. **Token** : non réutilisé, aucun secret client. **XSS** : rendu JSX échappé, pas de `dangerouslySetInnerHTML`.
- **DoS/parsing** : `parseZoneFile` borné, source de confiance.

Point relevé (mineur, **pré-existant**, hors périmètre) : `resolveRecordStatus` re-lève les erreurs DNS non-ENOTFOUND ; le `Promise.all` du handler n'a pas de `try/catch` (comme l'ancien). Suivi possible : aligner sur `discoverServerIpHandler`.

## Suivi (post-merge, non bloquant)
- Envelopper la résolution DNS du handler en `try/catch` (dégrader en `pending`), aligné sur `discoverServerIpHandler` — concerne aussi `dnsGridStatusHandler`.
- Éventuellement étiqueter l'hôte du repli zone-vide en `mail` plutôt que `webmail`.

## Verdict
**Prête à merger.** Qualité/spec + sécurité convergées ; garantie clé (A du serveur mail
toujours dérivée du MX) validée empiriquement et verrouillée par test.
