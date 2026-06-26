# Guidage A/AAAA dans l'étape DNS du wizard — Design

- **Date** : 2026-06-26
- **Issue** : #61
- **Statut** : validé en brainstorming
- **Cycle** : spec → plan → implémentation → revue (revue sécurité incluse)

## Contexte & problème

Stalwart ne publie **jamais** les enregistrements A/AAAA d'un domaine, même en gestion DNS
automatique. Confirmé par la doc v0.16 : l'enum `DnsRecordType` (valeurs autorisées de
`publishRecords`) est `dkim, tlsa, spf, mx, dmarc, srv, mtaSts, tlsRpt, caa, autoConfig,
autoConfigLegacy, autoDiscover` — **ni `a` ni `aaaa`**. Logique : le A exige l'IP publique de
l'hôte, hors périmètre d'un Stalwart conteneurisé.

Conséquence observée en validation réelle : `mail.getstalmail.com` et `getstalmail.com`
n'avaient aucune adresse → MX/CNAME/SRV pointaient dans le vide et `https://getstalmail.com`
était injoignable. Le wizard ne guidait pas l'opérateur à créer ces A/AAAA.

Le guidage actuel (`src/components/setup/steps/DnsStep.tsx`) ne couvre l'A que via
`hasExternalA` — c.-à-d. **seulement si un A existe déjà** dans une zone externe. Il ne couvre
pas le cas général « aucun A ne résout », qui est précisément le bug.

## Objectif

Garantir que le hostname mail (et l'apex du domaine) disposent d'un A (et d'un AAAA si une
IPv6 publique existe) pointant vers l'IP du serveur, en **guidant** l'opérateur — pré-rempli,
copiable, vérifié en live — **sans jamais écrire automatiquement** chez un fournisseur DNS.

## Décision de cadrage

Parmi les options de l'issue (A : Cloudflare auto + guidage ; B : guidage seul ;
C : multi-fournisseurs auto), on retient **B — guidage intelligent seul**.

Conséquences directes :

- **Pas de connecteur d'écriture DNS** par fournisseur.
- **Pas de réutilisation sortante du token DNS** → la principale préoccupation sécurité de
  l'issue disparaît. On n'ajoute que de la **lecture** (écho IP + résolution DNS).

Décisions associées (issues du brainstorming) :

| Sujet | Décision |
|---|---|
| Source de l'IP publique | Appel sortant du BFF vers un service d'écho IP |
| Échec de l'écho | Fallback : champ de saisie manuelle de l'IP (jamais bloquant) |
| Placement du guidage | Section dédiée affichée dans **les deux modes** (Manuel et Automatique) |
| Apex | Guider A/AAAA pour le **hostname ET l'apex** quand ils diffèrent |
| IPv6 / AAAA | Guider le AAAA **uniquement si une IPv6 est détectée** (A toujours) |
| `install.sh` | **Non modifié** — la découverte se fait au runtime via l'écho |

## Architecture & flux

Stalwart ignorant A/AAAA, leur valeur attendue ne provient **pas** du `dnsZoneFile` : c'est une
**source Stalmail** issue de l'écho IP. Elle vit dans un flux parallèle à la grille existante.

```
DnsStep (montage)
  └─ discoverServerIpFn()        (1 appel sortant, timeout ~3s, primaire + secours)
        ok   → serverIp = { ipv4, ipv6? }
        KO   → ipManual = ""    (champ de saisie manuelle affiché)
  └─ buildHostRecords(hostname, domain, ip)   [fonction pure]
  └─ tick 5s (existant) :
        gridStatusFn()            (records Stalwart, inchangé)
        hostAddressStatusFn({ipv4, ipv6})   (A/AAAA, nouveau flux)
            → chaque record : verified | pending(missing) | error(mismatch)
```

## Composants

### Serveur (`src/server/`)

**`server-ip.ts` (nouveau) — découverte IP**
- `discoverServerIp()` (impur) : appel sortant écho IPv4 puis IPv6, timeout court (~3 s),
  service primaire + un secours défensif, puis abandon. Retourne
  `{ ipv4: string | null, ipv6: string | null }`. N'émet jamais d'exception fatale.
- `parseEchoResponse(text)` (**pur, testé**) : extrait l'IP d'une réponse type ipify (IP nue)
  ou Cloudflare trace (`ip=` clé/valeur).
- URL(s) d'écho en constante, surchargeables via env `STALMAIL_IP_ECHO_URL` (air-gapped/CI).

**`dns-host-records.ts` (nouveau) — cœur pur testé**
- `buildHostRecords({ hostname, domain, ipv4, ipv6 })` (**pur, testé**) → liste des A/AAAA
  attendus :
  - A pour le hostname (si `ipv4`) ; AAAA pour le hostname (si `ipv6`).
  - A/AAAA pour l'apex `domain` lorsque `hostname !== domain`.
  - Aucune ligne AAAA si `ipv6` absent.
  - Annote une cible hors zone gérée via `isExternalHost` / `hostZone`
    (`src/components/setup/host-utils.ts`).

**`dns-resolve.ts` (étendu)**
- Support **A/AAAA** : `resolve4` / `resolve6`, comparaison à l'IP attendue →
  `verified | mismatch | missing`. Seule famille dont la valeur attendue vient de Stalmail.

