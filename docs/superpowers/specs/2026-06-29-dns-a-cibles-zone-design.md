# A/AAAA dérivés de la zone publiée, étiquetés par rôle — Design

- **Date** : 2026-06-29
- **Issue** : #61 (suite — affinage du guidage A/AAAA)
- **Statut** : validé en brainstorming (ancré sur l'inspection d'une instance Stalwart réelle)
- **Cycle** : spec → plan → implémentation → revue

## Contexte & problème

Le guidage A/AAAA actuel (`buildHostRecords`) produit un A/AAAA pour deux noms seulement :
le **hostname public** (hôte de `STALMAIL_PUBLIC_URL`) et l'**apex** du domaine. Il ne consulte
pas ce que Stalwart publie réellement. Or l'hôte qui **doit** résoudre vers l'IP du serveur est
la **cible du MX** (l'hôte du serveur mail). Si `PUBLIC_URL` diffère de cette cible, le A du
serveur mail n'est jamais guidé — alors qu'il est critique.

### Validation empirique (instance Stalwart v0.16 pilotée)

Bootstrap `defaultDomain=example.test`, `serverHostname=mail.example.test` → `dnsZoneFile` publié :

```
example.test.              IN MX   10 mail.example.test.
mail.example.test.         IN TXT  "v=spf1 a -all"
example.test.              IN TXT  "v=spf1 mx -all"
_imaps._tcp.example.test.  IN SRV  0 1 993 mail.example.test.
_submissions._tcp…         IN SRV  0 1 465 mail.example.test.
_pop3s / _jmap / _caldavs / _carddavs  IN SRV … mail.example.test.
autoconfig / autodiscover / mta-sts / ua-auto-config  IN CNAME mail.example.test.
+ DKIM, DMARC, MTA-STS, TLS-RPT (TXT)
```

Constats décisifs :

1. **Tout pointe vers un seul hôte = `serverHostname`** (= cible du MX = cibles SRV = cibles
   CNAME) = `mail.example.test`. C'est l'hôte du serveur mail à faire résoudre vers l'IP.
2. **Le SPF de l'hôte utilise le mécanisme `a`** (`mail.example.test → v=spf1 a -all`) : sans le
   A de cet hôte, le SPF échoue → la délivrabilité casse. Le A du serveur mail est **critique**,
   pas cosmétique.
3. **L'apex n'est cible de rien** (il porte MX + SPF `mx` + DMARC) : son A n'est **pas requis**
   pour le mail, seulement pour l'accès web (`https://domaine`).
4. `serverHostname` est fixé au **bootstrap** : Stalwart ne « devine » pas `mail.<domaine>`, il
   publie ce qu'on lui donne. Dériver l'hôte **de la zone** (cible MX) est donc fiable quel que
   soit le sous-domaine choisi, là où déduire de `PUBLIC_URL` peut diverger.

## Objectif

Garantir que **le serveur mail (cible du MX) reçoive toujours** un guidage A/AAAA vers l'IP du
serveur, en dérivant les noms de la **zone réellement publiée** par Stalwart, et présenter ces
enregistrements **étiquetés par rôle** pour lever l'ambiguïté. IPv4 et **IPv6 traités à égalité**.

## Décisions de cadrage

| Sujet | Décision |
|---|---|
| Source des noms A/AAAA | **Dériver de la zone publiée** (cibles MX/SRV/CNAME) + apex + hostname public, dédupliqués |
| Présentation | **Étiquetée par rôle** : Serveur mail (requis) / Apex — web (optionnel) / Webmail |
| IPv6 | **À égalité** : pour chaque hôte, A *et* AAAA dès qu'une IPv6 est disponible (jamais écartée) |
| Découverte IP | Inchangée (écho BFF v4 + v6, fallback saisie manuelle) |
| Vérification live | Inchangée (`resolveRecordStatus` sur name/type/value) |

## Architecture & composants

### Cœur pur — `src/server/dns-host-records.ts`

**`collectHostTargets(zoneRecords: ZoneRecord[]): string[]`** (pur, testé)
- Parcourt les records et extrait les **cibles** :
  - `MX` → dernier token de la valeur (`"10 mail.host."` → `mail.host`) ;
  - `SRV` → dernier token (`"0 1 993 mail.host."` → `mail.host`) ;
  - `CNAME` → la valeur (`"mail.host."` → `mail.host`).
- Normalise (trim, lowercase, retrait du point final), filtre les vides, déduplique.
- En pratique renvoie l'hôte unique du serveur mail.

**`buildHostRecords(input): HostRecord[]`** (pur, testé)
```ts
interface HostRecord { name: string; type: "A" | "AAAA"; value: string; role: "mail" | "apex" | "webmail" }
input: { zoneRecords: ZoneRecord[]; hostname: string; domain: string; ipv4: string | null; ipv6: string | null }
```
- Construit la liste ordonnée de noms avec rôle :
  1. **`mail`** : chaque cible de `collectHostTargets(zoneRecords)` ;
  2. **`apex`** : l'apex `domain`, s'il n'est pas déjà couvert par un nom `mail` ;
  3. **`webmail`** : l'hôte `hostname` (PUBLIC_URL), s'il n'est pas déjà couvert.
- Déduplication par nom : un nom déjà présent à un rôle supérieur n'est pas redupliqué.
- Pour chaque nom retenu : pousse `{type:"A", value:ipv4}` si `ipv4`, **et** `{type:"AAAA",
  value:ipv6}` si `ipv6` — IPv6 systématiquement incluse quand disponible.
- **Repli zone vide** (début de setup, `dnsZoneFile` absent) : pas de cible MX → on retombe sur
  `webmail` (hostname) + `apex`, comportement actuel, jamais de liste vide si une IP existe.

### Serveur — `src/server/setup-actions.ts`

`hostAddressStatusHandler` : parse `domain.dnsZoneFile` via `parseZoneFile` (comme
`dnsGridStatusHandler`) et passe `zoneRecords` à `buildHostRecords`. Le mapping de statut, Zod,
la re-validation IP (`isIpv4`/`isIpv6`), la garde `assertSameOriginStrict` restent **inchangés**.
La réponse expose le `role` à côté de name/type/value/status.

### UI — `src/components/setup/steps/HostAddressSection.tsx`

- Groupe les lignes **par rôle**, chaque groupe avec un libellé i18n :
  - **« Serveur mail (requis) »** (`role: mail`) ;
  - **« Apex — accès web (optionnel) »** (`role: apex`) ;
  - **« Webmail »** (`role: webmail`).
- Le reste inchangé : copie (`CopyIconBtn`), statut live (`StatusBadge`), repli saisie IP en
  échec d'écho, annotation zone externe (`apexNote` / `isExternalHost`).

### i18n — `src/i18n/resources.ts`

Nouveau bloc `wizard.dns.hostAddress.role.{mail,apex,webmail}` (fr + en). Libellés français,
miroir anglais.

## Flux de données

```
hostAddressStatusFn({ipv4, ipv6})
  → getPrimaryDomain() → domain.dnsZoneFile
  → parseZoneFile(dnsZoneFile) = zoneRecords
  → buildHostRecords({ zoneRecords, hostname=resolveServerHostname(PUBLIC_URL,domain), domain, ipv4, ipv6 })
       = HostRecord[] (avec rôle, A + AAAA)
  → resolveRecordStatus par record → { …, role, status }
  → UI groupe par rôle
```

## Cas limites

| Cas | Comportement |
|---|---|
| MX/SRV/CNAME pointent le même hôte | Dédupliqué → un seul groupe `mail` |
| Cible = apex (MX → domaine nu) | `mail` = apex ; pas de doublon `apex` |
| `hostname` (PUBLIC_URL) == cible mail | Pas de doublon `webmail` |
| Cible hors zone gérée (ex. MX → `mail.autre.fr`) | A/AAAA produits + annotation « créez-le chez le gestionnaire de cette zone » |
| Zone vide (début setup) | Repli `webmail` (hostname) + `apex` |
| Valeur MX/SRV malformée | Token vide → ignoré (filtré) |
| Pas d'IPv6 détectée | Aucun AAAA (mais A présents) ; IPv6 réapparaît dès qu'elle est détectée |

## Stratégie de test (cœur pur)

| Unité | Cas |
|---|---|
| `collectHostTargets` | MX seul ; MX+SRV+CNAME même hôte (dédup) ; valeur malformée ignorée ; types non pertinents ignorés (TXT/CAA/DKIM) |
| `buildHostRecords` | rôle `mail` depuis la cible MX ; `apex` ajouté si distinct ; `webmail` si distinct ; dédup nom ; **A + AAAA quand ipv6 fourni** ; zone vide → repli hostname+apex ; cible = apex (pas de doublon) |
| `resolveRecordStatus` | inchangé (déjà couvert A/AAAA) |

Handlers/server functions restent fins (non testés unitairement). Avant PR :
`bun run lint && bun run typecheck && bun run test`.

## Non-régression

- Apex et webmail restent couverts (comportement #61 préservé) ; on **ajoute** la garantie du A
  du serveur mail (cible MX) et l'étiquetage par rôle.
- IPv6 traitée à égalité d'IPv4 pour chaque rôle.
- `dns-resolve`, le portal Combobox, le layout, la découverte d'IP : intouchés.

## Hors-scope

- Auto-création DNS chez un fournisseur (toujours périmètre B : guidage seul).
- Modification de ce que Stalwart publie (on lit la zone, on ne la change pas).
- Choix interactif du sous-domaine mail dans le wizard (le `serverHostname` est fixé au
  bootstrap ; on guide ce qui est publié).
