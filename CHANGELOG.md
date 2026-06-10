# Changelog

## [0.1.8](https://github.com/kkzakaria/stalmail/compare/v0.1.7...v0.1.8) (2026-06-10)


### Features

* **Wizard 2b-ii — étape B : SSL/ACME + Terminé** ([#22](https://github.com/kkzakaria/stalmail/issues/22)) ([9bcaaa9](https://github.com/kkzakaria/stalmail/commit/9bcaaa9a8e0ff3da4066037b8355bace5046d6e7))

  Seconde moitié de la phase monitoring (livraison étagée 2/3) : le wizard est
  désormais **complet de bout en bout** (collecte → submit → redémarrage → compte →
  DNS → SSL → Terminé → `/login`). Reste l'étape C (durcissement recovery-admin).
  - **Repérage ACME live** : le déclenchement ACME en mode normal était un point ouvert
    de la capture d'API. Une recon empirique contre Stalwart v0.16 a **corrigé les
    formes JMAP** supposées (toutes invalides) : `AcmeProvider.challengeType` = enum
    string `"TlsAlpn01"`, `AcmeProvider.contact` = map `{"mailto:<email>": true}`,
    `Domain.certificateManagement.subjectAlternativeNames` = map `{"<host>": true}` ;
    suivi via `x:Task` `@type=AcmeRenewal`. Documenté (spec §9).
  - **Module `stalwart-acme.ts`** : `configureAcme` (crée le fournisseur Let's Encrypt /
    TLS-ALPN-01 puis bascule `certificateManagement=Automatic`) + `getAcmeStatus`
    (poll de la task AcmeRenewal → `pending`/`failed`/`valid`).
  - **Étape 8 — SSL** : **non-bloquante** (Continuer toujours actif — Stalwart réessaie,
    `:8080/admin` reste accessible) ; récap fournisseur/contact/nom couvert + badge de
    task, alerte si le port 443 n'est pas joignable, retry.
  - **Étape 9 — Terminé** : `finishSetupFn` pose le flag `.stalmail-configured`
    (`deriveSetupStep` renvoie alors `done`) ; récap (domaine, serveur, certificat,
    admin) + rappel de sauvegarde + bouton « Ouvrir ma boîte mail » → `/login`.
  - Server functions `configureAcmeFn` / `acmeStatusFn` / `finishSetupFn`, câblage shell
    (`sslStatus` en contexte), i18n FR/EN, CSS écran Terminé. Couverture : 189 tests.

## [0.1.7](https://github.com/kkzakaria/stalmail/compare/v0.1.6...v0.1.7) (2026-06-10)


### Features

* **Wizard 2b-ii — étape A : monitoring compte + DNS** ([#18](https://github.com/kkzakaria/stalmail/issues/18)) ([3520bc2](https://github.com/kkzakaria/stalmail/commit/3520bc28fbc42afee1bffd8df12f7269acc88b53))

  Première moitié de la phase monitoring du wizard (livraison étagée 1/3), câblée au
  backend du Plan 2a via de nouvelles server functions — aucun changement de
  comportement serveur. Les étapes 8 (SSL/ACME) et 9 (Terminé) restent un placeholder
  (étape B), le durcissement recovery-admin est l'étape C.
  - **Étape 6 — Compte administrateur** : `createAdminAccountFn` résout le domaine et
    crée le compte ; **résultat discriminé** `ok`/`weak` (mappe `WeakPasswordError`)
    pilotant un retour saisie inline avec mètre de force.
  - **Étape 7 — Enregistrements DNS** : mode **automatique** (création `DnsServer`,
    bascule `dnsManagement=Automatic`, **grille par-record live** reconstruite côté BFF
    via `parseZoneFile` + `resolveRecordStatus`, polling 5 s) et mode **manuel** (table
    sectionnée par type, boutons copier + téléchargement du fichier de zone) ; badge de
    tâche dérivé des statuts ; alerte « zone externe » par enregistrement.
  - Primitives `StatusBadge` / `CopyIconBtn` / `DownloadButton`, CSS grille DNS scopé
    sous `.stalmail-wizard`, i18n FR/EN du monitoring (parité stricte).
  - Routage `deriveSetupStep` qui distingue l'admin **système** (généré au bootstrap)
    de l'admin **utilisateur**, et navigation monitoring **locale** (gère le mode
    manuel). Couverture : 171 tests. Limites de reload/hydratation tracées (#19, #20).

## [0.1.6](https://github.com/kkzakaria/stalmail/compare/v0.1.5...v0.1.6) (2026-06-10)


### Features

* **Refonte UI du wizard (phase collecte)** ([#16](https://github.com/kkzakaria/stalmail/issues/16)) ([857fe1a](https://github.com/kkzakaria/stalmail/commit/857fe1a00feb2dea4cb0c79c17baa10686124914))

  Refonte de l'UI des 5 étapes de collecte + écran de redémarrage pour coller au
  design handoff fourni, le tout câblé au backend existant (`getStep` /
  `submitBootstrapFn`) — aucun changement de comportement serveur.
  - **Shell carte centrée** avec en-tête : marque, **sélecteur de langue** (déroulant,
    extensible) et **switch de thème clair/sombre** (cookie SSR-seedé, anti-flash).
  - **Stepper groupé** Configuration / Activation (9 points numérotés ; les 4 points
    d'activation sont inertes — phase monitoring différée au Plan 2b-ii).
  - **Étapes re-skinnées** (TanStack Form + Zod conservés) : Bienvenue, Domaine (avec
    alerte « zone externe » quand le nom d'hôte sort du domaine par défaut), Fournisseur
    DNS (**combobox avec recherche** + option « Manuel » épinglée + clé API conditionnelle),
    Compte admin (e-mail dérivé + mètre de force), Récapitulatif (lignes éditables,
    erreur inline) ; écran de redémarrage avec journal de poll.
  - **Système visuel** porté en CSS scopé sous `.stalmail-wizard` (tokens shadcn zinc +
    accent bleu, polices **Geist / Geist Mono**) — zéro impact sur le reste de l'app.
  - i18n FR/EN complet pour la phase collecte (parité de clés stricte) ; cookie de thème
    SSR (`src/server/setup-theme.ts`). Couverture : 149 tests.

## [0.1.5](https://github.com/kkzakaria/stalmail/compare/v0.1.4...v0.1.5) (2026-06-10)


### Features

* **Setup Wizard UI (Plan 2b-i)** ([#10](https://github.com/kkzakaria/stalmail/issues/10)) ([27572f1](https://github.com/kkzakaria/stalmail/commit/27572f1f899f9dcd4107dfdc9e94a3e3106b8c73))
  * Internationalisation FR/EN via i18next, avec parité de clés stricte (`DeepRecord`) et langue amorcée côté SSR par cookie
  * Formulaire piloté par TanStack Form + Zod (Standard Schema), validation hostname RFC1123 et trim des secrets
  * Phase de collecte en 5 étapes : Welcome, Domain, DnsProvider, AdminAccount, Recap
  * Shell du wizard (stepper, contexte, indicateur de force de mot de passe) et écran de redémarrage bootstrap→normal
  * Couverture portée à 113 tests

### Dev

* Stack de dev `compose.dev.yml` : service `installer` en réseau host pour contourner la corruption de `bun install` via le bridge Docker sur WSL2, + doc de troubleshooting ([#14](https://github.com/kkzakaria/stalmail/issues/14))

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
