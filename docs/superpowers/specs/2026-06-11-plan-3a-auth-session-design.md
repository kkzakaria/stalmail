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
2. **Client OAuth** : client **confidentiel dédié `stalmail`** (`client_secret` + PKCE,
   défense en profondeur ; moindre privilège vs le client `webadmin` de l'admin WebUI),
   provisionné à l'installation/bootstrap.
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
   |                           |   code=clientCode, code_verifier, |
   |                           |   client_id, client_secret,       |
   |                           |   redirect_uri                    |
   |                           |<-- {access_token, refresh_token,  |
   |                           |     expires_in} -----------------|
   |                           |-- crée session serveur            |
   |                           |   (tokens chiffrés au repos)      |
   |<-- Set-Cookie:            |                                   |
   |    __Host-stalmail_session=<sid opaque> (httpOnly)            |
   |-- redirect /mail/inbox -->|                                   |
```

Réponses possibles de `/api/auth` : `authenticated` (→ `clientCode`), `mfaRequired`
(retry avec `mfaToken`), `failure` (identifiants rejetés). Voir §10 pour la MFA.

**Refresh** : à expiration de l'access token (réponse 401 Stalwart ou `expires_at`
dépassé), le BFF appelle `/auth/token` avec `grant_type=refresh_token`. Rotation gérée
côté serveur, sérialisée par session (pas de course de réécriture de cookie).

**Logout** : suppression de l'enregistrement de session (révocation instantanée) +
effacement du cookie + révocation best-effort du token côté Stalwart si l'endpoint le
permet (à valider, §16).

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

## 7. Provisioning du client OAuth `stalmail`

À l'installation/bootstrap, Stalmail enregistre un client OAuth confidentiel dédié :

- `client_id = "stalmail"`, `client_secret` = valeur générée (dérivée de
  `STALMAIL_SECRET` via HKDF `info="stalmail/oauth-client-secret"`, ou secret distinct).
- `redirect_uri` verrouillé sur le callback Stalmail (https en prod ; http toléré en
  dev/recovery — cf. note `/api/auth`).
- Provisionnement via le recovery-admin déjà détenu par le BFF (même canal que les
  opérations du wizard).
- ⚠️ Le **mécanisme exact d'enregistrement** (config statique vs management API vs
  Dynamic Client Registration) est à **valider empiriquement contre v0.16** (§16). Si la
  v0.16 impose un client pré-déclaré et n'accepte pas un `client_id` arbitraire avec
  PKCE public, le provisioning confidentiel devient obligatoire ; sinon un client public
  + PKCE est le repli acceptable.

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
  → BFF → Stalwart), pour que les bans visent le vrai contrevenant. (Honneur de
  `X-Forwarded-For` par Stalwart derrière proxy de confiance à valider, §16.)
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
  base de session. `STALMAIL_SECRET` (déjà présent) sert de racine HKDF pour les clés de
  chiffrement de session et le secret client OAuth.
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

## 16. À valider empiriquement contre Stalwart v0.16

(Dans l'esprit des captures d'API du wizard — cf. `2026-06-09-stalwart-api-capture`.)

1. Mécanisme d'enregistrement du client OAuth `stalmail` (config statique / management
   API / Dynamic Client Registration) ; un `client_id` non pré-déclaré est-il accepté ?
2. Méthode d'authentification client à `/auth/token` (`client_secret_basic` vs
   `client_secret_post`) et paramètres exacts du grant `authorization_code`.
3. Émission de `refresh_token` par défaut et comportement de rotation.
4. Durées de vie par défaut (`access_token`, `refresh_token`) via la métadonnée
   `/.well-known/oauth-authorization-server` ou l'objet `OidcProvider`.
5. Présence/forme d'un endpoint de **révocation** de token pour le logout.
6. Honneur de `X-Forwarded-For` par Stalwart pour le rate-limiting/Fail2Ban derrière
   proxy de confiance.
7. Contraintes `redirect_uri` (https obligatoire ?) en mode normal vs dev.

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
