# Stalwart v0.16 — API Capture (repérage empirique)

> Capturé le 2026-06-09 contre `stalwartlabs/stalwart:v0.16` (version réelle **0.16.8**),
> volume vierge, `STALWART_RECOVERY_ADMIN=stalmail-admin:<secret>`, port management `8080`.
> Ces enregistrements sont la **source de vérité** pour les tests du Plan 2a (fixtures).

## 1. Transport JMAP management

- **Session** : `GET /jmap/session` (Basic auth). `/.well-known/jmap` → 307 vers `/jmap/session`.
- **API** : `POST /jmap/` avec l'enveloppe JMAP standard.
- **Capability management** : `urn:stalwart:jmap`. L'`accountId` à utiliser =
  `session.primaryAccounts["urn:stalwart:jmap"]` (ex. `"d333333"`).
- **Auth** : `Authorization: Basic base64(STALWART_RECOVERY_ADMIN)`.
- **Health** : `GET /healthz/live` → 200.

Enveloppe requête :
```json
{ "using": ["urn:stalwart:jmap"],
  "methodCalls": [["x:Object/method", { "accountId": "d333333", ... }, "0"]] }
```
Enveloppe réponse :
```json
{ "methodResponses": [["x:Object/method", { ... }, "0"]], "sessionState": "..." }
```
Erreur méthode : `["error",{"type":"unknownMethod","description":"..."},"0"]`.
Erreur set : `notCreated/notUpdated: { "<id>": {"type":"invalidProperties","description":"...","properties":["..."]} }`.

## 2. Cycle de vie bootstrap (CONFIRMÉ)

1. **Volume vierge, pas de `config.json` → mode bootstrap.** Log :
   `WARN Server started in bootstrap mode (...) version = "0.16.8"`, listener `http-recovery` sur 8080.
   En bootstrap, **seul `x:Bootstrap` est accessible** — tout autre type renvoie :
   `{"type":"forbidden","description":"The server is in bootstrap mode. Only the 'Bootstrap' object type can be accessed until the bootstrap process is complete."}`
2. **`x:Bootstrap/get`** → singleton (`id:"singleton"`) avec valeurs par défaut
   (`directory:Internal`, `dnsServer:Manual`, stores RocksDB, `requestTlsCertificate:true`…).
3. **`x:Bootstrap/set`** (update `singleton`) → écrit `config.json`, **génère un admin
   `admin@<defaultDomain>` + renvoie son secret UNE fois**, crée le domaine + DKIM.
   Réponse : `{"updated":{"singleton":{"username":"admin@spike.test","secret":"<generated>"}}}`.
   **⚠ Le process reste en mode bootstrap** — `x:Domain` reste `forbidden`.
4. **Redémarrage du process Stalwart** (relecture de `config.json`) → **mode normal**.
   `x:Domain/query` fonctionne désormais. → l'entrypoint DOIT relancer Stalwart après le submit.
5. Le process **ne se relance PAS tout seul** au submit (le container reste `Up healthy`).
   La supervision de l'entrypoint n'est donc pas déclenchée par le submit ; il faut un
   redémarrage explicite.

`config.json` écrit ne contient que le dataStore :
`{"@type":"RocksDb","path":"/var/lib/stalwart/","blobSize":16834,"bufferSize":134217728,"poolWorkers":null}`
(le reste de la config vit en base.)

## 3. Objet `x:Bootstrap` — champs (depuis le schéma serveur)

| Champ | Type | update |
|---|---|---|
| `serverHostname` | string | mutable |
| `defaultDomain` | string | mutable |
| `requestTlsCertificate` | boolean | mutable |
| `generateDkimKeys` | boolean | mutable |
| `directory` | x:DirectoryBootstrap (`Internal`/`Ldap`/`Sql`/`Oidc`) | mutable |
| `dnsServer` | x:DnsServerBootstrap (multi-variant) | mutable |
| `dataStore`/`blobStore`/`searchStore`/`inMemoryStore` | stores | mutable |
| `tracer` | x:Tracer | mutable |
| `username` | emailAddress | **serverSet** (admin généré) |
| `secret` | secret | **serverSet** |

→ **Le Bootstrap ne collecte PAS le compte admin de l'utilisateur** : `username`/`secret`
sont générés par le serveur. Le compte utilisateur se crée en mode normal (§5).

