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
   serveur** (`bun:sqlite`), **tokens chiffrés au repos**. Révocation instantanée.
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

**Refresh** : à l'approche de l'expiration de l'access token (`access_exp`, défaut 3600 s)
ou sur 401 Stalwart, le BFF appelle `/auth/token` avec `grant_type=refresh_token`. Le
refresh est **non-rotatif** (confirmé §10) : le même `refresh_token` est conservé, seul
l'`access_token` est remplacé. Rafraîchissement sérialisé par session (pas de course de
réécriture du store).

**Logout** : Stalwart **n'expose aucun endpoint de révocation** (confirmé §10). Le logout
est donc **purement côté BFF** : suppression de l'enregistrement de session (le cookie ne
référence plus rien d'utilisable) + effacement du cookie. Les tokens restent
techniquement valides côté Stalwart jusqu'à expiration naturelle — d'où l'importance de
ne jamais les exposer hors du BFF et de garder des TTL d'access token courts.

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
  session-store.ts         → store bun:sqlite : create/get/touch/delete/refresh.
  session.ts               → couche métier : login(), logout(), currentSession(),
                             withFreshAccessToken() (refresh transparent).
  session-cookie.ts        → lecture/écriture du cookie __Host-stalmail_session.
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
contre une sqlite temporaire, client OAuth contre un fetch mocké.

## 6. Modèle de session et stockage

**Store : `bun:sqlite`** (natif Bun, zéro dépendance) dans un volume de données app
**dédié** (cf. §13). Schéma minimal :

```
sessions(
  sid            TEXT PRIMARY KEY,   -- 256 bits aléatoires, opaque (base64url)
  account_id     TEXT NOT NULL,      -- accountId JMAP / principal
  account_name   TEXT NOT NULL,      -- email, pour l'affichage
  enc_access     BLOB NOT NULL,      -- access_token chiffré (AES-256-GCM)
  enc_refresh    BLOB,               -- refresh_token chiffré (si émis)
  access_exp     INTEGER NOT NULL,   -- epoch s d'expiration de l'access token
  created_at     INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL
)
```

**Chiffrement au repos** : `enc_access`/`enc_refresh` chiffrés en AES-256-GCM avec une
clé dérivée par **HKDF-SHA256 depuis `STALMAIL_SECRET`** (`info="stalmail/session-enc"`).
Un vol du seul fichier sqlite ne livre donc pas de tokens exploitables. (Pas de nouvelle
variable d'env : on dérive des sous-clés distinctes du secret unique déjà présent ;
introduire un `STALMAIL_SESSION_KEY` dédié reste une option future.)

**Expiration / nettoyage** : durée de vie de session bornée (idle TTL ex. 7 j + absolu
ex. 30 j — valeurs à confirmer) ; balayage paresseux des sessions expirées à l'accès +
suppression à la révocation.

**Persistance** : le store survit aux redémarrages/màj du container (volume dédié),
évitant de délogger tout le monde à chaque déploiement.

## 7. Client OAuth `stalmail` (public, aucun provisioning)

Confirmé empiriquement (capture §10) : **aucun enregistrement de client n'est requis**.
Stalwart v0.16 accepte un `client_id` arbitraire et traite le client comme **public**.

- `client_id = "stalmail"` — constante, pas de secret.
- **PKCE S256 obligatoire** (*enforced* : l'échange sans/mauvais `code_verifier` →
  `invalid_grant`). C'est PKCE — et non un secret client — qui lie le code à l'échange.
- ⚠️ Ne **jamais** envoyer de `Authorization: Basic` ni de `client_secret` à `/auth/token`
  (Stalwart répond `invalid_client`). L'auth client se fait par `client_id` en form + PKCE.
- `redirect_uri` : verrouillé sur le callback Stalmail. http accepté par le serveur ;
  on garde https en prod par hygiène, http toléré en dev.
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
- **Anti-fixation** : le `sid` est régénéré à chaque login réussi.
- **CSRF** : les mutations passent par des server functions POST. Protection par
  **vérification d'`Origin`/`Referer`** côté serveur (rejet si origine ≠ origine
  attendue) en complément de `SameSite=Lax`. Documenter le mécanisme retenu dans le plan.
