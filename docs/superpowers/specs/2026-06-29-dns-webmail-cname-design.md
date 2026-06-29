# DNS — Webmail proposé en CNAME vers l'hôte mail

**Date** : 2026-06-29
**Sujet** : Traiter le rôle « webmail » séparément de l'apex dans la section « Adresse du serveur » du wizard DNS — proposer un **CNAME** vers l'hôte mail plutôt que des A/AAAA.
**Phase** : prolongement de l'issue #61 (guidage A/AAAA), suite directe de `2026-06-29-dns-a-cibles-zone-design.md`.

## Contexte

Le wizard DNS dérive les enregistrements d'adresse manquants (Stalwart ne publie jamais d'A/AAAA) à partir de la zone publiée, étiquetés par rôle : `mail` (cibles MX/SRV), `apex` (racine), `webmail` (hôte de `PUBLIC_URL`). Aujourd'hui les trois rôles sont proposés à l'identique en **A/AAAA**.

Or les trois rôles n'ont pas les mêmes contraintes DNS :

- **Hôte mail** (cible MX) : un CNAME y est interdit (RFC 2181 §10.3) → A/AAAA obligatoires.
- **Apex** : un CNAME y est interdit (RFC 1034, l'apex porte SOA/NS) → A/AAAA seule forme valide.
- **Webmail** : sous-domaine ordinaire → **un CNAME est autorisé**, et souvent préférable (une seule IP à maintenir, celle de la cible ; le webmail suit automatiquement).

Le design actuel gomme cette asymétrie. Cette spec corrige le seul rôle concerné : le webmail.

## Objectif

Quand le webmail est un **sous-domaine distinct** (≠ apex, ≠ hôte mail), proposer **un CNAME** pointant vers l'hôte mail, au lieu de ses A/AAAA. Conserver le comportement actuel partout ailleurs.

### Hors scope

- Apex et hôte mail : inchangés (A/AAAA).
- Option « afficher A/AAAA **et** CNAME en alternatives » : écartée (vérifier deux enregistrements mutuellement exclusifs brouille le statut).
- Note informative « ce sous-domaine peut aussi être un CNAME » en mode A/AAAA : sans objet puisqu'on bascule réellement en CNAME.

## Comportement fonctionnel

Le rôle **webmail** devient un **CNAME unique** vers l'hôte mail (1ʳᵉ cible MX de la zone), **uniquement** lorsqu'il s'agit d'un sous-domaine distinct et qu'une cible mail existe.

| Cas | Résultat webmail |
|-----|------------------|
| Sous-domaine distinct + zone publie un hôte mail | **1 CNAME** → hôte mail (ni A ni AAAA) |
| Zone vide (début setup, pas de cible MX) | **repli A/AAAA** (comportement actuel) |
| `webmail === apex` | reste **apex** (A/AAAA) — déjà géré par dédup, aucun CNAME |
| `webmail === hôte mail` | reste **mail** (A/AAAA requis) — déjà géré par dédup |

**Indépendance vis-à-vis de l'IP** : le CNAME ne dépend pas de l'IP détectée par l'écho. Il est donc émis **même si la détection d'IP échoue** — la ligne webmail reste alors valide et affichée (alors qu'aujourd'hui, sans IP, aucune ligne n'apparaît). Les A/AAAA de `mail` et `apex` restent, eux, conditionnés à la présence d'une IP.

## Architecture & composants

### 1. Module pur `src/server/dns-host-records.ts`

`buildHostRecords` calcule en amont :

```ts
const mailHost = collectHostTargets(zoneRecords)[0] ?? null
```

Dans la boucle d'émission, pour chaque `{ name, role }` collecté :

- `role === "webmail"` **et** `mailHost` non nul → pousser
  `{ name: name + ".", type: "CNAME", value: mailHost + ".", role: "webmail" }`,
  **sans** émettre de A/AAAA pour ce nom ;
- sinon → comportement actuel (`A` si `ipv4`, `AAAA` si `ipv6`).

La déduplication existante (`seen`, priorité `mail` > `apex` > `webmail`) garantit qu'au moment où un `webmail` atteint la boucle, son nom est distinct de l'apex et de toute cible mail. Le test `name !== mailHost` reste néanmoins en place comme défense.

`collectHostTargets` et la signature publique de `buildHostRecords` sont **inchangés**.

### 2. Vérification de statut — `src/server/dns-resolve.ts`

**Aucun changement.** `resolveRecordStatus` gère déjà le type `CNAME` (`dns-resolve.ts:65-72`) : il compare la cible de la zone aux CNAME résolus (insensible au point final et à la casse). La valeur attendue est le FQDN de l'hôte mail.

### 3. Handler `hostAddressStatusHandler` — `src/server/setup-actions.ts`

**Aucun changement de logique.** Le handler mappe déjà `verified`/`mismatch`/`missing` → `verified`/`error`/`pending` pour tout type d'enregistrement renvoyé par `buildHostRecords`. Le CNAME passe par le même chemin.

### 4. UI `src/components/setup/steps/HostAddressSection.tsx`

- La ligne du groupe **Webmail** affiche `type="CNAME"` et `value =` hôte mail. La structure d'affichage par groupes de rôles est inchangée (le composant est agnostique du type).
- Ajout d'une **note** sous le groupe webmail, expliquant qu'il s'agit d'un alias vers l'hôte mail (une seule IP à maintenir). Rendue uniquement si le groupe webmail contient un enregistrement de type `CNAME`.

### 5. i18n `src/i18n/resources.ts`

Nouvelle clé `wizard.dns.hostAddress.webmailCnameNote`, fr + en (parité imposée par le type). Libellé fr proposé : « Le webmail est un alias (CNAME) vers l'hôte mail : une seule adresse IP à maintenir. »

## Flux de données

1. `hostAddressStatusHandler` lit `domain.dnsZoneFile` → `parseZoneFile` → `zoneRecords`.
2. `buildHostRecords({ zoneRecords, hostname, domain, ipv4, ipv6 })` émet les enregistrements attendus, dont le CNAME webmail le cas échéant.
3. `resolveRecordStatus` vérifie chaque enregistrement (CNAME inclus, sans code neuf).
4. `HostAddressSection` rend les groupes par rôle ; le groupe webmail peut désormais contenir un CNAME + sa note.

## Gestion des erreurs / cas limites

- **Zone vide / pas de cible MX** → `mailHost` nul → webmail en repli A/AAAA (conditionné à l'IP), comme aujourd'hui.
- **Échec de l'écho IP** (`ipv4` et `ipv6` nuls) → mail/apex non émis, mais webmail CNAME émis quand même (agnostique de l'IP).
- **Plusieurs cibles MX** → `mailHost` = la première de `collectHostTargets` (déterministe ; en pratique un hôte unique).
- **`webmail === apex` ou `=== hôte mail`** → la dédup empêche l'émission d'un rôle webmail séparé ; aucun CNAME.

## Tests

Fonctions pures, testées isolément (`src/server/dns-host-records.test.ts`) :

- webmail distinct + cible mail → **1 CNAME** (`value` = hôte mail avec point final, ni A ni AAAA) ;
- zone vide → webmail **repli A/AAAA** ;
- `webmail === apex` → aucun CNAME (reste apex A/AAAA) ;
- `webmail === hôte mail` → dédupliqué (reste mail, pas de webmail) ;
- IPv6 seul (`ipv4` nul) → mail/apex en AAAA, **webmail toujours CNAME** ;
- aucune IP (`ipv4` et `ipv6` nuls) → **CNAME webmail tout de même émis**, mail/apex absents.

Pas de nouveau test resolver : la branche CNAME de `resolveRecordStatus` est déjà couverte.

## Critères de succès

- Un webmail sous-domaine distinct affiche un CNAME → hôte mail, vérifié vert quand l'alias est en place.
- Aucune régression sur apex / hôte mail (toujours A/AAAA) ni sur les cas de dédup.
- IPv6 reste de première classe (CNAME agnostique ; repli A/AAAA conserve A **et** AAAA).
- `bun run lint && bun run typecheck && bun run test` au vert.
