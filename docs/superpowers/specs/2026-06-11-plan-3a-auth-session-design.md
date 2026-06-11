# Stalmail Plan 3a — Auth & Session — Design Document

**Statut :** validé en brainstorming, prêt pour le plan d'implémentation.
**Périmètre :** authentification utilisateur et gestion de session du BFF. Les server
functions JMAP scopées utilisateur (lecture/écriture mail, recherche, SSE) sont
**hors scope** ici (voir §15) et seront construites au Plan 4, pilotées par l'UI.

---

## 1. Vision

Permettre à un utilisateur de se connecter à Stalmail depuis le formulaire de login
**custom** (email + mot de passe, brandé, i18n — design handoff), d'établir une session
sécurisée, et d'accéder aux routes protégées (`/mail/*`). Les tokens OAuth restent
**entièrement côté serveur** ; le navigateur ne détient qu'un identifiant de session
opaque. C'est le pattern **BFF / token-handler** recommandé par l'OWASP.

Objectif de sécurité directeur (repris de la spec produit) : *aucun token ni credential
n'est exposé au JavaScript du navigateur*. Cette spec le réalise au sens fort — les
tokens ne quittent jamais le processus BFF.

## 2. Contrainte et capacité Stalwart

Vérifié dans la doc Stalwart (v0.16) :

- L'OAuth Stalwart ne supporte que les flows **Authorization Code** et **Device** ; le
  token endpoint `/auth/token` n'accepte que les grants `authorization_code`,
  `device_code`, `refresh_token`. **Pas de grant `password` (ROPC).**
- **`POST /api/auth`** (anonyme, rate-limited) — l'endpoint que l'interface web de
  Stalwart utilise elle-même — accepte directement `accountName` + `accountSecret` et
  renvoie un **code d'autorisation OAuth**. C'est le pont qui permet un formulaire de
  login custom tout en obtenant de vrais tokens.
- Les requêtes JMAP et API s'authentifient par **`Authorization: Bearer <access_token>`**.

Le flux retenu s'appuie donc sur `/api/auth` (custom form → code) puis `/auth/token`
(code → tokens), sans jamais rediriger le navigateur vers une page hébergée par Stalwart.

## 3. Décisions retenues (issues du brainstorming)

1. **Fondation** : `/api/auth` + PKCE (S256) + tokens Bearer.
2. **Client OAuth** : client **public PKCE dédié `stalmail`** — `client_id` arbitraire,
   **sans secret, sans enregistrement préalable** (confirmé empiriquement, cf. capture
   §10 : Stalwart v0.16 traite le client comme public et **rejette** un `client_secret` ;
   PKCE S256 est *enforced*). La reco initiale d'un client confidentiel est donc infirmée.
3. **Session** : pattern BFF / token-handler — **cookie opaque httpOnly** + **store
   serveur** (fichier JSON via `node:fs`, indexé par **`SHA-256(sid)`** — le sid en clair
   ne vit que dans le cookie, cf. §6), **tokens chiffrés au repos**. Révocation instantanée.
4. **2FA** : la machine d'état gère `mfaRequired` dès maintenant (pas de crash, message
   clair) ; **l'écran de saisie TOTP est différé** tant que le wizard n'expose pas
   l'enrôlement 2FA.
5. **Découpage** : ce plan livre **3a (Auth & Session)** ; le JMAP user-scoped est
   repoussé au Plan 4 piloté par l'UI. Une **sonde JMAP authentifiée minimale** prouve
   ici le token de bout en bout.

## 4. Flux de login (séquence)

