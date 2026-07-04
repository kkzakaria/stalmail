# Changelog

## [0.1.44](https://github.com/kkzakaria/stalmail/compare/v0.1.43...v0.1.44) (2026-07-04)


### Features

* **reader:** gating DMARC de l'allowlist images + durcissements ([#126](https://github.com/kkzakaria/stalmail/issues/126)) ([#132](https://github.com/kkzakaria/stalmail/issues/132)) ([6481f52](https://github.com/kkzakaria/stalmail/commit/6481f529779101aa5055ab0c37a1afbae19cb396))

## [0.1.43](https://github.com/kkzakaria/stalmail/compare/v0.1.42...v0.1.43) (2026-07-03)


### Features

* **reader:** révocation par-message de « Afficher les images » ([#128](https://github.com/kkzakaria/stalmail/issues/128)) ([254fcb7](https://github.com/kkzakaria/stalmail/commit/254fcb708f7f99a1e166a8fce452546a1dbe8eb5))

## [0.1.42](https://github.com/kkzakaria/stalmail/compare/v0.1.41...v0.1.42) (2026-07-02)


### Features

* **reader:** persiste la décision « Afficher les images » ([#70](https://github.com/kkzakaria/stalmail/issues/70)) ([#125](https://github.com/kkzakaria/stalmail/issues/125)) ([04ec946](https://github.com/kkzakaria/stalmail/commit/04ec946b82d298311dcfa71a8a8037d95bee1c4d))

## [0.1.41](https://github.com/kkzakaria/stalmail/compare/v0.1.40...v0.1.41) (2026-07-02)


### Bug Fixes

* **setup:** mapper les défaillances pré-try vers des codes SETUP-* parlants ([#63](https://github.com/kkzakaria/stalmail/issues/63), [#120](https://github.com/kkzakaria/stalmail/issues/120)) ([#123](https://github.com/kkzakaria/stalmail/issues/123)) ([de0f68b](https://github.com/kkzakaria/stalmail/commit/de0f68bada431d54ae65daa4489015ccfb8f2dc2))

## [0.1.40](https://github.com/kkzakaria/stalmail/compare/v0.1.39...v0.1.40) (2026-07-01)


### Bug Fixes

* **setup:** re-déclencher la publication DNS au retry + purger la tâche périmée ([#62](https://github.com/kkzakaria/stalmail/issues/62)) ([96b5108](https://github.com/kkzakaria/stalmail/commit/96b5108dadb9353b402fbc87dc968cc7d00eab3c))

## [0.1.39](https://github.com/kkzakaria/stalmail/compare/v0.1.38...v0.1.39) (2026-07-01)


### Bug Fixes

* **setup:** garder l'étape dns après un échec de publication DNS ([#62](https://github.com/kkzakaria/stalmail/issues/62)) ([0477ff3](https://github.com/kkzakaria/stalmail/commit/0477ff32ce5726adf6866ffc9fb390f41a64f9c3))

## [0.1.38](https://github.com/kkzakaria/stalmail/compare/v0.1.37...v0.1.38) (2026-07-01)


### Features

* **setup:** surfacer l'échec de publication DnsManagement ([#62](https://github.com/kkzakaria/stalmail/issues/62)) ([84b0bda](https://github.com/kkzakaria/stalmail/commit/84b0bda8a869b3edd09f9011315454bd90e9cdf0))

## [0.1.37](https://github.com/kkzakaria/stalmail/compare/v0.1.36...v0.1.37) (2026-06-30)


### Features

* **setup:** webmail proposé en CNAME vers l'hôte mail ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#112](https://github.com/kkzakaria/stalmail/issues/112)) ([c3e3f4d](https://github.com/kkzakaria/stalmail/commit/c3e3f4debdb07d69d247e41188bf19a566d8e134))

## [0.1.36](https://github.com/kkzakaria/stalmail/compare/v0.1.35...v0.1.36) (2026-06-29)


### Features

* **setup:** A/AAAA dérivés de la zone publiée, étiquetés par rôle ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#110](https://github.com/kkzakaria/stalmail/issues/110)) ([1cab380](https://github.com/kkzakaria/stalmail/commit/1cab38004a85201743b641f096f1fc3683f3d4e8))

## [0.1.35](https://github.com/kkzakaria/stalmail/compare/v0.1.34...v0.1.35) (2026-06-28)


### Bug Fixes

* **setup:** élargir le fond de l'entête pour masquer l'ombre latérale de la carte ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#108](https://github.com/kkzakaria/stalmail/issues/108)) ([0357165](https://github.com/kkzakaria/stalmail/commit/03571653ecb3990734796cfd6b327fa68536b6a9))

## [0.1.34](https://github.com/kkzakaria/stalmail/compare/v0.1.33...v0.1.34) (2026-06-28)


### Bug Fixes

* **setup:** épingler l'entête dès le scroll 0, avec marge haute ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#106](https://github.com/kkzakaria/stalmail/issues/106)) ([eab586b](https://github.com/kkzakaria/stalmail/commit/eab586bc93d33cce9da2341cc708cb77d8fa9fc3))

## [0.1.33](https://github.com/kkzakaria/stalmail/compare/v0.1.32...v0.1.33) (2026-06-28)


### Bug Fixes

* **setup:** entête sticky + défilement de page, retrait de la légende d'étape ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#104](https://github.com/kkzakaria/stalmail/issues/104)) ([9b26bc1](https://github.com/kkzakaria/stalmail/commit/9b26bc1f0eec869c047eb607222a608a16c89677))

## [0.1.32](https://github.com/kkzakaria/stalmail/compare/v0.1.31...v0.1.32) (2026-06-28)


### Bug Fixes

* **setup:** faire défiler la carte entière, pas son contenu ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#102](https://github.com/kkzakaria/stalmail/issues/102)) ([9f03518](https://github.com/kkzakaria/stalmail/commit/9f035187d5a095bf6b5597fe039a67a7c52153bb))

## [0.1.31](https://github.com/kkzakaria/stalmail/compare/v0.1.30...v0.1.31) (2026-06-28)


### Bug Fixes

* **setup:** portaler le panneau du Combobox hors de la carte scrollable ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#100](https://github.com/kkzakaria/stalmail/issues/100)) ([26be7e4](https://github.com/kkzakaria/stalmail/commit/26be7e436c7c948e26886fd17fe82045a3eae741))

## [0.1.30](https://github.com/kkzakaria/stalmail/compare/v0.1.29...v0.1.30) (2026-06-28)


### Bug Fixes

* **setup:** entête et stepper fixes, contenu scrollable en interne ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#98](https://github.com/kkzakaria/stalmail/issues/98)) ([406aaf0](https://github.com/kkzakaria/stalmail/commit/406aaf035c6d75004898ac5ed7582f628675797b))

## [0.1.29](https://github.com/kkzakaria/stalmail/compare/v0.1.28...v0.1.29) (2026-06-28)


### Bug Fixes

* **setup:** titre + cadre scrollable pour les DNS auto, pied compact ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#96](https://github.com/kkzakaria/stalmail/issues/96)) ([7a83e2e](https://github.com/kkzakaria/stalmail/commit/7a83e2e238e541f44357d5a256a48cd2fa9fc187))

## [0.1.28](https://github.com/kkzakaria/stalmail/compare/v0.1.27...v0.1.28) (2026-06-28)


### Bug Fixes

* **setup:** entête + largeur colonne + espacement table adresse du serveur ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#94](https://github.com/kkzakaria/stalmail/issues/94)) ([797f2e3](https://github.com/kkzakaria/stalmail/commit/797f2e3c03573d00e288161bb76ad9e4cadc00cb))

## [0.1.27](https://github.com/kkzakaria/stalmail/compare/v0.1.26...v0.1.27) (2026-06-27)


### Bug Fixes

* **setup:** encart d'avertissement + libellé générique pour l'adresse du serveur ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#92](https://github.com/kkzakaria/stalmail/issues/92)) ([7ae8b15](https://github.com/kkzakaria/stalmail/commit/7ae8b1519e8609bfdecba5fa0285c33a5739f819))

## [0.1.26](https://github.com/kkzakaria/stalmail/compare/v0.1.25...v0.1.26) (2026-06-27)


### Features

* **setup:** guidage A/AAAA dans l'étape DNS du wizard ([#61](https://github.com/kkzakaria/stalmail/issues/61)) ([#90](https://github.com/kkzakaria/stalmail/issues/90)) ([934aec1](https://github.com/kkzakaria/stalmail/commit/934aec1d825910964067f98a138ac1b9820e2ddf))

## [0.1.25](https://github.com/kkzakaria/stalmail/compare/v0.1.24...v0.1.25) (2026-06-26)


### Bug Fixes

* **mail:** provisionner le mailbox archive à la volée au 1er archivage ([#73](https://github.com/kkzakaria/stalmail/issues/73)) ([5503616](https://github.com/kkzakaria/stalmail/commit/550361661ec26b850acc00e08264e25ce7b343ed))
* **mail:** rollback optimiste par re-sync au lieu de snapshot complet ([#38](https://github.com/kkzakaria/stalmail/issues/38)) ([a0ca415](https://github.com/kkzakaria/stalmail/commit/a0ca4154bed256c1dddf57e0953ae9a252861bc4))
* **setup:** ré-hydrater le contexte du wizard sur reload via le serveur ([#19](https://github.com/kkzakaria/stalmail/issues/19)) ([1211aff](https://github.com/kkzakaria/stalmail/commit/1211aff882eb79e6d8a768b3ea62167165ffb5e1))

## [0.1.24](https://github.com/kkzakaria/stalmail/compare/v0.1.23...v0.1.24) (2026-06-25)


### Bug Fixes

* **mail:** Cc et Cci en bascules indépendantes dans le composer ([#82](https://github.com/kkzakaria/stalmail/issues/82)) ([b3f242c](https://github.com/kkzakaria/stalmail/commit/b3f242ca9aee9135c91a6b1553b1721e8ff480db))
* **mail:** réinitialiser la réponse rapide après un envoi réussi ([#81](https://github.com/kkzakaria/stalmail/issues/81)) ([bd14375](https://github.com/kkzakaria/stalmail/commit/bd143756e7092c014a74d69ab40fa51efcec687c))

## [0.1.23](https://github.com/kkzakaria/stalmail/compare/v0.1.22...v0.1.23) (2026-06-25)


### Bug Fixes

* **mail:** ouvrir un fil par threadId, pas par id email (fils-réponse) ([#75](https://github.com/kkzakaria/stalmail/issues/75)) ([5c88efb](https://github.com/kkzakaria/stalmail/commit/5c88efbc2bba2b5bf9fe454195ce687c1bb65b08))

## [0.1.22](https://github.com/kkzakaria/stalmail/compare/v0.1.21...v0.1.22) (2026-06-25)


### Bug Fixes

* **reader:** préférer le HTML au text/plain (iframe sandbox + blocage images) ([#68](https://github.com/kkzakaria/stalmail/issues/68)) ([1a8bbfd](https://github.com/kkzakaria/stalmail/commit/1a8bbfd41533f8a2f257f590daa236ce35c86e17))

## [0.1.21](https://github.com/kkzakaria/stalmail/compare/v0.1.20...v0.1.21) (2026-06-25)


### Bug Fixes

* **mail:** déclarer la capability submission pour Identity/get (envoi) ([#65](https://github.com/kkzakaria/stalmail/issues/65)) ([070b022](https://github.com/kkzakaria/stalmail/commit/070b02227392f84adb1cec4c926d608cb4a9106a))

## [0.1.20](https://github.com/kkzakaria/stalmail/compare/v0.1.19...v0.1.20) (2026-06-24)


### Bug Fixes

* **setup:** statut SSL "valid" quand le renouvellement ACME est planifié ([#59](https://github.com/kkzakaria/stalmail/issues/59)) ([5bdb57a](https://github.com/kkzakaria/stalmail/commit/5bdb57a94f8c434644169360015bd20638979b63))
* **setup:** vérifier les enregistrements CNAME dans la grille DNS ([#58](https://github.com/kkzakaria/stalmail/issues/58)) ([5c5e186](https://github.com/kkzakaria/stalmail/commit/5c5e18684527d525a28559ad306dcc52130a05fc))

## [0.1.19](https://github.com/kkzakaria/stalmail/compare/v0.1.18...v0.1.19) (2026-06-24)


### Bug Fixes

* **setup:** publishRecords est un objet, pas un tableau (gestion DNS auto) ([#56](https://github.com/kkzakaria/stalmail/issues/56)) ([79ad0f5](https://github.com/kkzakaria/stalmail/commit/79ad0f5a004471c71e4bae5039b0b7ca9a1091e4))

## [0.1.18](https://github.com/kkzakaria/stalmail/compare/v0.1.17...v0.1.18) (2026-06-24)


### Features

* **setup:** authentification du bootstrap du wizard (jeton dédié) ([#54](https://github.com/kkzakaria/stalmail/issues/54)) ([bbb992b](https://github.com/kkzakaria/stalmail/commit/bbb992bac910ec1eb6043fb143b9976be468007d))

## [0.1.17](https://github.com/kkzakaria/stalmail/compare/v0.1.16...v0.1.17) (2026-06-23)


### Bug Fixes

* **setup:** envoyer le secret DnsServer comme SecretKey typé ([#50](https://github.com/kkzakaria/stalmail/issues/50)) ([e2f70ba](https://github.com/kkzakaria/stalmail/commit/e2f70ba1eea5ed27fd08daa95b13c29292d7922a))

## [0.1.16](https://github.com/kkzakaria/stalmail/compare/v0.1.15...v0.1.16) (2026-06-23)


### Bug Fixes

* **app:** servir les assets client statiques depuis dist/client ([#49](https://github.com/kkzakaria/stalmail/issues/49)) ([e23742d](https://github.com/kkzakaria/stalmail/commit/e23742d91ad2d27247ff6447878931846fed588b))
* **ops:** accès wizard par IP cassé en pré-DNS (cert de bootstrap) ([#48](https://github.com/kkzakaria/stalmail/issues/48)) ([4cd918c](https://github.com/kkzakaria/stalmail/commit/4cd918c0009b33eea68c5f852120c777d0774e01))
* **ops:** générer le secret install.sh sans casser sous pipefail ([#46](https://github.com/kkzakaria/stalmail/issues/46)) ([f277b59](https://github.com/kkzakaria/stalmail/commit/f277b5933feec8244bf22be588481811bda65104))

## [0.1.15](https://github.com/kkzakaria/stalmail/compare/v0.1.14...v0.1.15) (2026-06-22)


### Bug Fixes

* **wizard:** ACME DNS-01 au lieu de TLS-ALPN-01 (compat reverse proxy) ([#43](https://github.com/kkzakaria/stalmail/issues/43)) ([f8473d9](https://github.com/kkzakaria/stalmail/commit/f8473d99c8d0a575abd8d36feeb15a227bf61c55))

  Correctif de socle indispensable au déploiement derrière un reverse proxy (Caddy).
  Le wizard configurait Stalwart en ACME **TLS-ALPN-01**, qui exige le **port 443
  joignable** : or Caddy possède :443, donc le défi frappait le proxy → **certificat
  jamais émis** (ports mail sans TLS valide, étape SSL du wizard en échec).
  * Bascule sur **ACME DNS-01** : la validation publie un TXT `_acme-challenge` via le
    fournisseur DNS déjà configuré (Cloudflare), **sans port 443** — Stalwart obtient son
    certificat indépendamment de Caddy.
  * S'appuie sur le `dnsManagement: Automatic` (dnsServerId) déjà posé sur le domaine aux
    étapes DNS du wizard ; aucun input supplémentaire.
  * Libellés i18n de l'étape SSL mis à jour (DNS-01 au lieu de TLS-ALPN-01) ; tests alignés.

## [0.1.14](https://github.com/kkzakaria/stalmail/compare/v0.1.13...v0.1.14) (2026-06-22)


### Features

* **4c:** Composer — rédaction & envoi d'emails ([#41](https://github.com/kkzakaria/stalmail/issues/41)) ([c995d12](https://github.com/kkzakaria/stalmail/commit/c995d126b5ec3c56321c28a02a9995185c786479))

  Première capacité d'**émission** de Stalmail : composer un nouveau message, **répondre**, **répondre à tous** et **transférer**.
  * **Composer flottant** (champs À / Cc / Cci / Objet) + **barre de réponse rapide** dans le lecteur, avec un éditeur HTML minimal partagé (gras, italique, lien, listes) affichable via le bouton « Aa ».
  * Envoi via la chaîne JMAP `Identity/get` → `Email/set` (brouillon) → `EmailSubmission/set`, avec bascule **Brouillons → Envoyés** au succès.
  * **Threading** des réponses (`In-Reply-To` / `References` dérivés du Message-ID remonté du fil), objets `Re:` / `Fwd:` non dupliqués, citation du message d'origine.
  * **Sécurité** : sanitisation HTML autoritaire côté serveur (allowlist DOMPurify), anti-injection d'en-têtes (rejet CR/LF/NUL), `bcc` jamais exposé en en-tête, identité d'expédition résolue côté serveur (non-usurpation), rate-limit d'envoi par compte, erreurs mappées sans fuite de détail JMAP/SMTP.
  * i18n FR/EN, tooltips, retour visuel d'état (gras/italique), accessibilité.

## [0.1.13](https://github.com/kkzakaria/stalmail/compare/v0.1.12...v0.1.13) (2026-06-16)


### Features

* Plan 4b — Reader & Actions (lecteur de fil + 5 actions) ([#36](https://github.com/kkzakaria/stalmail/issues/36)) ([e87e2fb](https://github.com/kkzakaria/stalmail/commit/e87e2fb7ae0e31241f16f48d94459998c18444fc))

## [0.1.12](https://github.com/kkzakaria/stalmail/compare/v0.1.11...v0.1.12) (2026-06-14)

Premier écran fonctionnel du webmail : navigation des dossiers et liste de mails virtualisée, en lecture seule (BFF JMAP).

### Features

* **Mail List (Plan 4a)** — layout 3 colonnes (sidebar | liste | reader), sidebar des dossiers JMAP avec compteurs de non-lus, liste de threads **virtualisée** (fenêtrage à index absolu, mémoire bornée), lignes fidèles à la maquette (avatars colorés, point non-lu, favoris ★, pièces jointes 📎, sujet + aperçu tronqué, dates FR Aujourd'hui/Hier/jour/JJ‑MM), thème clair/sombre et i18n fr/en. Lecture seule — actions, lecteur et composition arrivent aux Plans 4b/4c. ([#32](https://github.com/kkzakaria/stalmail/issues/32)) ([c02b8b5](https://github.com/kkzakaria/stalmail/commit/c02b8b59a91598a427b34efb10b10f7f71c19862))

### Architecture

* BFF JMAP utilisateur (Bearer) : server functions `mailboxesFn` / `emailListFn` (batch `Email/query` + `Email/get` + `Thread/get`), intégration SSR de TanStack Query, fenêtrage `useQueries` + `@tanstack/react-virtual`. Mapping des dossiers conforme RFC 8621 (rôle `junk` pour les Indésirables), filtre Favoris aligné Gmail.

## [0.1.11](https://github.com/kkzakaria/stalmail/compare/v0.1.10...v0.1.11) (2026-06-11)


### Features

* Plan 3a — Auth & Session (BFF token-handler) ([#30](https://github.com/kkzakaria/stalmail/issues/30)) ([44b9775](https://github.com/kkzakaria/stalmail/commit/44b9775c4d3a4a801b1ae2c47b05c3a48385adc8))

## [0.1.10](https://github.com/kkzakaria/stalmail/compare/v0.1.9...v0.1.10) (2026-06-11)


### Bug Fixes

* **wizard : nom d'utilisateur « admin » réservé + script de reset dev** ([#26](https://github.com/kkzakaria/stalmail/issues/26)) ([7896782](https://github.com/kkzakaria/stalmail/commit/7896782cfd4fe92130cf3e76265ebabe3d21f746))

  Corrige un bug remonté au test live de l'étape 6 : le bootstrap Stalwart crée
  toujours un admin **système** nommé `admin` (`admin@<domaine>`) ; choisir ce même nom
  à l'étape 4 faisait échouer la création du compte sur `primaryKeyViolation` (email déjà
  pris), remontée comme un générique « account creation rejected » — et seulement après
  un retry de mot de passe (la vérif mot-de-passe-faible passant en premier masquait la
  collision). Cause racine trouvée par reproduction live de `x:Account/set`.
  - **`admin` réservé** (insensible à la casse) dans la validation de l'étape 4, message
    dédié → l'erreur est attrapée là où le nom est encore modifiable, pas à l'étape 6.
  - **Placeholder / aperçu** d'e-mail changés `admin` → `marie`.
  - **Défense backend** : `primaryKeyViolation` **sur `email`** → message « username
    already in use » ; les autres violations de clé retombent sur le générique.
  - **`scripts/dev-reset.sh`** `[--build]` : remet le stack dev en bootstrap frais
    (`down -v` → rebuild optionnel → `up` → attente du wizard).
  - Couverture : 193 tests. (Note design : l'étape 7 DNS reste **non-bloquante** — la
    propagation DNS est asynchrone, la vérification continue en arrière-plan.)

## [0.1.9](https://github.com/kkzakaria/stalmail/compare/v0.1.8...v0.1.9) (2026-06-11)


### Features

* **Wizard 2b-ii — étape C : durcissement recovery-admin** ([#24](https://github.com/kkzakaria/stalmail/issues/24)) ([a77851a](https://github.com/kkzakaria/stalmail/commit/a77851a38283972d7be1ba438ad5e5ce62a0a3c0))

  Dernière pièce du Plan 2b-ii (3/3) : ferme la faille du credential recovery
  permanent. `STALWART_RECOVERY_ADMIN` est passé en permanence au process Stalwart, donc
  l'accès management `:8080` restait joignable indéfiniment avec ce credential même
  après le setup.
  - **Gate sur le flag** : le superviseur Stalwart (`docker/stalwart/entrypoint.sh`)
    vérifie le flag `.stalmail-configured` à chaque (re)démarrage. Flag absent (pendant
    le wizard) → Stalwart démarre **avec** le recovery admin ; flag présent (après
    `finishSetupFn`) → démarrage via `env -u STALWART_RECOVERY_ADMIN`, donc le credential
    recovery n'authentifie plus sur `:8080`. Effet au prochain redémarrage après
    finalisation (les deux chemins — sentinelle et conteneur — l'honorent).
  - **Contrat de chemin unifié** : le flag de setup est un artefact de coordination
    inter-conteneurs (comme la sentinelle de redémarrage) → déplacé de `STALMAIL_DATA_DIR`
    vers **`STALMAIL_RUN_DIR`** (le volume partagé `/shared`), pour que l'app et le
    superviseur résolvent le même chemin. `STALMAIL_DATA_DIR` (devenu mort) retiré des
    compose.
  - **Vérifié en live** contre Stalwart v0.16 : avant flag → creds recovery acceptés ;
    après flag → **401 Unauthorized**, Stalwart reste sain. Test superviseur étendu
    (SET → SET → UNSET). L'accès management post-setup relèvera de l'auth OAuth (Plan 3).

  **Le wizard d'installation est désormais complet de bout en bout** : collecte →
  redémarrage → compte → DNS → SSL → Terminé → `/login`, avec durcissement sécurité.

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
