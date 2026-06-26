# Guidage A/AAAA dans l'étape DNS — Revue

- **Date** : 2026-06-26
- **Issue** : #61
- **Branche** : `feat/dns-a-aaaa-guidage`
- **Spec** : `docs/superpowers/specs/2026-06-26-dns-a-aaaa-guidage-design.md`
- **Plan** : `docs/superpowers/plans/2026-06-26-dns-a-aaaa-guidage.md`
- **Exécution** : subagent-driven (1 implémenteur + revue spec/qualité par tâche, puis revue finale de branche + revue sécurité).

## Résultat

Branche **prête à merger**. 735 tests verts, lint + typecheck propres. Périmètre B (guidage
seul) : aucune écriture DNS automatique, aucune réutilisation du token fournisseur.

## Tâches (8) — toutes revues clean

| # | Livrable | Commits |
|---|---|---|
| 1 | `src/lib/ip.ts` — `isIpv4`/`isIpv6` purs | `ec0bb04..be04fcc` |
| 2 | `server-ip.ts` — `parseEchoResponse` + `discoverServerIp` (écho, timeout 3s) | `..01d0d6b` |
| 3 | `dns-host-records.ts` — `buildHostRecords` (hostname + apex) | `..40bd974` |
| 4 | `dns-resolve.ts` — vérification live A/AAAA | `..5d6bad4` |
| 5 | server fns `discoverServerIpFn` + `hostAddressStatusFn` | `..b6f195e` |
| 6 | i18n `wizard.dns.hostAddress.*` (fr + en) | `..ea80580` |
| 7 | `HostAddressSection` (composant présentationnel) | `..6224ac3` |
| 8 | intégration `DnsStep` + câblage route/SetupWizard | `..d4b18d8` |

### Correctif de tâche (Task 8)
`2aba7d4` — revue (opus) a relevé en **Important** que l'état « loading » de la section était
mort en intégration (régression UX vs plan, due à une assertion de test synchrone). Corrigé :
rendu inconditionnel de la section avec mapping `loading|ready|failed` + `waitFor` dans le test ;
+ retrait du code mort `isExternalHost` (branche A toujours fausse) ; + filtre A/AAAA cohérent sur
le badge de tâche. Re-revue : clean.

## Revue finale de branche (opus) — « à merger avec correctifs »

- **Important** : clés i18n orphelines (`wizard.dns.records.extTag`, `extNote`, `groups.a`)
  devenues mortes après la suppression du chemin `hasExternalA`/`extNote`.
- Minors : couverture de tests (AAAA missing, `domain=null`/IPv6, chemin apexNote), import hors
  try/catch dans `discoverServerIpHandler` (mandaté par le plan, risque théorique), exemple
  Cloudflare-trace synthétique.

## Revue sécurité (security-reviewer, opus) — « SÛR À MERGER »

0 finding bloquant. Axes prioritaires de la spec correctement traités :
- **SSRF** : RAS — l'URL de l'écho est fixe (constante/env opérateur), jamais dérivée du client ;
  le client ne fournit que l'IP, re-validée serveur-side, utilisée uniquement comme terme de
  comparaison de chaîne (jamais comme cible réseau).
- **Non-réutilisation du token DNS** : RAS — aucun chemin ne relit le secret fournisseur ; aucun
  secret exposé au client.
- **XSS** : RAS — rendu via JSX échappé, pas de `dangerouslySetInnerHTML`.
- **Validation** : Zod (`max(45)`) + re-validation `isIpv4`/`isIpv6` → null si invalide.

Points relevés :
- **F1 (🟡, recommandé avant merge)** : les deux nouvelles server functions n'étaient pas
  gardées ; `discoverServerIpFn` est le premier endpoint déclenchant un fetch sortant sans auth,
  activable cross-origin (style CSRF). Impact limité (URL fixe, faible amplification) mais réel.
- F2 (🔵) : `isIpv6` permissif (sans vecteur — valeur seulement comparée). Suivi.
- F3 (🔵) : erreur DNS non-ENOTFOUND remonte en 500 (pas de fuite ; comportement identique à
  `dnsGridStatusHandler` existant). Suivi.

## Correctifs finaux (`688a0de`) + re-revue

Un correctif groupé, re-revu clean :
- **Important** : suppression des clés i18n orphelines (`extTag`, `extNote`, `groups.a`) fr + en.
- **Sécurité F1** : `assertSameOriginStrict()` ajouté en première instruction des deux handlers
  (`discoverServerIpHandler`, `hostAddressStatusHandler`) — bloque le déclenchement cross-origin
  sans coupler au cycle de polling (pas de `requireSetupAuth`/`requireStep`, cohérent avec les
  autres lectures du setup). Mock de test ajouté.
- **Minor** : `apexNote` en un seul `.find` + test du chemin apexNote ajouté.

## Suivi (post-merge, non bloquant)
- F2 : durcir `isIpv6` via `net.isIPv6()` (aucun vecteur, faible priorité).
- F3 : envelopper `resolveRecordStatus` pour dégrader les erreurs DNS transitoires en `pending`
  (à aligner aussi sur `dnsGridStatusHandler`).
- Compléter la couverture de tests (AAAA missing, `domain=null`/IPv6).
- Note possible près du téléchargement du fichier de zone : les A/AAAA n'y figurent pas (par
  conception — non publiés par Stalwart), ils sont copiables individuellement dans la section.

## Verdict
**Prête à merger.** Qualité/spec + sécurité convergées.