```
Navigateur                BFF (TanStack Start)                Stalwart
   |  email + password         |                                 |
   |-- POST loginFn ---------->|                                 |
   |                           |-- génère PKCE (verifier,         |
   |                           |   challenge S256) + state        |
   |                           |-- POST /api/auth ---------------->|
   |                           |   {type:authCode, accountName,    |
   |                           |    accountSecret, clientId,       |
   |                           |    redirectUri, codeChallenge,    |
   |                           |    codeChallengeMethod:"S256"}    |
   |                           |<-- {type:"authenticated",         |
   |                           |     clientCode} -----------------|
   |                           |   (ou mfaRequired / failure)      |
   |                           |-- POST /auth/token -------------->|
   |                           |   grant_type=authorization_code,  |
   |                           |   code=client_code, code_verifier,|
   |                           |   client_id, redirect_uri         |
   |                           |   (form-urlencoded, PAS de secret)|
   |                           |<-- {access_token, refresh_token,  |
   |                           |     id_token, expires_in:3600} ---|
   |                           |-- crée session serveur            |
   |                           |   (tokens chiffrés au repos)      |
   |<-- Set-Cookie:            |                                   |
   |    __Host-stalmail_session=<sid opaque> (httpOnly)            |
   |-- redirect /mail/inbox -->|                                   |
```

`/api/auth` renvoie **toujours HTTP 200** ; le statut métier est dans le champ `type` :
`authenticated` (→ `client_code`, snake_case), `mfaRequired` (retry avec `mfaToken`),
`failure` (identifiants rejetés). Le BFF discrimine sur `type`, **jamais sur le code
HTTP**. Voir §10 pour la MFA.

**Refresh** : à l'approche de l'expiration de l'access token (`access_exp`, défaut 1 h) ou
sur 401 Stalwart, le BFF appelle `/auth/token` avec `grant_type=refresh_token`. Le refresh
est à **renouvellement tardif** (confirmé §10, `refreshTokenRenewal`=4 j) : la plupart du
temps le même `refresh_token` est conservé et seul l'`access_token` est remplacé, **mais**
quand le RT entre dans ses 4 derniers jours l'échange renvoie un **nouveau** `refresh_token`.
⚠️ Le BFF **persiste donc tout `refresh_token` présent dans la réponse** (sinon les sessions
casseraient vers J+26). Rafraîchissement **sérialisé par session** : un **mutex par sid en
mémoire** (Map sid → Promise) garantit qu'un seul échange refresh est en vol à la fois —
sans lui, deux requêtes concurrentes pendant la fenêtre de rotation (4 derniers jours du RT)
peuvent perdre le nouveau RT ou faire échouer le second échange → déconnexion intempestive.
Si le refresh échoue (RT expiré/invalide) → **logout propre + redirect `/login`**.

**Logout** — dans le pattern BFF/token-handler, le logout est **côté BFF par conception** :
le navigateur ne détient qu'un cookie de session opaque (jamais de token), donc supprimer
l'enregistrement de session **est** un logout complet. L'absence d'endpoint de révocation
côté Stalwart (confirmé §10) est sans impact ici — les tokens sont des secrets internes au
BFF, exposés à rien. Cinq partis actés :

