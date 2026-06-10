# Changelog

## [0.1.4](https://github.com/kkzakaria/stalmail/compare/v0.1.3...v0.1.4) (2026-06-10)


### Features

* compose multi-service architecture (stock Stalwart behind Caddy) ([#12](https://github.com/kkzakaria/stalmail/issues/12)) ([e3d2add](https://github.com/kkzakaria/stalmail/commit/e3d2add2268bce15c53a31db3fa6bb7972c2405a))

  Remplace le conteneur tout-en-un (Caddy + Stalwart + app dans un seul namespace
  réseau, en conflit sur le port 443) par une stack `docker compose` à trois services
  où **Stalwart reste l'image stock** — le modèle reverse-proxy documenté par Stalwart.
  Chaque service ayant son propre namespace réseau, le conflit de port disparaît.
  - **Stalwart stock** : image `stalwartlabs/stalwart:v0.16` inchangée (binaire,
    config, listeners) ; seul l'entrypoint est remplacé par un superviseur qui lance
    le binaire avec `--config` (corrige le lancement nu qui affichait l'aide et
    quittait) et le redémarre à la demande.
  - **Redémarrage bootstrap→normal inter-conteneurs** porté par une sentinelle sur
    volume partagé (`/shared`) : le BFF l'écrit, le superviseur Stalwart la consomme
    et relance le binaire (validé de bout en bout par le smoke compose).
  - **Service `app`** : webmail/BFF TanStack Start (build bun → runtime node), serveur
    **non-root** (uid 2000, aligné sur Stalwart pour le volume partagé), dépendances de
    production uniquement, adaptateur fetch→`node:http` qui **streame** les corps de
    requête (pas de bufferisation OOM) et émet correctement les `Set-Cookie` multiples.
  - **Service `caddy`** : TLS public + reverse-proxy (`443`/`80`), route les chemins
    publics de Stalwart vers `:8080`, le reste vers l'app.
  - **Installeur** `docker compose up -d` avec validation du démarrage des services ;
    CI publiant les deux images (matrice) ; **décommission complète** du modèle
    mono-conteneur (Dockerfile/entrypoint).
  - Couverture : 84 tests unitaires + test du superviseur (stub) + smoke compose de
    bout en bout (redémarrage inter-conteneurs vérifié).

## [0.1.3](https://github.com/kkzakaria/stalmail/compare/v0.1.2...v0.1.3) (2026-06-09)


### Features

* Plan 2a — Setup Wizard backend (Stalwart v0.16 bootstrap) ([#8](https://github.com/kkzakaria/stalmail/issues/8)) ([4947bdb](https://github.com/kkzakaria/stalmail/commit/4947bdbc444999dc5e938d2e8f02dd6e28ccdc3d))

  Backend pilotant un Stalwart v0.16 neuf à travers le premier démarrage
  (bootstrap → redémarrage → mode normal), exposé en server functions TanStack,
  sans UI (la UI est le Plan 2b). Fondé sur un repérage empirique de l'API JMAP
  management v0.16. Inclus :
  - **Transport JMAP management** (`urn:stalwart:jmap`, `POST /jmap/`) avec
    `accountId` mémoïsé et helpers `firstResponse` / `expectResult` (les erreurs
    JMAP sont remontées, jamais confondues avec un résultat vide).
  - **Bootstrap** : détection du mode, lecture/soumission de l'objet `Bootstrap`,
    déclenchement du redémarrage Stalwart via fichier sentinel.
  - **Compte admin** (`x:Account`, variante User + rôle Admin) avec gestion de la
    validation de force du mot de passe côté serveur.
  - **Domaine** : `dnsManagement` automatique, liste des 70 providers DNS réels,
    parsing du `dnsZoneFile`.
  - **Vérification DNS côté BFF** (TXT/MX/SRV/CAA) pour la grille par-record, et
    **dérivation de l'étape** du wizard depuis l'état réel Stalwart.
  - **Entrypoint** corrigé pour le modèle bootstrap v0.16 (plus de `--init`) +
    superviseur Stalwart (redémarrage par sentinel, arrêt borné TERM→KILL).
  - Couverture : 82 tests unitaires + test d'intégration du superviseur.

## [0.1.2](https://github.com/kkzakaria/stalmail/compare/v0.1.1...v0.1.2) (2026-06-09)


### Bug Fixes

* corriger le chemin de sortie du build Docker ([1ff91d4](https://github.com/kkzakaria/stalmail/commit/1ff91d412bb3b979aaa17a658d6e1b10ad50842c))

## [0.1.1](https://github.com/kkzakaria/stalmail/compare/v0.1.0...v0.1.1) (2026-06-09)


### Features

* Plan 1 — Foundation (Vitest, setup-flag, Stalwart client, Docker, install script) ([#5](https://github.com/kkzakaria/stalmail/issues/5)) ([a38c277](https://github.com/kkzakaria/stalmail/commit/a38c277127e58dc2b017c581f5b16ea15447c53e))

## 0.1.0 (2026-06-08)


### Features

* initial commit ([02aad32](https://github.com/kkzakaria/stalmail/commit/02aad326e62954c3ebe592fca334b208db55704b))


### Bug Fixes

* correct import/consistent-type-specifier-style lint errors in shadcn files ([5c8a222](https://github.com/kkzakaria/stalmail/commit/5c8a22201f18a7ed3b01e6845d37f8b33767bac5))
* pass CI with no tests yet and fix CD job-level condition ([5977dc0](https://github.com/kkzakaria/stalmail/commit/5977dc035c6fc3f00170c6aca36181e5cc5159d6))
