# Topologie mail : noms, certificats, politique MTA-STS — Design

**Date** : 2026-08-07
**Origine** : audit du serveur de test (v0.1.48) — le certificat présenté sur les
ports mail ne couvre pas le nom que le serveur annonce, et la politique MTA-STS
publiée en DNS est injoignable en HTTPS.
**Statut** : validé en brainstorming, révisé après relecture critique.
**Contexte** : aucune instance en production ailleurs. Le déploiement de test peut
être détruit et refait — c'est le moment de fixer la topologie avant qu'une
installation réelle n'en dépende.

## Le défaut

Deux noms coexistent, issus de deux sources indépendantes, que rien ne rapproche.

| Valeur | Source | Ce qu'elle devient |
| --- | --- | --- |
| `serverHostname` | saisi dans le wizard, posé au bootstrap (`stalwart-bootstrap.ts:52`) | bannière EHLO de Stalwart, cible MX recommandée par la zone |
| `STALMAIL_PUBLIC_URL` | `.env` | hôte du webmail servi par Caddy **et** SAN du certificat que Stalwart demande (`setup-actions.ts:439-447`) |

Conséquence : **le certificat des ports mail est demandé pour l'hôte du webmail**,
jamais pour le nom sous lequel le serveur mail se présente.

Tant que les deux coïncident, rien ne se voit — et c'est le cas de `.env.example`,
qui pose `STALMAIL_HOSTNAME` et `STALMAIL_PUBLIC_URL` sur le même
`mail.getstalmail.com`. Le défaut n'apparaît que lorsqu'ils divergent, ce que rien
n'interdit ni ne signale : le serveur de test a `STALMAIL_PUBLIC_URL` sur l'apex
(`getstalmail.com`) et un `serverHostname` en `mail.getstalmail.com`. Résultat
mesuré : EHLO annonce `mail.getstalmail.com`, le MX pointe sur
`mail.getstalmail.com`, et le certificat servi sur 25/465/993 porte
`CN=getstalmail.com` avec pour unique SAN `DNS:getstalmail.com`.

Second défaut, de même famille : Stalwart **sert déjà** sa politique MTA-STS sur
`/.well-known/mta-sts.txt` (vérifié : `version: STSv1`, `mode: testing`,
`mx: mail.getstalmail.com`), et le wizard publie le TXT `_mta-sts` ainsi que le
CNAME `mta-sts` issus de la zone Stalwart. Mais la politique doit être servie sur
l'hôte `mta-sts.<domaine>`, pour lequel le `Caddyfile` n'a aucun bloc de site : le
handshake TLS échoue. Le produit publie donc un enregistrement dont il ne dessert
pas la politique — pour tout déploiement, pas seulement celui-ci.

Aucun de ces deux défauts n'est visible aujourd'hui : la politique est en
`mode: testing`, donc aucun expéditeur ne rejette, et un client mail configuré sur
l'apex ne voit pas l'erreur de nom.

## Décisions