Payload minimal soumis (validé) :
```json
{"serverHostname":"mail.exemple.fr","defaultDomain":"exemple.fr",
 "requestTlsCertificate":false,"generateDkimKeys":true,
 "directory":{"@type":"Internal"},"dnsServer":{"@type":"Manual"}}
```

## 4. Domaine en mode normal — `x:Domain`

`x:Domain/query` → ids, puis `x:Domain/get`. Champs clés :
- `name`, `isEnabled`, `dkimManagement` (Automatic après bootstrap),
  `dnsManagement` (`@type:Manual` par défaut), `certificateManagement`.
- **`dnsZoneFile`** (text, serverSet) : texte complet des enregistrements gérés
  (DKIM ed25519 + rsa, SPF, MX, DMARC, SRV `_caldavs/_carddavs/_imaps/_jmap`…).
  → **source de la grille par-record** + contenu copier-coller du mode Manuel.

Activer l'automatique : `x:Domain/set` update, champ `dnsManagement` =
```json
{"@type":"Automatic","dnsServerId":"<id>","origin":"exemple.fr",
 "publishRecords":[...]}   // DnsRecordType
```
(`x:DnsManagementProperties` : `dnsServerId`, `origin`, `publishRecords`.)

## 5. Compte admin en mode normal — `x:Account` (variant `User`)

Bootstrap auto-crée `admin@<domaine>` : `x:Account` id `b`, `@type:User`,
`roles:{"@type":"Admin"}`, `permissions:{"@type":"Inherit"}`, `description:"System administrator"`.

Créer un utilisateur : `x:Account/set` create. **`emailAddress` est serverSet**
(dérivé de `name` + `domainId`) — ne pas l'envoyer. Envelope validée :
```json
{"@type":"User","name":"koffi","domainId":"b",
 "credentials":{"0":{"@type":"Password","secret":"<mot de passe>"}}}
```
**La force du mot de passe est validée côté serveur** (zxcvbn-like) : un mot de passe
faible renvoie `{"type":"invalidProperties","properties":["secret"],
"description":"Password is too weak. ..."}`. Pour donner le rôle admin :
`roles:{"@type":"Admin"}`.

## 6. Fournisseurs DNS — `x:DnsServer`

`x:DnsServer/set` create, variante par `@type`. Champ credential = **`secret`**
(x:SecretKey), + champs communs `description`, `email?`, `ttl`, `pollingInterval`,
`propagationDelay`, `propagationTimeout`, `timeout`. Ex. Cloudflare :
```json
{"@type":"Cloudflare","description":"...","secret":"<api-token>"}
```

**71 variantes** dans l'enum `DnsServerBootstrapType` (≫ 10) :
Manual, Tsig, Cloudflare, DigitalOcean, DeSEC, Ovh, Bunny, Porkbun, Dnsimple,
Spaceship, Route53, GoogleCloudDns, Alidns, ArvanCloud, Autodns, AzureDns,
BaiduCloud, BluecatV2, ClouDns, Constellix, Cpanel, Ddnss, DnsMadeEasy, Domeneshop,
Dreamhost, DuckDns, Dynu, EasyDns, EdgeDns, Exoscale, FreeMyIp, GandiV5, Gcore,
Glesys, Godaddy, Hetzner, HostingDe, Hostinger, HuaweiCloud, Hurricane, IbmCloud,
Infoblox, Infomaniak, Inwx, Ionos, Ipv64, Joker, Lightsail, Linode, LuaDns,
MythicBeasts, Namecheap, NameDotCom, NameSilo, Netcup, Netlify, Nifcloud, Ns1,
OracleCloud, Plesk, Safedns, Scaleway, TencentCloud, Transip, UltraDns, Vercel,
Volcengine, Vultr, WebSupport, YandexCloud.

→ Le wizard doit lister depuis le schéma serveur (`GET /api/schema` → 302 vers
`/api/schema/<token>`, JSON gzip, enum `DnsServerBootstrapType`), pas hardcoder.

## 7. Enums DNS (depuis le schéma)

- **`DnsPublishStatus`** : `synced` (All records published), `pending` (in progress),
  `failed`, `unknown` (not yet determined). → statut de publication **natif** côté
  Stalwart, à exploiter pour la grille (à confirmer où il est exposé par-record).
