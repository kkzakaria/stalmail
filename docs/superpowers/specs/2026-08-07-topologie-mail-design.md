# Topologie mail : noms, certificats, politique MTA-STS — Design

**Date** : 2026-08-07
**Origine** : audit du serveur de test (v0.1.48) — le certificat présenté sur les
ports mail ne couvre pas le nom que le serveur annonce, et la politique MTA-STS
publiée en DNS est injoignable en HTTPS.
**Statut** : validé en brainstorming.
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
jamais pour le nom sous lequel le serveur mail se présente. Tant que les deux
coïncident — webmail et MX sur l'apex — rien ne se voit. Dès qu'ils divergent, ce
qui est pourtant le cas documenté dans `.env.example`
(`STALMAIL_HOSTNAME=mail.getstalmail.com`), le certificat ne couvre plus le
serveur mail.

Mesuré sur le serveur de test : EHLO annonce `mail.getstalmail.com`, MX pointe sur
`mail.getstalmail.com`, et le certificat servi sur 25/465/993 porte
`CN=getstalmail.com` avec pour unique SAN `DNS:getstalmail.com`.

Second défaut, de même famille : Stalwart **sert déjà** sa politique MTA-STS sur
`/.well-known/mta-sts.txt` (vérifié : `version: STSv1`, `mode: testing`,
`mx: mail.getstalmail.com`), et le wizard publie le TXT `_mta-sts` issu de la zone
Stalwart. Mais la politique doit être servie sur l'hôte `mta-sts.<domaine>`, pour
lequel le `Caddyfile` n'a aucun bloc de site : le handshake TLS échoue. Le produit
publie donc un enregistrement dont il ne dessert pas la politique — pour tout
déploiement, pas seulement celui-ci.

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
   | Hôte de politique `mta-sts.<domaine>` | dérivé du domaine | Caddy, relais vers Stalwart |

   Les deux premiers peuvent être égaux (déploiement sur l'apex) ou différents
   (cas documenté). Ce qui ne doit plus arriver, c'est qu'on les confonde.

2. **Le SAN du certificat Stalwart suit l'identité mail, pas le webmail.**
   `resolveAcmeHostname` cesse de dériver de `STALMAIL_PUBLIC_URL` et prend le
   `serverHostname`. Stalwart n'a besoin de prouver qu'une seule identité : celle
   sous laquelle il parle SMTP et IMAP. Le webmail est couvert par Caddy, qui
   possède `:443`.

   C'est une fonction pure : les cas se testent isolément — noms égaux, noms
   différents, `serverHostname` vide (repli sur le domaine), `PUBLIC_URL` absent
   ou malformé.

   **Le `serverHostname` doit être persisté côté serveur au bootstrap.** Le
   commentaire actuel de `configureAcmeHandler` explique pourquoi la valeur ne
   vient pas du client : lors d'une reprise de l'étape SSL, le client renvoie des
   champs vides, et c'est `STALMAIL_PUBLIC_URL` qui sauvait la mise. Retirer
   `PUBLIC_URL` sans rien mettre à la place ferait retomber la reprise sur le nom
   du domaine — donc demander un certificat pour l'apex alors que le serveur
   annonce autre chose : le défaut d'aujourd'hui, déplacé.

   Le `serverHostname` est donc écrit dans le répertoire d'état du setup
   (`STALMAIL_RUN_DIR`, celui des drapeaux de `setup-flag.ts`) au moment du
   bootstrap, et relu à l'étape SSL. Ordre de résolution, du plus au moins
   autoritatif : valeur persistée → valeur fournie par le client → nom du
   domaine. `STALMAIL_PUBLIC_URL` ne participe plus.

3. **La politique MTA-STS devient joignable**, par un bloc de site Caddy dédié :

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

4. **`STALMAIL_MAIL_DOMAIN` est obligatoire en production, absente en
   développement.** `compose.prod.yml` la déclare avec `${VAR:?message}`, comme les
   quatre autres variables : un `up -d` sans elle s'arrête avec un message qui dit
   quoi faire. Le `Caddyfile` garde un défaut en `.localhost` parce qu'il est
   partagé entre dev et prod (son en-tête le dit) et que la stack de dev n'a pas de
   domaine mail. La contrainte vit donc là où elle a du sens ; aucun repli
   silencieux en production.

   Aucune directive `tls` n'est écrite dans le bloc : Caddy émet automatiquement un
   certificat interne pour les noms en `.localhost`, et passe à ACME dès que la
   variable porte un vrai domaine. Une directive `tls internal` en dur servirait un
   certificat auto-signé au vrai domaine — l'inverse du but.

5. **La validation se fait par destruction**, seule preuve honnête : détruire le
   déploiement de test, refaire le wizard avec un `serverHostname` **différent** de
   l'hôte du webmail — la configuration qui casse aujourd'hui — puis vérifier depuis
   l'extérieur.

6. **Les itérations de validation utilisent Let's Encrypt staging.** Un cycle
   détruire/refaire consomme du quota d'émission, et un quota épuisé rend le
   serveur injoignable en HTTPS pendant une semaine (déjà vécu sur ce déploiement).
   `configureAcme` accepte déjà un `directory` de substitution, et Caddy accepte
   `acme_ca`. La bascule vers l'annuaire de production se fait une fois la
   topologie vérifiée en staging.

## Portée

- `src/server/setup-actions.ts` — `resolveAcmeHostname` (fonction pure) et son
  appelant `configureAcmeHandler`.
- La persistance du `serverHostname` dans `STALMAIL_RUN_DIR` : écriture au
  bootstrap, lecture à l'étape SSL.
- `Caddyfile` — le bloc `mta-sts.*`.
- `compose.prod.yml` — la variable passée au service caddy, requise.
- `.env.example` — la variable documentée, avec la distinction qui se trompe le
  plus facilement : domaine des adresses ≠ hôte du webmail.
- La documentation de déploiement, si elle décrit les variables.

## Tests

Fonction pure `resolveAcmeHostname` (vitest, isolée) :

- hôte du webmail et `serverHostname` identiques → ce nom.
- hôte du webmail et `serverHostname` différents → le `serverHostname`. *(Le cas
  qui échoue aujourd'hui.)*
- `serverHostname` vide → repli sur le nom du domaine.
- valeur persistée présente et valeur client vide (reprise de l'étape SSL) → la
  valeur persistée l'emporte. *(Le cas que le retrait de `PUBLIC_URL` casserait
  si on n'y prenait pas garde.)*
- `STALMAIL_PUBLIC_URL` absent ou malformé → aucune influence sur le résultat.

Configuration (pas de test unitaire possible, donc vérification explicite) :

- `caddy validate` sur le `Caddyfile` avec `STALMAIL_MAIL_DOMAIN` définie **et**
  absente : les deux formes doivent être syntaxiquement valides.
- `docker compose -f compose.prod.yml config` sans la variable : doit échouer avec
  le message attendu.

Validation de bout en bout, après destruction et wizard neuf :

- le certificat servi sur 993, 465 et 25 couvre le nom annoncé en EHLO (SAN
  vérifié, pas seulement le CN) ;
- `https://mta-sts.<domaine>/.well-known/mta-sts.txt` renvoie la politique, avec un
  certificat valide ;
- le `mx:` de la politique correspond à l'enregistrement MX publié ;
- toute autre URL sur `mta-sts.<domaine>` renvoie 404 ;
- le webmail reste joignable sur son propre hôte.

## Hors périmètre

- **Passer la politique en `mode: enforce`.** C'est Stalwart qui la génère ; on ne
  la modifie pas avant que le certificat soit cohérent et observé.
- **Le multi-domaine.** Le produit crée un domaine dans le wizard et le code
  interroge « le premier domaine » ; une installation multi-domaines demanderait un
  hôte de politique par domaine, donc une autre conception (TLS à la demande).
- **Le partage d'un certificat unique entre Caddy et Stalwart.** Ils en obtiennent
  chacun un, par des défis différents (HTTP-01 et DNS-01) ; les mutualiser est un
  autre sujet.
- **DANE / TLSA.** Aucun enregistrement publié aujourd'hui, hors sujet ici.