**`setup-actions.ts` (étendu) — deux server functions**
- `discoverServerIpFn()` : enveloppe `discoverServerIp()`. Retourne `{ ipv4, ipv6 }` ; écho KO
  → `{ null, null }` (pas de code d'erreur setup, pas de blocage).
- `hostAddressStatusFn({ ipv4?, ipv6? })` : Zod valide des IP syntaxiquement correctes
  (`z.string().ip()`), construit les records attendus via `buildHostRecords`, renvoie leur
  statut live via `dns-resolve`. Appelée par le polling client en parallèle de `gridStatus`.

> L'IP attendue circule client → serveur pour la vérification (issue de l'écho ou de la
> saisie). Ce n'est pas un secret ; elle est re-validée comme IP valide côté serveur. Pas de
> réutilisation de token, pas d'écriture DNS → surface de sécurité minime.

### Client (`src/components/setup/steps/DnsStep.tsx`)

- Au montage : `discoverServerIpFn()` → state `serverIp`. Échec → state `ipManual` + champ de
  saisie (format IP validé).
- Nouvelle **section « Adresse du serveur »** (composant présentationnel, props injectées),
  rendue dans **les deux modes**, juste avant la grille : records A/AAAA pré-remplis, copiables
  (réutilise `CopyIconBtn`), badge de statut (`StatusBadge`).
- Polling : ajoute `hostAddressStatusFn` au tick 5 s existant ; fusionne dans l'avancement
  global (`taskStatus`).
- L'ancien guidage `hasExternalA`/`extNote` n'est plus l'unique porte : `extNote` devient une
  annotation de la ligne concernée quand la cible est hors zone gérée (mode auto).
- La section **informe sans bloquer** `onNext` (cohérent avec MX/SPF/etc. qui peuvent être
  `pending` au moment de continuer).

### i18n (`src/i18n/resources.ts`)
- Nouveau bloc `wizard.dns.hostAddress.*` : `title`, `hint`, `discovering`, `echoFailed`,
  `manualLabel`, `manualHelp`, `apexNote` ; réutilise `recordStatus.*`. Libellés en français.

## États de la section « Adresse du serveur »

| Situation | Affichage |
|---|---|
| Écho en cours | spinner + `hostAddress.discovering` |
| Écho OK, A absent du DNS | record pré-rempli, badge `pending` |
| Écho OK, A résout vers une autre IP | record + badge `error` (mismatch) + IP réellement résolue |
| Écho OK, A correct | badge `verified` |
| Pas d'IPv6 détectée | aucune ligne AAAA (silencieux) |
| Écho KO | `hostAddress.echoFailed` + champ saisie IP manuelle → recalcule les records |
| Cible hors zone gérée (auto) | annotation `extNote` sur la ligne concernée |

## Gestion d'erreurs

- `discoverServerIp` n'échoue jamais côté server function (catch → `{ null, null }`) : pas de
  code d'erreur setup, pas de blocage de l'étape.
- `hostAddressStatusFn` : IP invalide en entrée → Zod rejette → le client retombe sur la saisie
  manuelle. Échec de résolution DNS d'un record → `pending` (pas une erreur d'étape).
- L'étape DNS reste franchissable même si A/AAAA ne sont pas encore `verified`.

## Non-régression

- Aucune modification des contrats `createDnsServer` / `setDnsManagement*` ni du token.
- `gridStatusFn` inchangé ; A/AAAA vivent dans un flux parallèle car leur valeur attendue n'est
  pas dans le `dnsZoneFile`.

## Stratégie de test

Cœur = fonctions pures, conforme aux conventions du projet.

| Unité | Fichier test | Cas couverts |
|---|---|---|
| `parseEchoResponse` | `server-ip.test.ts` | IPv4 nue, IPv6, réponse Cloudflare trace (`ip=`), espaces/retours, entrée vide/bruitée → `null` |
| `buildHostRecords` | `dns-host-records.test.ts` | host = apex (1 cible), sous-domaine (host + apex), sans IPv6 (pas de AAAA), zone externe (annotation), IP manquante |
| résolution A/AAAA | `dns-resolve.test.ts` | `verified` / `mismatch` (renvoie l'IP résolue) / `missing`, en mockant `dns/promises` |

- Pas de test d'intégration réseau réel pour l'écho (appel sortant mocké).
- Les handlers / server functions restent fins (Zod + délégation), non testés unitairement.
- Avant PR : `bun run lint && bun run typecheck && bun run test`.

## Hors-scope

- Auto-création A/AAAA chez un fournisseur (options A/C de l'issue) — écarté ; on reste sur le
  guidage (B).
- Fiabilisation de l'IP dans `install.sh` — la découverte se fait au runtime via l'écho ;
  `install.sh` n'est pas touché (l'IP y reste informative pour l'URL du wizard).
- Vérification de joignabilité applicative (HTTPS de l'apex, port 25/465) — limité à la
  résolution DNS A/AAAA.
- Champ d'override manuel quand l'écho réussit — saisie manuelle uniquement en fallback d'échec.
- Multi-IP / round-robin, IP flottantes/anycast — on prend la première IP retournée par l'écho.