1. **Logout simple** : suppression de l'enregistrement de session (le cookie ne référence
   plus rien) + `Set-Cookie` avec `Max-Age=0` (mêmes attributs que l'original).
2. **CSRF sur l'action logout** : mutation POST protégée par vérification d'`Origin`
   (cf. §8) — empêche un site tiers de forcer la déconnexion.
3. **« Déconnexion partout »** : un helper `logoutAllForAccount(account_id)` supprime
   **toutes** les sessions du compte (utile après changement de mot de passe / appareil
   perdu). **Implémenté maintenant** côté store ; l'UI de déclenchement viendra plus tard
   (Plan 4 / settings).
4. **Alignement TTL session ↔ RT** : le TTL **absolu** de session (§6) est fixé à **≤ 30 j**
   (`refreshTokenExpiry`), pour que la session ne survive jamais au refresh token ; tout
   échec de refresh force un logout propre (cf. ci-dessus).
5. **Durcissement optionnel (non retenu par défaut)** : `accessTokenExpiry` reste à **1 h** ;
   on ne le raccourcit pas globalement via `x:OidcProvider/set` au vu du modèle de menace
   (tokens internes au BFF). Tracé comme levier de durcissement disponible, non activé.

## 5. Modules et fichiers (BFF)

Nouveaux modules `src/server/` (suivant la convention existante : modules touchant
`node:*` importés **paresseusement dans les handlers** des server functions, car les
fichiers sont tirés dans le bundle client) :

```
src/server/
  stalwart-oauth.ts        → client bas niveau : postApiAuth(), exchangeCode(),
                             refreshTokens(); construit les requêtes /api/auth et
                             /auth/token ; parse les unions taguées.
  oauth-pkce.ts            → génération verifier/challenge S256 + state (node:crypto).
  session-crypto.ts        → dérivation de clés (HKDF depuis STALMAIL_SECRET) +
                             chiffrement/déchiffrement AES-256-GCM des tokens.
  session-store.ts         → store fichier node:fs (Map + write-through atomique) :
                             create/get/touch/delete/deleteAllForAccount/sweepExpired.
  session.ts               → couche métier : login(), logout(),
                             logoutAllForAccount() (déconnexion partout),
                             currentSession(), withFreshAccessToken() (refresh transparent,
                             persiste un refresh_token renvoyé près de l'expiration).
  session-cookie.ts        → lecture/écriture du cookie __Host-stalmail_session.
  login-rate-limit.ts      → rate-limiting BFF des tentatives de login (fenêtre
                             glissante en mémoire, par compte ET par IP) — cf. §9.
  stalwart-hardening.ts    → enableXForwarded() : x:Http/set {useXForwarded:true}
                             via l'admin JMAP, appelé au finalize du wizard — cf. §9.
  auth-actions.ts          → server functions : loginFn, logoutFn, sessionStatusFn.
  stalwart-user.ts         → stalwartUserFetch(path, accessToken, init) : appels
                             Bearer (parallèle à stalwartAdminFetch).
```

Routes / garde :

```
src/routes/login.tsx       → remplace le placeholder par le formulaire custom branché
                             sur loginFn (réutilise i18n + ui du design handoff).
src/lib/auth-guard.ts      → helper beforeLoad partagé : exige une session valide,
                             sinon redirect /login.
src/routes/mail/$folder.tsx, src/routes/index.tsx
                           → beforeLoad protégé par le guard.
```

Chaque module est testable isolément (interfaces étroites) : PKCE pur, crypto pur, store
contre un répertoire temporaire (`STALMAIL_DATA_DIR`), client OAuth contre un fetch mocké.

## 6. Modèle de session et stockage

**Store : fichier JSON via `node:fs`** (PAS `bun:sqlite`) — la prod tourne sous **Node 24**
(`docker/app/Dockerfile` : Bun ne sert qu'au build, le serveur est `node …`) et les tests
sous **vitest/node** ; un module `bun:*` casserait les deux. Le store est donc une **Map en
mémoire** (working set au runtime) avec **persistance write-through** dans un fichier sur un
volume de données app **dédié** (cf. §13), écrit atomiquement (fichier temporaire + `rename`),
rechargé au démarrage. Zéro dépendance native, portable, conforme à l'idiome `node:fs` déjà
employé (`setup-flag.ts`, `setup-state.ts`). Enregistrement par session :

```
SessionRecord {
  sidHash:      string   // SHA-256(sid) hex — la clé de la Map. Le sid (256 bits
                         // aléatoires, base64url) n'existe en clair QUE dans le cookie :
                         // le store ne permet pas de rejouer une session.
  accountId:    string   // accountId JMAP / principal
  accountName:  string   // email, pour l'affichage
  encAccess:    string   // access_token chiffré (AES-256-GCM, base64)
  encRefresh:   string|null  // refresh_token chiffré (si émis)
  accessExp:    number   // epoch s d'expiration de l'access token
  createdAt:    number
  lastSeenAt:   number
}
```

**Chiffrement au repos** : `encAccess`/`encRefresh` chiffrés en AES-256-GCM avec une clé
dérivée par **HKDF-SHA256 depuis `STALMAIL_SECRET`** (`info="stalmail/session-enc"`), avec
**AAD = `sidHash`** (lie chaque ciphertext à son enregistrement — pas de swap de tokens
entre sessions). Combiné aux clés `SHA-256(sid)`, un vol du seul fichier ne livre **ni**
tokens exploitables **ni** identifiants de session rejouables. `STALMAIL_SECRET` est
**obligatoire** (≥ 32 caractères) : le module crypto **échoue au démarrage** s'il est absent
ou trop court — **aucun fallback** sur un autre credential (séparation des clés ; un
`STALMAIL_SESSION_KEY` dédié reste une option future).

**Expiration / nettoyage** : durée de vie de session bornée — **idle TTL 7 j** + **absolu
30 j** (aligné sur `refreshTokenExpiry`=30 j pour que la session ne survive jamais au
refresh token, cf. §4) ; balayage paresseux à l'accès + **sweep global des sessions
expirées à chaque login** (rien ne traîne indéfiniment sur disque) + suppression à la
révocation. `logoutAllForAccount(account_id)` supprime toutes les sessions d'un compte
(« déconnexion partout », cf. §4). Le `lastSeenAt` est persisté avec un **throttle**
(au plus une écriture/minute/session) pour ne pas réécrire le fichier à chaque requête.

**Persistance** : le store survit aux redémarrages/màj du container (volume dédié),
évitant de délogger tout le monde à chaque déploiement. Fichier écrit en mode **0600**
(répertoire 0700) — défense en profondeur en plus du chiffrement et du hash des sids.

## 7. Client OAuth `stalmail` (public, aucun provisioning)

Confirmé empiriquement (capture §10) : **aucun enregistrement de client n'est requis**.
Stalwart v0.16 accepte un `client_id` arbitraire et traite le client comme **public**.

- `client_id = "stalmail"` — constante, pas de secret.
- **PKCE S256 obligatoire** (*enforced* : l'échange sans/mauvais `code_verifier` →
  `invalid_grant`). C'est PKCE — et non un secret client — qui lie le code à l'échange.
- ⚠️ Ne **jamais** envoyer de `Authorization: Basic` ni de `client_secret` à `/auth/token`
  (Stalwart répond `invalid_client`). L'auth client se fait par `client_id` en form + PKCE.
- `redirect_uri` : **URL publique fixe en configuration** (`STALMAIL_PUBLIC_URL`, cf.
  §13) — jamais dérivée des headers de la requête (pas de dépendance à la chaîne proxy,
  pas d'injection de Host). ⚠️ Le « http accepté » observé dans la capture §10 l'a été
  contre un serveur en **mode bootstrap/recovery** ; la doc Stalwart exige `https://`
  hors modes recovery/dev. **https obligatoire en prod**, http toléré seulement en dev.
- Le `client_id` n'est pas une frontière de sécurité ici : la garde réelle est le couple
  identifiants utilisateur (vérifiés par `/api/auth`, anonyme mais rate-limité) + PKCE +
  le fait que seul le BFF (réseau interne) atteint Stalwart.

→ Cette découverte **supprime** toute étape de provisioning à l'install/bootstrap prévue
initialement, et la dérivation d'un secret client (§13 simplifié en conséquence).

## 8. Cookies, CSRF et transport

- Cookie de session : **`__Host-stalmail_session`** — `httpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, pas d'attribut `Domain` (le préfixe `__Host-` l'impose et
  durcit contre la fixation inter-sous-domaines). `SameSite=Lax` (pas `Strict`) pour ne
  pas délogger un utilisateur arrivant via un lien externe.
- **Anti-fixation** : le `sid` est régénéré à chaque login réussi **et la session
  précédente est supprimée** (un sid volé ne survit pas à un re-login).
- **CSRF** : les mutations passent par des server functions POST (**login et logout
  inclus**). Protection par **vérification d'`Origin`** côté serveur, avec **fallback
  `Referer`** quand `Origin` est absent (rejet si origine ≠ origine attendue) en
  complément de `SameSite=Lax`.
- **Confiance dans les headers proxy** : la comparaison d'origine s'appuie sur
  `X-Forwarded-Host` — **Caddy doit écraser** les `X-Forwarded-*` entrants (jamais
  relayer ceux du client). Hypothèse documentée et vérifiée côté infra (cf. §9).
- **Transport** : seul Caddy (443, TLS) est exposé publiquement ; le BFF impose `Secure`
  sur les cookies. En dev (compose.dev, http), prévoir un assouplissement contrôlé du
  flag `Secure`/préfixe `__Host-`.

## 9. Rate-limiting, Fail2Ban et IP réelle du client

Risque spécifique au BFF : Stalwart bannit **par IP source** (`authBanRate`, défaut
**100 échecs/jour**, cf. doc Auto-banning), or toutes les requêtes `/api/auth`
proviennent de l'IP du container BFF. Sans précaution, ~100 mots de passe erronés soumis
via le formulaire public suffisent à faire bannir l'IP du BFF → **panne totale
d'authentification pour tous les utilisateurs**. C'est un DoS trivial : les deux
mitigations ci-dessous sont donc **dans le périmètre du Plan 3a**, pas des follow-ups.

- **`useXForwarded` activé côté Stalwart = condition de mise en service du login.**
  Stalwart ne prend en compte `X-Forwarded-For` que si `server.http.use-x-forwarded`
  (champ `useXForwarded` du singleton `Http`) est activé. Le réglage est poussé via
  **`x:Http/set {useXForwarded: true}`** (admin JMAP) au **finalize du wizard** —
  obligatoirement *avant* `markSetupComplete()`, car l'admin recovery est désactivé au
  redémarrage suivant. Le BFF transmet alors l'**IP réelle du client** à Stalwart
  (`X-Forwarded-For`, chaîne Caddy → BFF → Stalwart) et les bans visent le vrai
  contrevenant.
- **Rate-limiting BFF** (`login-rate-limit.ts`) : fenêtre glissante en mémoire, **par
  compte ET par IP**, vérifiée avant tout appel `/api/auth`. Amortit le bruteforce, ne
  dépend pas du seul ban Stalwart, et limite l'oracle `mfaRequired` (qui confirme un mot
  de passe valide).
- ⚠️ **Anti-spoofing XFF** : le BFF relaie le **premier hop** de `X-Forwarded-For` ; ce
  n'est sûr que si **Caddy écrase** le XFF entrant (comportement par défaut pour les
  clients non listés dans `trusted_proxies` — ne jamais déclarer Internet de confiance).
  Sinon un attaquant choisit l'IP vue par Stalwart : contournement de ban ou **bans
  d'IP arbitraires** (DoS ciblé). Hypothèse à vérifier/documenter côté Caddyfile.

## 10. 2FA (détection maintenant, UI différée)

- `loginFn` traite explicitement la réponse `mfaRequired` de `/api/auth` : la machine
  d'état de login comporte un état `mfa` distinct.
- **v1 (ce plan)** : sur `mfaRequired`, retourner un statut clair (« 2FA pas encore prise
  en charge ») — pas de crash, pas d'erreur opaque. L'architecture (`mfaToken` en retry)
  est en place pour recevoir le flow complet.
- **Différé** : écran de saisie TOTP + retry `/api/auth` avec `mfaToken`, à activer quand
  le wizard exposera l'enrôlement 2FA.

## 11. Sonde JMAP authentifiée (preuve de bout en bout)

Pour prouver que le token Bearer fonctionne réellement contre Stalwart, ce plan inclut un
appel **lecture seule minimal** : `stalwartUserFetch('/jmap/session', accessToken)` après
login, exposé par une server function `sessionStatusFn` qui renvoie `account_name` +
`account_id`. Cela valide la chaîne complète (login → tokens → Bearer JMAP) sans préjuger
des formes de données mail (réservées au Plan 4).

## 12. Gestion des erreurs

- `failure` de `/api/auth` → message générique « identifiants invalides » (pas de fuite
  d'information sur l'existence du compte).
- Indisponibilité Stalwart / timeout → message de réessai, pas de session créée.
- **Toute exception inattendue du handler de login est mappée sur un statut générique
  `error`** — jamais de message d'erreur interne (`OAuthError`, codes HTTP Stalwart…)
  dans la réponse réseau.
- Tentatives au-delà du rate-limit BFF → statut `rateLimited`, message « trop de
  tentatives, réessayez plus tard » (sans révéler la fenêtre exacte).
- Échec d'échange `/auth/token` → login échoué, état propre, rien de persisté.
- Token expiré + refresh échoué → session invalidée, redirect `/login`.
- Session inconnue/expirée à l'accès d'une route protégée → redirect `/login`.

## 13. Variables d'environnement et infra (compose)

- **Nouveau volume de données app dédié** : le service `app` ne monte aujourd'hui que
  `stalmail-shared:/shared` (coordination inter-containers). Ajouter
  `stalmail-app-data:/var/lib/stalmail` (app-only) pour le fichier du store de session.
- **Nouvelles env** : `STALMAIL_DATA_DIR` (défaut `/var/lib/stalmail`) pour localiser la
  base de session ; **`STALMAIL_PUBLIC_URL`** (ex. `https://mail.example.com`) — URL
  publique canonique servant de base au `redirect_uri` OAuth (cf. §7), jamais dérivée
  des headers. `STALMAIL_SECRET` (déjà présent) sert de racine HKDF pour la **clé de
  chiffrement des tokens en session** — **obligatoire, ≥ 32 caractères, fail-hard**
  (cf. §6 ; le client OAuth public n'a pas de secret à dériver).
- `STALWART_URL` (déjà présent) sert aussi aux appels Bearer (même base que l'admin).
- `compose.dev.yml` : assouplissements dev (cookies non-`Secure`, `STALMAIL_PUBLIC_URL`
  en http).

## 14. Tests

- `oauth-pkce` : verifier/challenge conformes RFC 7636 (longueurs, S256).
- `session-crypto` : round-trip chiffrement/déchiffrement ; déchiffrement échoue avec une
  mauvaise clé **ou un mauvais AAD** ; fail-hard si `STALMAIL_SECRET` absent/trop court.
- `session-store` : CRUD contre un `STALMAIL_DATA_DIR` temporaire ; persistance
  rechargée après recreation du store ; expiration ; `deleteAllForAccount` ; mode 0600.
- `login-rate-limit` : blocage au-delà du seuil (par compte et par IP), fenêtre
  glissante, déblocage après expiration.
- `stalwart-oauth` : construction des requêtes `/api/auth` et `/auth/token` ; parsing des
  unions taguées (`authenticated`/`mfaRequired`/`failure`) ; fetch mocké.
- `session` : login crée une session + cookie (et supprime la session précédente) ;
  refresh transparent **sérialisé** (deux appels concurrents → un seul échange) ;
  logout révoque ; sweep des sessions expirées au login.
- `auth-guard` : redirige les non-authentifiés, laisse passer les sessions valides.
- `login.tsx` : rendu du formulaire, soumission, états (checking/error/mfa/rateLimited), i18n.
- Suite complète + `typecheck` verts (porte de fin, comme les plans précédents).

## 15. Hors scope (Plan 3a)

- **Server functions JMAP user-scoped** (queryEmails, getThread, setEmail, sendEmail,
  search, mailbox list) → **Plan 4**, pilotées par les besoins réels de l'UI.
- **SSE / live mail** (relais JMAP push, `/api/token/{kind}` pour EventSource) → Plan 4.
- **Écran de saisie 2FA / TOTP** → différé (cf. §10).
- **App Passwords** (pour clients IMAP/SMTP natifs) → itération ultérieure.
- **OIDC externe / multi-compte / annuaires externes** → hors scope.

## 16. Inconnues — résolues par la capture live

Les 7 inconnues initiales ont été **levées empiriquement** contre Stalwart v0.16.8 — voir
`2026-06-09-stalwart-api-capture.md` §10 (source de vérité / fixtures). Synthèse :

| # | Question initiale | Verdict |
|---|---|---|
| 1 | Enregistrement du client OAuth | ✅ aucun requis — `client_id` arbitraire, client **public** |
| 2 | Auth client à `/auth/token` | ✅ **aucune** — client public, PKCE seul ; un secret → `invalid_client` |
| 3 | Émission/rotation du `refresh_token` | ✅ émis par défaut, **non-rotatif**, réutilisable |
| 4 | Durées de vie | ✅ `access_token` = **3600 s** ; RT longue durée (réutilisable) |
| 5 | Endpoint de révocation | ✅ **aucun** → logout BFF-only (cf. §4) |
| 6 | `X-Forwarded-For` | ⚠️ non prouvable en boîte noire → activé via **`x:Http/set {useXForwarded:true}`** au finalize du wizard, **dans le périmètre 3a** (cf. §9) |
| 7 | Contrainte `redirect_uri` | ⚠️ « http accepté » observé en **mode bootstrap/recovery** uniquement — la doc exige https hors recovery/dev → `STALMAIL_PUBLIC_URL` https en prod (cf. §7) |

⚠️ **Limite de la capture** : elle a été réalisée contre un serveur en **mode
bootstrap/recovery** (« Server started in bootstrap mode », listener `http-recovery`).
Les verdicts sensibles au mode (n° 7 surtout ; n° 1-3 corroborés par la doc —
`requireClientRegistration: false` par défaut, `refreshTokenRenewal: 4d`) sont à
**re-valider contre une instance en mode normal** avant la mise en service.

**Questions ouvertes (à lever empiriquement, hors mode bootstrap)** :
- Stalwart invalide-t-il les access/refresh tokens lors d'un **changement de mot de
  passe** / désactivation du compte ? Si non, brancher `logoutAllForAccount` sur tout
  flux de rotation de credential (Plan 4 / settings) devient **obligatoire**, pas
  optionnel — sinon une session (RT 30 j) survit des semaines à la rotation.

Levier de durcissement disponible mais **non retenu par défaut** (cf. §4, parti 5) :
raccourcir `accessTokenExpiry` via `x:OidcProvider/set` ; laissé à 1 h au vu du modèle de
menace (tokens internes au BFF).

## 17. Références

- Stalwart — OAuth overview / flows / endpoints : https://stalw.art/docs/auth/oauth/
- Stalwart — HTTP API (POST /api/auth, GET /api/account, GET /api/token/{kind}) :
  https://stalw.art/docs/development/api/
- Stalwart — OAuth interoperability (Bearer, App Passwords) :
  https://stalw.art/docs/auth/oauth/interoperability/
- Stalwart — App Passwords : https://stalw.art/docs/auth/authentication/app-password
- OWASP — BFF / Token Handler pattern pour SPA + OAuth.
- Spec produit Stalmail : `docs/superpowers/specs/2026-06-08-stalmail-design.md` (§4
  Sécurité applicative, §5 Server Functions).
- Roadmap : `docs/superpowers/plans/2026-06-08-foundation.md` (Plan 3 = Auth & JMAP BFF).
