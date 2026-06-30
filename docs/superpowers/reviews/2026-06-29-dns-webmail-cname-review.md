# Revue — Webmail proposé en CNAME vers l'hôte mail (#61)

**Date** : 2026-06-29
**Branche** : `feat/dns-webmail-cname`
**Spec** : `docs/superpowers/specs/2026-06-29-dns-webmail-cname-design.md`
**Plan** : `docs/superpowers/plans/2026-06-29-dns-webmail-cname.md`

## Résumé

Dans la section « Adresse du serveur » du wizard DNS, le rôle `webmail` (sous-domaine
distinct, hôte de `PUBLIC_URL`) est désormais proposé comme **un CNAME unique vers
l'hôte mail** (1ʳᵉ cible MX/SRV de la zone) au lieu de ses A/AAAA. Repli A/AAAA quand
la zone ne publie pas encore d'hôte mail. Le CNAME est agnostique de l'IP : il s'affiche
même quand la détection d'IP échoue. Une note UI explique l'alias. Le vérificateur de
statut gérait déjà les CNAME — aucun code resolver neuf.

Motivation : un CNAME est interdit sur une cible MX (RFC 2181 §10.3) et sur l'apex
(RFC 1034), mais autorisé sur un sous-domaine webmail, et préférable (une seule IP à
maintenir). Le design précédent gommait cette asymétrie.

## Tâches livrées

1. **`buildHostRecords` émet le CNAME webmail** (`src/server/dns-host-records.ts`) —
   `mailHost = collectHostTargets(zoneRecords)[0]` ; pour le rôle webmail distinct avec
   cible mail, émet `{ type: "CNAME", value: mailHost + ".", role: "webmail" }`, sans
   A/AAAA et indépendamment de l'IP. Repli A/AAAA sinon. 17 tests fichier.
2. **Note UI + i18n** (`HostAddressSection.tsx`, `resources.ts`) — `webmailCnameNote`
   fr+en, rendue si `some(role==="webmail" && type==="CNAME")`.
3. **Vérification d'intégration** — suite complète verte, aucune régression mail/apex.
4. **Affichage sans IP** (`DnsStep.tsx`) — le poll `hostAddressStatus` s'exécute dès que
   la découverte d'IP est résolue (succès OU échec) ; sans IP il interroge le handler
   avec `{}` → le CNAME webmail s'affiche sous le formulaire de saisie manuelle.

## Revues

- **Par tâche** (sonnet) : Tâches 1, 2, 4 **Approved** ; 0 Critical/Important.
- **Revue finale de branche** (opus, `9a62455..0696f71`) : 0 Critical. Un **Important**
  spec/UI — le bénéfice « ligne webmail affichée même sans IP » était inatteignable car
  le poll était gardé par `!serverIp`. **Décision utilisateur : câbler l'UI** →
  Task 4 ajoutée et livrée, écart résorbé (re-revue Approved).
- **Sécurité** : aucune nouvelle surface — noms issus de Stalwart (server-only),
  handler protégé par `assertSameOriginStrict()`, IP revalidées (`isIpv4`/`isIpv6`),
  enums de rôle fermés. Changement présentationnel terminal côté UI.

## Points de suivi (non bloquants)

- **Garde `name !== mailHost`** dans `buildHostRecords` : défense jamais fausse en
  pratique (la dédup en amont garantit la distinction). Conservée et commentée.
- **Nommage de fixture** : un test de repli utilise `hostname = "mail.exemple.fr"` pour
  un rôle webmail (correct mais lisible à contre-sens) ; le test ajouté pour le repli
  utilise un hostname distinct, plus clair.
- **Pré-existant** (hérité) : `resolveRecordStatus` ne rattrape pas les erreurs DNS
  non-ENOTFOUND (hors périmètre de cette feature).

## État final

- `bun run lint && bun run typecheck && bun run test` : **vert, 757 tests**.
- Aucune régression sur les rôles `mail`/`apex` (toujours A/AAAA).
- IPv6 reste de première classe (CNAME agnostique ; repli A/AAAA conserve A **et** AAAA).