1. **Trois rôles nommés, distincts, écrits noir sur blanc.**

   | Rôle | Porté par | TLS servi par |
   | --- | --- | --- |
   | Hôte du webmail | `STALMAIL_PUBLIC_URL` (et `STALMAIL_HOSTNAME` côté Caddy) | Caddy, ACME HTTP-01 |
   | Hôte du serveur mail — cible MX, bannière EHLO | `serverHostname` du wizard | Stalwart, ACME DNS-01 |
   | Domaine des adresses | le domaine créé dans le wizard | — |
   | Hôte de politique `mta-sts.<domaine>` | `STALMAIL_MAIL_DOMAIN` | Caddy, relais vers Stalwart |

   Les deux premiers peuvent être égaux (déploiement sur l'apex) ou différents. Ce
   qui ne doit plus arriver, c'est qu'on les confonde.

2. **Le SAN du certificat Stalwart suit l'identité mail, et se lit à la source.**
   Le `serverHostname` n'est ni redemandé au client, ni recopié dans un fichier
   d'état : il est **relu chez Stalwart** via `getBootstrap()`
   (`stalwart-bootstrap.ts:30`), qui renvoie le singleton Bootstrap où
   `submitBootstrap` l'a écrit. Une seule source, jamais périmée, jamais
   désynchronisée.

   Deux options ont été écartées. Persister la valeur dans `STALMAIL_RUN_DIR` :
   un `serverHostname` modifié après le bootstrap périmerait le fichier en silence,
   et un volume recréé ferait retomber la résolution sur le domaine — le défaut
   d'aujourd'hui réintroduit par le chemin de secours. Garder la valeur du client :
   `configureAcmeSchema` ne la valide que par `z.string().max(253)`, sans le motif
   de nom d'hôte de `schemas.ts`, et une reprise d'étape la renvoie vide de toute
   façon.

   Ordre de résolution, réduit à deux étages : **`serverHostname` lu chez Stalwart
   → nom du domaine**. `STALMAIL_PUBLIC_URL` ne participe plus.

   L'accès admin nécessaire à cette lecture existe pendant tout le setup : le
   durcissement du port de management (`docker/stalwart/entrypoint.sh`) n'intervient
   qu'une fois le setup terminé, donc après l'étape SSL.

3. **La même source alimente l'affichage du wizard.** `setupContextHandler`
   (`setup-actions.ts:465`) dérive aujourd'hui le `serverHostname` affiché de
   `STALMAIL_PUBLIC_URL`. Il doit lire la même valeur que l'ACME, sans quoi l'écran
   de reprise montrerait l'hôte du webmail sous l'étiquette « hôte du serveur » —
   précisément la confusion de rôles que la décision 1 interdit.

4. **La politique MTA-STS devient joignable**, par un bloc de site Caddy dédié :

   ```
   mta-sts.{$STALMAIL_MAIL_DOMAIN:invalid.localhost} {
   	handle /.well-known/mta-sts.txt {
   		reverse_proxy stalwart:8080
   	}
   	handle {
   		respond 404
   	}
   }
   ```

   Le bloc n'importe **pas** `stalmail_routes` : un hôte `mta-sts.*` n'a aucune
   raison d'exposer le webmail, le wizard ou la surface JMAP sous un second nom.

   Aucune directive `tls` : Caddy émet automatiquement un certificat interne pour
   les noms en `.localhost` et passe à ACME dès que la variable porte un vrai
   domaine. Une directive `tls internal` en dur servirait un certificat auto-signé
   au vrai domaine — l'inverse du but.

   Le DNS n'a rien à gagner : la zone Stalwart publie déjà `mta-sts` en CNAME vers
   l'hôte mail.

5. **`STALMAIL_MAIL_DOMAIN` est obligatoire en production, absente en
   développement.** `compose.prod.yml` la déclare avec `${VAR:?message}`, comme les
   quatre autres variables. Le `Caddyfile` garde un défaut en `.localhost` parce
   qu'il est partagé entre dev et prod (son en-tête le dit, et les deux composes le
   montent) et que la stack de dev n'a pas de domaine mail. La contrainte vit donc
   là où elle a du sens ; aucun repli silencieux en production.

6. **`install.sh` demande la variable et migre les `.env` existants.** Le script
   génère aujourd'hui quatre valeurs (`install.sh:117-120`) et ignore
   `STALMAIL_MAIL_DOMAIN` : combiné au `:?` de la décision 5, tout déploiement
   installé par le script actuel échouerait au prochain `up -d`. Le script la
   demande donc à l'installation, et complète un `.env` existant qui ne l'a pas —
   le motif existe déjà pour `STALMAIL_SETUP_TOKEN_HASH` (`install.sh:135-145`).

7. **Le wizard signale une divergence de domaine.** `STALMAIL_MAIL_DOMAIN` est
   saisie avant que le domaine n'existe : une faute de frappe resterait invisible
   pendant que Caddy réclamerait en boucle un certificat pour
   `mta-sts.<mauvais-domaine>` — échecs répétés, donc quota Let's Encrypt entamé, et
   politique jamais servie. Le wizard compare la variable au domaine créé et
   affiche un avertissement explicite si les deux diffèrent. Un avertissement, pas
   un blocage : l'opérateur peut avoir une raison.

8. **La validation se fait par destruction**, seule preuve honnête : détruire le
   déploiement de test, refaire le wizard avec un `serverHostname` **différent** de
   l'hôte du webmail — la configuration qui casse aujourd'hui — puis vérifier depuis
   l'extérieur.

9. **L'annuaire ACME est une variable d'environnement, pour itérer en staging.**
   Un cycle détruire/refaire consomme du quota d'émission, et un quota épuisé rend
   le serveur injoignable en HTTPS pendant une semaine (déjà vécu ici).
   `STALMAIL_ACME_DIRECTORY` vaut par défaut l'annuaire de production de Let's
   Encrypt, et alimente **les deux** demandeurs : `acme_ca` dans les options
   globales du `Caddyfile`, et le paramètre `directory` déjà accepté par
   `configureAcme` (`stalwart-acme.ts:16`), que le handler ne transmet pas encore.
   Le `Caddyfile` reste ainsi unique pour dev et prod, et la bascule en staging ne
   demande qu'une ligne de `.env`.

## Portée

- `src/server/setup-actions.ts` — `resolveAcmeHostname` (fonction pure),
  `configureAcmeHandler`, `setupContextHandler`.
- `src/server/stalwart-acme.ts` — transmission de `directory` depuis
  l'environnement.
