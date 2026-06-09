# Stalmail Setup Wizard — Design Document

> Cible : **Stalwart v0.16** (tag image `stalwartlabs/stalwart:v0.16`, dernière 0.16.4).
> Ce document remplace la section « 6. Setup Wizard » du design global
> (`2026-06-08-stalmail-design.md`) après validation factuelle contre la doc v0.16.

## 1. Vision

Le wizard configure une installation Stalwart neuve en partant de zéro, sans que
l'utilisateur touche à la ligne de commande ni à l'API admin. Le BFF (TanStack
Start) pilote Stalwart pour son compte. À la fin, l'utilisateur a un serveur mail
fonctionnel (domaine, DNS, DKIM, SSL, compte admin) et arrive sur `/login`.

## 2. Contrainte d'architecture : le mode bootstrap v0.16

La version 0.16 (« A New Foundation ») déplace **toute la configuration en base de
données**. Cela impose un cycle de vie que le design initial ignorait :

- **Premier démarrage sans `config.json` → mode bootstrap.** Aucun service mail
  n'est lancé. Stalwart sert uniquement la WebUI + l'API management sur le port
  `8080` (configurable via `STALWART_RECOVERY_MODE_PORT`). La JMAP API est
  **restreinte à un seul type d'objet : `Bootstrap`**.
  ([bootstrap-mode](https://stalw.art/docs/configuration/bootstrap-mode/))
- **On ne pré-crée pas de fichier de config.** Lancer l'image telle quelle suffit
  à déclencher le bootstrap. Le démarrage Docker officiel v0.16 n'utilise
  **aucun** `--init` ni `--config`.
  ([docker install](https://stalw.art/docs/install/platform/docker/))
- **Soumettre l'objet `Bootstrap` écrit la config** (`config.json`) et génère un
  compte admin technique `admin@<domaine>` (`username`/`secret` sont *serverSet* —
  voir ci-dessous). **⚠ Vérifié empiriquement** : le process **ne bascule PAS tout
  seul** en mode normal — il faut **redémarrer le process Stalwart** pour qu'il
  relise `config.json` et démarre les services mail. Voir
  [`2026-06-09-stalwart-api-capture.md`](2026-06-09-stalwart-api-capture.md).

### Conséquence

Le wizard ne peut **pas** muter Stalwart étape par étape pendant le bootstrap (le
seul objet disponible est `Bootstrap` ; tout autre type renvoie `forbidden`). Le
flux devient :

```
COLLECTE (aucune mutation)  →  submit Bootstrap  →  RESTART Stalwart  →  MONITORING (mode normal)
```

Point important : le compte admin de l'**utilisateur** (son email + mot de passe)
n'est **pas** un champ du Bootstrap (les champs `username`/`secret` du Bootstrap
sont *serverSet* et produisent un admin technique `admin@<domaine>`). Le compte
utilisateur se crée donc en **mode normal**, via `x:Account/set` (variant `User`,
rôle `Admin`), pendant la phase monitoring.

## 3. Authentification BFF → Stalwart

- L'entrypoint pinne `STALWART_RECOVERY_ADMIN=stalmail-admin:<STALMAIL_SECRET>`
  (généré à l'installation, jamais exposé à l'utilisateur). Quand cette variable
  est définie, **aucun mot de passe temporaire n'est généré** ; la valeur fournie
  est utilisée. ([bootstrap-mode](https://stalw.art/docs/configuration/bootstrap-mode/))
- Le BFF parle à Stalwart en **JMAP management** (types préfixés `x:`, capability
  `urn:stalwart:jmap`) sur `http://localhost:8080`, en auth Basic avec ce
  credential. ([cli](https://stalw.art/docs/management/cli/))
- Ce credential reste valable tant que `STALWART_RECOVERY_ADMIN` est défini, y
  compris après le passage en mode normal (`http://host:8080/admin` reste
  accessible). Le BFF garde donc le même `STALWART_URL=:8080` sur tout le wizard.
- Post-wizard (Plan 3), les appels passeront par le token OAuth de l'utilisateur
  admin ; le credential de bootstrap n'est plus sollicité.

**⚠ Durcissement à prévoir (post-setup, hors Plan 2a).** Comme `STALWART_RECOVERY_ADMIN`
reste défini pendant toute la vie du container, l'endpoint management privilégié sur
`:8080` demeure joignable indéfiniment — c'est un credential permanent. La doc Stalwart
recommande de **désactiver le listener HTTP / le recovery admin une fois le setup
terminé**. À câbler dans l'étape « Terminé » (Plan 2b) : après `markSetupComplete()`,
le BFF déclenche la désactivation (et/ou l'entrypoint cesse d'exporter le credential au
prochain démarrage une fois le flag `.stalmail-configured` présent). Tracé ici pour ne
pas l'oublier ; non implémenté en 2a car l'étape de finalisation vit en 2b.

## 4. Correction de l'entrypoint (inclus dans ce plan)

L'`entrypoint.sh` actuel (Plan 1) utilise un modèle **pré-0.16** incompatible :

```bash
stalwart --init /etc/stalwart            # crée config.toml — modèle legacy
stalwart --config /etc/stalwart/config.toml
```

Avec ce modèle, Stalwart n'entre jamais en mode bootstrap et le wizard est
inopérant. Correctifs à apporter dans ce plan :

- Lancer `stalwart` **sans `--init`** ni `--config` pré-fabriqué → laisse le
  bootstrap se déclencher sur volume vierge.
- Conserver `STALWART_RECOVERY_ADMIN` défini en permanence.
- **Superviser Stalwart en boucle de redémarrage** : le process Stalwart **ne se
  relance pas seul** après le submit Bootstrap (confirmé : `config.json` est écrit
  mais le process reste en bootstrap). L'entrypoint doit donc relancer Stalwart pour
  qu'il passe en mode normal. Modèle retenu : un **superviseur** qui (re)démarre
  Stalwart tant que le container vit ; après le submit, le BFF déclenche le
  redémarrage (envoi de signal au process Stalwart) et le superviseur le relance —
  Stalwart lit alors `config.json` et démarre en mode normal. Le crash d'un *autre*
  process (Caddy, app) reste fatal au container comme aujourd'hui.

> Confirmé empiriquement : pas de re-exec automatique, reconfiguration **non**
> interne — un redémarrage explicite du process est requis. Voir
> [`stalwart-api-capture` §2](2026-06-09-stalwart-api-capture.md).

## 5. Structure du wizard

### Phase Collecte (aucune mutation Stalwart, validation locale uniquement)

| Étape | Contenu |
|---|---|
| 1. Bienvenue | Choix de langue, bouton Commencer. |
| 2. Domaine | Saisie du hostname public (`mail.exemple.fr`) et du domaine mail (`exemple.fr`). Vérification DNS **optionnelle et non bloquante** : warning si le A/AAAA record du hostname ne pointe pas (encore) sur l'IP de ce serveur. L'enregistrement A reste à la charge de l'utilisateur (Stalwart ne le publie pas — il ne connaît pas l'IP publique). |
| 3. Provider DNS | Sélection parmi les **71 variantes** réellement exposées par le schéma Stalwart v0.16 (`DnsServerBootstrapType` : Cloudflare, OVH, Route 53, Google Cloud DNS, Azure, GoDaddy, Hetzner, Gandi, Scaleway, deSEC, DigitalOcean, Bunny, Porkbun, DNSimple, Hurricane, Tsig…) ou **Manuel**. La liste est rendue depuis le schéma serveur, pas hardcodée. Saisie du credential (champ `secret`) selon le provider. |
| 4. Compte admin | Nom complet, adresse email, mot de passe. **Indicateur de force aligné sur la validation serveur** (Stalwart rejette les mots de passe faibles, type zxcvbn). Les valeurs sont seulement *collectées* ici ; le compte est créé en phase monitoring (mode normal). |
| 5. Récap | Récapitulatif des saisies avant soumission. |

### Soumission

Le BFF soumet l'objet `Bootstrap` (update du singleton), **sans compte admin
utilisateur** (champs `username`/`secret` *serverSet*) :

```jsonc
{
  "serverHostname": "mail.exemple.fr",   // requis
  "defaultDomain": "exemple.fr",          // requis
  "generateDkimKeys": true,               // défaut
  "requestTlsCertificate": false,         // ACME déclenché plus tard, post-DNS
  "directory": { "@type": "Internal" },   // annuaire interne
  "dnsServer": { "@type": "Manual" }      // provider configuré en mode normal
  // stores: défauts RocksDB (dataStore/blobStore/searchStore/inMemoryStore)
}
```

`requestTlsCertificate` est mis à **`false`** : ACME ne doit se déclencher
qu'**après** la publication DNS, sinon le challenge échoue faute de DNS prêt.

Stalwart écrit `config.json` et génère l'admin technique `admin@<domaine>`. Le BFF
**déclenche ensuite un redémarrage du process Stalwart** (le process ne bascule pas
seul) ; au redémarrage, Stalwart démarre en **mode normal**.

### Phase Monitoring (mode normal, après redémarrage Stalwart)

| Étape | Contenu |
|---|---|
| 6. Compte admin | Le BFF crée le compte utilisateur via `x:Account/set` (variant `User` : `name` + `domainId` + `credentials` Password, rôle `Admin`). `emailAddress` est *serverSet* (dérivé de `name`+`domainId`). Mot de passe trop faible rejeté côté serveur → retour à la saisie. |
| 7. DNS | Mode automatique : le BFF crée un `DnsServer` (variante provider + credential `secret`) puis met `Domain.dnsManagement = Automatic` (`dnsServerId`, `origin`, `publishRecords`) → Stalwart publie. **Grille par-record live** (voir §6). Mode Manuel : affichage de `Domain.dnsZoneFile` à copier-coller (pas de `DnsServer`). |
| 8. SSL | Déclenche l'obtention du certificat ACME (task `DnsManagement` + `onSuccessRenewCertificate`, ou `certificateManagement`). Statut de la task (`Pending`/`Retry`/`Failed`/succès) + `failureReason`. ([tasks](https://stalw.art/docs/management/tasks-actions/tasks)) |
| 9. Terminé | Récap (domaine, SSL, compte). Rappel backup `stalmail-data`. Pose le flag `/var/lib/stalwart/.stalmail-configured`. Bouton « Ouvrir ma boîte mail » → `/login`. |

## 6. Grille DNS par type de record (étape 7)

Le repérage a révélé deux enums natifs : **`DnsPublishStatus`** (`synced` / `pending`
/ `failed` / `unknown`) et **`DnsRecordType`** (les 12 types). La grille s'appuie sur
deux sources, dans cet ordre de préférence :

- **Lignes + valeurs attendues** : parsing du champ `Domain.dnsZoneFile` (texte de
  tous les enregistrements gérés par Stalwart). Ce même texte sert de contenu
  copier-coller pour le mode Manuel. ([dns-records](https://stalw.art/docs/domains/dns-records))
- **Statut par ligne** :
  - **Priorité au statut natif Stalwart** (`DnsPublishStatus` par type de record) si
    exposé une fois `dnsManagement=Automatic` (à confirmer au Plan 2a — cf. §8 de
    [`stalwart-api-capture`](2026-06-09-stalwart-api-capture.md)).
  - **Complément/repli : résolution DNS côté BFF** par type, comparée à l'attendu —
    `✓ vérifié` · `⚠ différent` · `⏳ propagation` · `✕ absent`. Utile en mode Manuel
    (pas de statut Stalwart) et pour refléter la propagation publique réelle.

Le statut global de la task `DnsManagement` est affiché en complément (échec
d'authentification provider → `failureReason`).

## 7. Reprise du wizard (dérivation d'état)

**Pas d'état de wizard persisté séparément.** L'état réel vit déjà dans Stalwart.
Au chargement de `/setup`, le BFF dérive l'étape courante depuis l'état réel :

1. Mode bootstrap actif (`x:Domain` renvoie `forbidden`) → phase Collecte.
2. Mode normal, mais aucun compte utilisateur admin → étape 6 (Compte admin).
3. Compte créé, mais `Domain.dnsManagement` non configuré (et mode auto demandé) → étape 7 (DNS).
4. DNS configuré mais pas de certificat valide → étape 8 (SSL).
5. Tout OK mais flag `.stalmail-configured` absent → étape 9 (Terminé).
6. Flag présent → le wizard est terminé (redirect `/login`).

Le mode (bootstrap vs normal) se détecte en sondant un type non-Bootstrap : une
réponse `forbidden` « bootstrap mode » ⇒ encore en collecte. Cette approche est
robuste aux fermetures de navigateur **et** au redémarrage du process Stalwart.

## 8. Gestion des erreurs

- Étapes de collecte : validation locale (format hostname/email, force du mot de
  passe), pas d'effet de bord.
- Soumission Bootstrap : en cas d'échec, message clair ; l'état reste bootstrap,
  l'utilisateur peut corriger et resoumettre.
- Étapes monitoring : chaque opération (DnsServer, Domain, ACME) est observable et
  **réessayable** via le statut de task + `failureReason`. Un échec DNS ne bloque
  pas le compte admin déjà créé.

## 9. Smoke test final

1. Démarrer l'image `stalwartlabs/stalwart:v0.16` sur volumes vierges et **vérifier
   que le mode bootstrap est atteint** (log « bootstrap mode », API `Bootstrap`
   sur `:8080`). Confirme la correction de l'entrypoint.
2. Observer le comportement de **redémarrage post-bootstrap** (process re-exec ou
   non) et valider la supervision de l'entrypoint.
3. Wizard complet de bout en bout avec un domaine de test : collecte → submit →
   grille DNS → SSL → flag posé → redirect `/login`.
4. Recharger `/setup` à différentes étapes et vérifier la **dérivation d'état**.

## 10. Hors scope de ce plan

- Auth OAuth utilisateur et server functions JMAP mail (Plan 3).
- UI webmail (Plan 4).
- Annuaires externes (LDAP/SQL/OIDC) — le wizard utilise l'annuaire interne ;
  l'objet `Bootstrap` les supporte mais c'est hors scope initial.
- Stores externes (PostgreSQL, S3, Redis…) — défauts RocksDB uniquement.

## Références

- [Bootstrap mode](https://stalw.art/docs/configuration/bootstrap-mode/)
- [Objet Bootstrap](https://stalw.art/docs/ref/object/bootstrap)
- [Variables d'environnement](https://stalw.art/docs/configuration/environment-variables/)
- [Administrateurs](https://stalw.art/docs/auth/authorization/administrator/)
- [DNS — vue d'ensemble](https://stalw.art/docs/server/dns/)
- [DNS providers supportés](https://stalw.art/docs/server/dns/provider)
- [DNS records (dnsZoneFile, dnsManagement)](https://stalw.art/docs/domains/dns-records)
- [Objet DnsServer](https://stalw.art/docs/ref/object/dns-server)
- [Tasks (DnsManagement, statuts)](https://stalw.art/docs/management/tasks-actions/tasks)
- [Installation Docker v0.16](https://stalw.art/docs/install/platform/docker/)
- [CLI / API management (JMAP x:)](https://stalw.art/docs/management/cli/)
