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
- **Soumettre l'objet `Bootstrap` termine le bootstrap** : Stalwart écrit la
  config, crée le compte admin permanent, provisionne le reste, puis **redémarre
  en mode normal**. Le compte temporaire de bootstrap ne s'applique plus ensuite.

### Conséquence

Le wizard ne peut **pas** muter Stalwart étape par étape pendant le bootstrap (le
seul objet disponible est `Bootstrap`). Le flux devient :

```
COLLECTE (aucune mutation)  →  1 submit Bootstrap  →  MONITORING (mode normal)
```

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
- **Superviser le redémarrage post-bootstrap** : à la fin du bootstrap, Stalwart
  bascule en mode normal. Vérifier empiriquement si le process est relancé (auquel
  cas l'actuel `wait -n` ferait sortir le container) et adapter la supervision en
  conséquence.

> Point à confirmer à l'implémentation : comportement exact du redémarrage
> (re-exec du process vs reconfiguration interne). Voir Smoke test §9.

## 5. Structure du wizard

### Phase Collecte (aucune mutation Stalwart, validation locale uniquement)

| Étape | Contenu |
|---|---|
| 1. Bienvenue | Choix de langue, bouton Commencer. |
| 2. Domaine | Saisie du hostname public (`mail.exemple.fr`) et du domaine mail (`exemple.fr`). Vérification DNS **optionnelle et non bloquante** : warning si le A/AAAA record du hostname ne pointe pas (encore) sur l'IP de ce serveur. L'enregistrement A reste à la charge de l'utilisateur (Stalwart ne le publie pas — il ne connaît pas l'IP publique). |
| 3. Provider DNS | Sélection parmi les **10 providers d'API hébergée** réellement supportés par Stalwart v0.16 : Cloudflare, AWS Route 53, Google Cloud DNS, OVH, deSEC, DigitalOcean, Bunny DNS, Porkbun, DNSimple, Spaceship — ou **Manuel**. Saisie de la clé API / credentials selon le provider. ([providers](https://stalw.art/docs/server/dns/provider)) |
| 4. Compte admin | Nom complet, adresse email, mot de passe (indicateur de force). Premier utilisateur, doté des permissions d'administration. |
| 5. Récap | Récapitulatif des saisies avant soumission. |

### Soumission

Le BFF construit et soumet **un seul** objet `Bootstrap` :

```jsonc
{
  "serverHostname": "mail.exemple.fr",   // requis
  "defaultDomain": "exemple.fr",          // requis
  "generateDkimKeys": true,               // défaut
  "requestTlsCertificate": false,         // ACME déclenché plus tard, post-DNS
  "directory": { "@type": "Internal" },   // annuaire interne
  // + compte admin (nom, email, mot de passe)
  // stores: défauts RocksDB (dataStore/blobStore/searchStore/inMemoryStore)
}
```

`requestTlsCertificate` est mis à **`false`** : ACME ne doit se déclencher
qu'**après** la publication DNS, sinon le challenge échoue faute de DNS prêt.

Stalwart écrit la config, crée l'admin, provisionne, **redémarre en mode normal**.

### Phase Monitoring (mode normal)

| Étape | Contenu |
|---|---|
| 6. DNS | Le BFF crée un objet `DnsServer` (variante du provider choisi + credentials) puis configure `Domain.dnsManagement = Automatic` avec `dnsServerId` → Stalwart publie le jeu d'enregistrements. **Grille par-record live** (voir §6). En mode Manuel : affichage du champ `Domain.dnsZoneFile` à copier-coller (pas de `DnsServer`). |
| 7. SSL | Déclenche l'obtention du certificat ACME (task `DnsManagement` avec `onSuccessRenewCertificate`, ou requête de certificat). Affiche le statut de la task (`Pending` / `Retry` / `Failed` / succès) + `failureReason` en cas d'échec. ([tasks](https://stalw.art/docs/management/tasks-actions/tasks)) |
| 8. Terminé | Récap (domaine, SSL, compte). Rappel backup `stalmail-data`. Pose le flag `/var/lib/stalwart/.stalmail-configured`. Bouton « Ouvrir ma boîte mail » → `/login`. |

## 6. Grille DNS par type de record (étape 6)

Stalwart n'expose qu'un statut **global** par task (`Pending`/`Retry`/`Failed`),
pas un statut par record. La grille par-record est donc reconstruite par le BFF à
partir de deux sources :

- **Lignes + valeurs attendues** : parsing du champ `Domain.dnsZoneFile`, qui
  contient le texte de tous les enregistrements gérés par Stalwart (DKIM, SPF, MX,
  DMARC, SRV, MTA-STS, TLS-RPT, CAA, autoconfig, autoconfig legacy, autodiscover).
  Ce même texte sert de contenu copier-coller pour le mode Manuel.
  ([dns-records](https://stalw.art/docs/domains/dns-records))
- **Statut live par ligne** : le BFF **résout le DNS lui-même** par type et compare
  à l'attendu :
  - `✓ vérifié` — record présent et conforme
  - `⚠ différent` — record présent mais valeur différente
  - `⏳ propagation` — pas encore visible (Stalwart fait aussi sa propre vérif via
    `propagationDelay` / `pollingInterval` / `propagationTimeout`)
  - `✕ absent` — record manquant

Le statut global de la task `DnsManagement` est affiché en complément (ex. échec
d'authentification provider → `failureReason`).

## 7. Reprise du wizard (dérivation d'état)

**Pas d'état de wizard persisté séparément.** L'état réel vit déjà dans Stalwart.
Au chargement de `/setup`, le BFF dérive l'étape courante depuis l'état réel :

1. Mode bootstrap actif (pas de `config.json`) → phase Collecte.
2. Mode normal, mais `Domain.dnsManagement` non configuré → étape 6 (DNS).
3. DNS configuré mais pas de certificat valide → étape 7 (SSL).
4. Tout OK mais flag `.stalmail-configured` absent → étape 8 (Terminé).
5. Flag présent → le wizard est terminé (redirect `/login`).

Cette approche est robuste aux fermetures de navigateur **et** au redémarrage du
container provoqué par la fin du bootstrap.

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