- **`DnsRecordType`** (12) : `dkim`, `tlsa`, `spf`, `mx`, `dmarc`, `srv`, `mtaSts`,
  `tlsRpt`, `caa`, `autoConfig`, `autoConfigLegacy`, `autoDiscover`.
- **`DnsManagementType`** : `Manual`, `Automatic`.

## 8. À vérifier en mode normal lors du Plan 2a

- Où est exposé `DnsPublishStatus` par type de record (sur `x:Domain` une fois
  `dnsManagement=Automatic` ? via un read dédié ? via la Task `DnsManagement` ?).
  Si exposé par-record → la grille se remplit depuis Stalwart, la résolution DNS BFF
  devient un complément optionnel.
- Méthode exacte de déclenchement ACME en mode normal (`x:Task` `DnsManagement` avec
  `onSuccessRenewCertificate`, ou `certificateManagement`/AcmeProvider).
- Endpoint/route de redémarrage Stalwart propre déclenché par l'entrypoint après submit.

## 9. ACME / SSL & Task — repérage live (Plan 2b-ii étape B, v0.16.8)

Repérage empirique en mode normal (domaine `dupont.fr`, id `b`) via la JMAP management
(`urn:stalwart:jmap`, auth recovery-admin). **Corrige les hypothèses du design UI** —
les formes devinées (challengeType objet, contact array, SAN array, renewBefore ms)
étaient toutes invalides.

### `x:AcmeProvider/set` (create)

Forme **acceptée** (champs `notCreated.properties` révèlent les rejets) :

```json
{
  "directory": "https://acme-v02.api.letsencrypt.org/directory",
  "challengeType": "TlsAlpn01",
  "contact": { "mailto:admin@dupont.fr": true }
}
```

- `challengeType` : **enum string** (PAS `{"@type":...}`). Valeur confirmée `TlsAlpn01`
  (Let's Encrypt + port 443). Autres valeurs supposées : `Dns01`, `Http01`, `DnsPersist01`.
- `contact` : **map** `{ "mailto:<email>": true }` (PAS un array ; clé = URI `mailto:`,
  valeur `true`). Une clé email nue (`"admin@dupont.fr"`) est acceptée par le schéma mais
  rejetée à l'enregistrement ACME. « At least one contact email is required » si absent.
- `renewBefore` : **optionnel**, enum (défaut `"R23"`). Un nombre/durée string est rejeté.
  → on l'omet.
- `maxRetries` : défaut `10`.
- Réponse `created` → `{ "id": "<providerId>" }`. Le `/get` canonique expose en plus
  `accountKey` (masqué `****`), `accountUri`, `memberTenantId`.
- ⚠ La création **contacte réellement** le directory ACME (enregistrement de compte) :
  nécessite un accès réseau sortant ; échoue si le directory est injoignable.

### `x:Domain/set` (update `certificateManagement`)

Défaut : `{ "@type": "Manual" }`. Bascule automatique :

```json
{ "certificateManagement": {
    "@type": "Automatic",
    "acmeProviderId": "<providerId>",
    "subjectAlternativeNames": { "mail.dupont.fr": true }
} }
```

- `subjectAlternativeNames` : **map** `{ "<host>": true }` (PAS un array) ; **optionnel**.
- `acmeProviderId` : l'id retourné par `x:AcmeProvider/set`.
- Poser `Automatic` planifie immédiatement une task `AcmeRenewal`.

### `x:Task/query` + `x:Task/get` (suivi ACME)

```json
{
  "@type": "AcmeRenewal",
  "domainId": "b",
  "status": { "@type": "Pending", "createdAt": "...", "due": "..." },
  "due": "...",
  "id": "<taskId>"
}
```

- Filtrer/identifier par `@type === "AcmeRenewal"` (et `domainId`).
- `status.@type` ∈ `Pending` | `Retry` | `Failed` (et vraisemblablement `Completed`/actif).
- **Non-bloquant** : en sandbox dev (pas d'IP publique / 443 joignable depuis Internet),
  le challenge TLS-ALPN ne peut aboutir → la task reste `Pending`/`Failed` ; l'UI laisse
  continuer (Stalwart réessaie, `:8080/admin` reste accessible).