- Le wizard — comparaison domaine créé / `STALMAIL_MAIL_DOMAIN` et son
  avertissement (clés i18n `fr` et `en`).
- `Caddyfile` — bloc `mta-sts.*`, option globale `acme_ca`.
- `compose.prod.yml` — `STALMAIL_MAIL_DOMAIN` (requise) et
  `STALMAIL_ACME_DIRECTORY` (facultative) passées aux services concernés.
- `install.sh` — saisie de la nouvelle variable et complément des `.env` existants.
- `.env.example` — les deux variables documentées, avec la distinction qui se
  trompe le plus facilement : domaine des adresses ≠ hôte du webmail.

## Tests

**Fonction pure de résolution** (vitest, isolée) — nouvelle signature à deux
étages, `(serverHostname, domainName)` :

- `serverHostname` renseigné → ce nom, quel que soit `STALMAIL_PUBLIC_URL`.
- `serverHostname` vide ou absent → nom du domaine.
- `STALMAIL_PUBLIC_URL` défini sur une autre valeur → aucune influence sur le
  résultat. *(Le cas qui échoue aujourd'hui.)*

**Handlers** (le cœur du correctif, `setup-actions.test.ts` teste déjà ce niveau) :

- `configureAcmeHandler` appelle `configureAcme` avec le `serverHostname` lu chez
  Stalwart, pas avec l'hôte de `STALMAIL_PUBLIC_URL`.
- reprise de l'étape SSL, entrées client vides → même SAN qu'au premier passage.
- `setupContextHandler` renvoie le `serverHostname` lu chez Stalwart.
- `STALMAIL_ACME_DIRECTORY` défini → transmis à `configureAcme` ; absent →
  l'annuaire de production.

**Avertissement du wizard** : domaine créé identique à `STALMAIL_MAIL_DOMAIN` →
aucun avertissement ; différent → avertissement affiché, sans blocage.

**Configuration** (aucun test unitaire possible, donc vérification explicite) :

- `caddy validate` avec `STALMAIL_MAIL_DOMAIN` définie **et** absente : les deux
  formes doivent être syntaxiquement valides.
- `docker compose -f compose.prod.yml config` sans la variable : échec avec le
  message attendu.

**Validation de bout en bout**, après destruction et wizard neuf, en staging
d'abord :

- le certificat servi sur 993, 465 et 25 couvre le nom annoncé en EHLO — SAN
  vérifié, pas seulement le CN ;
- `https://mta-sts.<domaine>/.well-known/mta-sts.txt` renvoie la politique avec un
  certificat valide. Ce chemin n'a jamais été éprouvé avec l'en-tête
  `Host: mta-sts.<domaine>` que le nouveau bloc transmettra : la vérification doit
  porter sur la requête réelle, pas sur un appel interne à Stalwart ;
- le `mx:` de la politique correspond à l'enregistrement MX publié ;
- toute autre URL sur `mta-sts.<domaine>` renvoie 404 ;
- le webmail reste joignable sur son propre hôte.

## Hors périmètre

- **Le mode DNS manuel.** `configureAcmeHandler` y refuse l'ACME
  (`SETUP-FORBIDDEN`, `setup-actions.ts:480-484`) : l'étape SSL n'est qu'un
  acquittement, l'opérateur fournit son propre certificat et rien ne vérifie ce
  qu'il couvre. Le défaut « certificat ≠ nom annoncé » y reste donc **entier**.
  Le corriger supposerait de guider l'opérateur sur les noms à couvrir puis de
  contrôler ce qui est réellement présenté — une conception à part, à ouvrir en
  issue.
- **`autoconfig` / `autodiscover` / `ua-auto-config`.** La zone publie ces CNAME
  (design du 2026-06-29) ; en HTTPS ils tombent sur le catch-all `:443` en
  `tls internal` et reçoivent un certificat auto-signé. C'est la même faute que
  celle corrigée ici — publier un enregistrement dont on ne dessert pas le service
  — mais elle touche la découverte automatique des clients mail, pas la
  délivrabilité. À traiter dans son propre cycle.
- **Passer la politique en `mode: enforce`.** C'est Stalwart qui la génère ; on ne
  la modifie pas avant que le certificat soit cohérent et observé.
- **Le multi-domaine.** Le produit crée un domaine dans le wizard et le code
  interroge « le premier domaine » ; une installation multi-domaines demanderait un
  hôte de politique par domaine, donc une autre conception (TLS à la demande).
- **Le partage d'un certificat unique entre Caddy et Stalwart.** Ils en obtiennent
  chacun un, par des défis différents (HTTP-01 et DNS-01) ; les mutualiser est un
  autre sujet.
- **DANE / TLSA.** Aucun enregistrement publié aujourd'hui.