- **Transport** : seul Caddy (443, TLS) est exposé publiquement ; le BFF impose `Secure`
  sur les cookies. En dev (compose.dev, http), prévoir un assouplissement contrôlé du
  flag `Secure`/préfixe `__Host-`.

## 9. Rate-limiting, Fail2Ban et IP réelle du client

Risque spécifique au BFF : Stalwart applique rate-limiting et Fail2Ban **par IP source**,
or toutes les requêtes `/api/auth` proviennent de l'IP du container BFF. Sans précaution,
quelques échecs de login banniraient le BFF **pour tous les utilisateurs**.

- Le BFF transmet l'**IP réelle du client** à Stalwart (`X-Forwarded-For`, chaîne Caddy
  → BFF → Stalwart), pour que les bans visent le vrai contrevenant. ⚠️ Stalwart ne prend
  en compte `X-Forwarded-For` que si **`server.http.use-x-forwarded` est activé** côté
  Stalwart (tâche de **configuration infra**, à câbler dans l'image/le bootstrap — cf.
  capture §10, point non prouvable en boîte noire).
- Le BFF applique en complément son **propre rate-limiting** des tentatives de login
  (par compte et/ou par IP) avant d'appeler `/api/auth`, pour amortir le bruteforce et
  ne pas dépendre uniquement de Stalwart.

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
- Échec d'échange `/auth/token` → login échoué, état propre, rien de persisté.
- Token expiré + refresh échoué → session invalidée, redirect `/login`.
- Session inconnue/expirée à l'accès d'une route protégée → redirect `/login`.

## 13. Variables d'environnement et infra (compose)

- **Nouveau volume de données app dédié** : le service `app` ne monte aujourd'hui que
  `stalmail-shared:/shared` (coordination inter-containers). Ajouter
  `stalmail-app-data:/var/lib/stalmail` (app-only) pour le store de session sqlite.
- **Nouvelle env** : `STALMAIL_DATA_DIR` (défaut `/var/lib/stalmail`) pour localiser la
  base de session. `STALMAIL_SECRET` (déjà présent) sert de racine HKDF pour la **clé de
  chiffrement des tokens en session** (le client OAuth public n'a pas de secret à dériver).
- `STALWART_URL` (déjà présent) sert aussi aux appels Bearer (même base que l'admin).
- `compose.dev.yml` : assouplissements dev (cookies non-`Secure`, redirect_uri http).

## 14. Tests

- `oauth-pkce` : verifier/challenge conformes RFC 7636 (longueurs, S256).
- `session-crypto` : round-trip chiffrement/déchiffrement ; déchiffrement échoue avec une
  mauvaise clé ; clés HKDF distinctes par `info`.
- `session-store` : CRUD contre sqlite temporaire ; expiration ; révocation.
- `stalwart-oauth` : construction des requêtes `/api/auth` et `/auth/token` ; parsing des
  unions taguées (`authenticated`/`mfaRequired`/`failure`) ; fetch mocké.
- `session` : login crée une session + cookie ; refresh transparent ; logout révoque.
- `auth-guard` : redirige les non-authentifiés, laisse passer les sessions valides.
- `login.tsx` : rendu du formulaire, soumission, états (checking/error/mfa), i18n.
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
| 6 | `X-Forwarded-For` | ⚠️ non prouvable en boîte noire → **config infra** `server.http.use-x-forwarded` (cf. §9) |
| 7 | Contrainte `redirect_uri` | ✅ http accepté ; https en prod par hygiène |

**Seul reliquat** : activer `server.http.use-x-forwarded` côté Stalwart (tâche infra, §9).
Option de durcissement à considérer dans le plan : **raccourcir le TTL d'access token**
via l'objet `OidcProvider` (le logout étant BFF-only, des AT courts limitent la fenêtre
de validité résiduelle après logout).

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
