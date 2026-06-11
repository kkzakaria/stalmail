# Revue de sécurité — Plan 3a Auth & Session

> **Statut : constats intégrés** (2026-06-11). Tous les points C1–C2, H1–H3, M1–M5 et
> L1–L6 ont été repris dans la spec et le plan (voir le tableau §6 pour le mapping).
> Restent **à exécuter hors de ce repo / avant mise en service** : la re-validation de
> la capture hors mode bootstrap, la vérification `trusted_proxies` du Caddyfile, et la
> question de l'invalidation des tokens au changement de mot de passe (spec §16).

**Date :** 2026-06-11
**Objets revus :**
- Spec : `docs/superpowers/specs/2026-06-11-plan-3a-auth-session-design.md`
- Plan : `docs/superpowers/plans/2026-06-11-plan-3a-auth-session.md`
- Capture : `docs/superpowers/specs/2026-06-09-stalwart-api-capture.md` (recoupements ciblés)
- Doc Stalwart (v0.16) : OAuth overview/endpoints/interoperability, HTTP API
  (`/api/auth`), `OidcProvider`, Auto-banning, App Passwords, HTTP overview.

**Verdict global :** l'architecture (BFF / token-handler, tokens 100 % côté serveur,
cookie opaque `__Host-` httpOnly, PKCE S256, chiffrement au repos) est saine et conforme
aux recommandations OWASP. La doc Stalwart **corrobore** les paramètres clés du design
(`accessTokenExpiry` 1 h, `refreshTokenExpiry` 30 j, `refreshTokenRenewal` 4 j,
`authCodeExpiry` 10 min, `authCodeMaxAttempts` 3, `requireClientRegistration: false` par
défaut → client public à `client_id` arbitraire). En revanche, **2 constats critiques
conditionnent la mise en service**, et plusieurs promesses de la spec ne sont **pas
implémentées par le plan** (drift spec → plan).

---

## 1. Constats critiques (bloquants avant mise en service)

### C1 — DoS d'authentification trivial : auto-ban Stalwart sur l'IP du BFF

La doc Auto-banning confirme : les échecs d'authentification de **tous** les services
alimentent un compteur **par IP source** (`authBanRate`, défaut **100 échecs/jour**) ;
au-delà, l'IP est bannie (`authBanPeriod`) et **toutes** ses connexions sont coupées.

Or le plan livre le formulaire de login public alors que :
1. `server.http.use-x-forwarded` est repoussé en « follow-up infra » (Task 12 : *not
   changed here*) — sans lui, Stalwart ignore le header `X-Forwarded-For` envoyé par le
   BFF et voit **l'IP du container BFF** pour tous les utilisateurs ;
2. le **rate-limiting BFF** promis par la spec (§9 : « Le BFF applique en complément son
   propre rate-limiting des tentatives de login ») **n'a aucune tâche dans le plan**.

Conséquence : un attaquant (ou simplement quelques utilisateurs maladroits) soumet ~100
mots de passe erronés via le formulaire → Stalwart bannit l'IP du BFF → **panne totale
d'authentification pour tout le monde**, sans intervention de l'attaquant au-delà d'un
script de quelques secondes.

**Exigences :**
- Faire de l'activation de `server.http.use-x-forwarded` une **condition de mise en
  service** du login (pas un follow-up) — l'intégrer au bootstrap/image, ou au minimum
  au gate final du plan.
- Ajouter une tâche de **rate-limiting côté BFF** (par compte et par IP, fenêtre
  glissante en mémoire suffit pour un mono-process) avant l'appel `/api/auth`, comme la
  spec §9 l'exige.

### C2 — Verdict « redirect_uri http accepté » obtenu en mode bootstrap : non transposable en prod

La doc HTTP API est explicite : `redirectUri` « **must use `https://` unless the server
is in recovery or dev mode** ». Or la capture du 2026-06-09 a été réalisée contre un
serveur **en mode bootstrap/recovery** (« Server started in bootstrap mode », listener
`http-recovery`). Le verdict §16/#7 de la spec (« http accepté ») décrit donc le
comportement du mode recovery, pas celui d'une instance de production.

Risques induits :
- En prod, un `redirect_uri` http sera vraisemblablement **rejeté** → login cassé en
  dev-compose si le BFF envoie `http://…`, et surtout comportement non testé en prod.
- `loginHandler` **dérive `redirectUri` des headers** (`x-forwarded-proto` avec fallback
  `'http'`, `x-forwarded-host`/`host` avec fallback `'localhost'`). C'est fragile
  (dépend de la chaîne proxy) et inutile : dans ce flux, l'URI n'est jamais utilisée pour
  rediriger — c'est un paramètre de liaison OAuth.

**Exigences :**
- Re-valider les verdicts de la capture **hors mode bootstrap** (au moins : client
  public, http accepté, rotation RT). La doc corrobore le client public
  (`requireClientRegistration: false` par défaut), mais c'est une config par défaut, pas
  une garantie structurelle.
- Remplacer la dérivation par headers par une **URL publique fixe en configuration**
  (ex. `STALMAIL_PUBLIC_URL`, https en prod), utilisée à l'identique pour `/api/auth` et
  `/auth/token`.

---

## 2. Constats élevés

### H1 — `sessions.json` contient les `sid` en clair : le chiffrement au repos ne protège pas ce qu'il prétend

Le `sid` **est** le credential porteur (la valeur du cookie). Le store persiste les
records indexés par `sid` en clair ; seuls les tokens OAuth sont chiffrés. Le claim de
la spec §6 (« Un vol du seul fichier ne livre donc pas de tokens exploitables ») est
**trompeur** : un vol du fichier livre tous les `sid` actifs, donc le **hijack immédiat
de toutes les sessions** (il suffit de poser le cookie) — l'attaquant n'a pas besoin des
tokens.

**Exigence :** stocker `hash(sid)` (SHA-256 suffit, le sid a 256 bits d'entropie) comme
clé du store ; le BFF hashe le cookie entrant avant lookup. Coût quasi nul, supprime la
classe d'attaque. En complément : fichier en mode `0600`, répertoire `0o700`
(`writeFileSync(..., { mode: 0o600 })`).

### H2 — Refresh non sérialisé : promesse de la spec absente du plan

Spec §4 : « Rafraîchissement **sérialisé par session** (pas de course de réécriture du
store) ». Le `withFreshAccessToken` du plan (Task 6) n'a **aucune sérialisation** : deux
requêtes concurrentes après expiration déclenchent deux refresh parallèles. Pendant la
fenêtre de renouvellement tardif (4 derniers jours du RT, confirmée par
`refreshTokenRenewal: 4d`), une course peut faire perdre le nouveau RT persisté (write
après write) ou faire échouer le second échange → `deleteSession` → **déconnexion
intempestive**, exactement le scénario que la spec voulait éviter.

**Exigence :** mutex par `sid` (une `Map<sid, Promise>` en mémoire suffit en
mono-process) autour du chemin refresh + persist.

### H3 — `clientIp()` prend le premier hop de `X-Forwarded-For` : IP spoofable

`clientIp()` retourne `xff.split(',')[0]`. Si Caddy **ajoute** au lieu d'écraser le XFF
entrant (comportement dépendant de `trusted_proxies`), un client peut envoyer
`X-Forwarded-For: 198.51.100.9` et c'est cette IP que le BFF transmettra à Stalwart.
Combiné à C1/`use-x-forwarded`, cela permet :
- de **contourner** le ban par IP (rotation d'IP fictives) — atténué par le fait que
  Stalwart compte aussi par login name (doc Auto-banning), mais pas neutralisé ;
- de **faire bannir des IP arbitraires** (frame d'un tiers, DoS ciblé).

**Exigence :** garantir côté Caddy que `X-Forwarded-For` entrant est écrasé (config
`trusted_proxies` ; ne jamais faire confiance au XFF venant d'Internet), documenter
cette hypothèse dans le plan, et la tester. À défaut, utiliser l'IP de connexion vue par
le BFF plutôt que le premier hop.

---

## 3. Constats moyens

### M1 — Le login ne révoque pas la session précédente
`loginHandler` écrit un nouveau `sid` mais ne supprime pas l'ancien record si l'usager
était déjà connecté : l'ancienne session reste valide jusqu'à son TTL. Un `sid` volé
**survit donc à un re-login**. Corriger : au login, si `readSid()` retourne un sid
existant, le supprimer avant de créer la nouvelle session.

### M2 — Aucun balayage global des sessions expirées
`sweep()` existe dans le store mais **rien ne l'appelle** : une session expirée n'est
purgée que si on présente son `sid`. Les records (et RT chiffrés) s'accumulent
indéfiniment sur disque. Corriger : sweep au démarrage + périodique (ou à chaque
création de session).

### M3 — Survie des sessions au changement de mot de passe : non vérifié
`logoutAllForAccount` existe mais n'est branché nulle part, et il n'est **pas vérifié**
que Stalwart invalide les access/refresh tokens lors d'un changement de mot de passe ou
d'une désactivation de compte. Si non, une session (RT 30 j) survit des semaines à une
rotation de credential. À vérifier empiriquement (hors mode bootstrap) et à tracer comme
exigence du flux « changement de mot de passe » (Plan 4 / wizard).

### M4 — CSRF : Origin absent = accepté, pas de fallback Referer, confiance en `x-forwarded-host`
La spec §8 annonce « vérification d'`Origin`/`Referer` » ; le plan ne vérifie que
`Origin` et **laisse passer** les requêtes sans Origin. Les navigateurs modernes
envoient Origin sur les POST cross-origin, donc le risque résiduel est faible, mais :
(1) ajouter le fallback Referer quand Origin est absent (alignement spec) ;
(2) `assertSameOrigin` compare à `x-forwarded-host` — même hypothèse qu'en H3 : Caddy
doit écraser ce header, à documenter/tester.

### M5 — Fallback silencieux de la racine crypto sur `STALWART_RECOVERY_ADMIN`
`session-crypto.rootSecret()` retombe sur le **mot de passe admin recovery** si
`STALMAIL_SECRET` est absent : violation de séparation des clés (la sous-clé de
chiffrement des tokens dérive d'un credential d'administration), et risque qu'une prod
mal configurée tourne silencieusement sur ce fallback. `compose.yml` rend la variable
obligatoire (`:?`), mais le code doit l'imposer aussi : **fail-hard en production** si
`STALMAIL_SECRET` est absent, et exiger une longueur minimale (≥ 32 octets).

---

## 4. Constats faibles / hygiène

- **L1 — Schéma zod sans bornes hautes** : `email`/`password` en `min(1)` seulement ;
  borner (`max(254)` / `max(1024)`) pour ne pas relayer des payloads démesurés à
  Stalwart.
- **L2 — `mfaRequired` confirme un mot de passe valide** : un attaquant qui reçoit le
  statut `mfa` sait que les identifiants sont corrects. Inhérent au flow `/api/auth`,
  mais à garder en tête : c'est une raison de plus pour le rate-limiting BFF (C1).
- **L3 — Erreurs internes remontées brutes** : `OAuthError('/auth/token HTTP 500')` se
  propage tel quel hors de `loginFn` (visible dans la réponse réseau). Mapper toute
  exception du handler vers un statut générique `error`.
- **L4 — `persist()` réécrit tout le fichier à chaque requête** : `currentSession` fait
  un `updateSession(lastSeenAt)` → write synchrone du store complet sur **chaque**
  requête authentifiée. Disponibilité/perf : throttler le touch (ex. persister
  `lastSeenAt` au plus une fois par minute par session).
- **L5 — AES-GCM sans AAD** : lier le ciphertext à la session (AAD = `sid` ou
  `hash(sid)`) pour empêcher le swap de tokens entre records par un attaquant en
  écriture sur le fichier.
- **L6 — Pas de journal d'audit auth** : logguer (sans secrets) succès/échecs de login
  avec IP et compte — nécessaire pour détecter le bruteforce et exploiter les bans.

---

## 5. Points forts confirmés

- **Pattern BFF/token-handler au sens fort** : tokens jamais exposés au navigateur,
  cookie opaque `__Host-` httpOnly/Secure/SameSite=Lax, logout = purge serveur —
  cohérent avec l'absence d'endpoint de révocation Stalwart (confirmée par la doc :
  seuls `/auth/token`, `/auth/introspect`, `/auth/device`, etc. existent).
- **PKCE S256** systématique, vecteur de test RFC 7636 annexe B dans le plan ; la doc
  confirme `codeChallengeMethod` défaut `plain` quand un challenge est présent → le plan
  envoie bien `S256` explicitement.
- **TTL alignés** : session absolue 30 j = `refreshTokenExpiry` (défaut doc 30 j) ;
  gestion correcte du renouvellement tardif du RT (`refreshTokenRenewal` 4 j) avec
  persistance de tout RT retourné.
- **Anti-énumération** : message générique sur `failure`, discrimination sur `type`
  métier et non sur le code HTTP (conforme au contrat `/api/auth` documenté).
- **Découpage testable** : crypto/PKCE/store/client OAuth isolés et testés, gate final
  suite complète + typecheck.

---

## 6. Récapitulatif des actions

| # | Sévérité | Action | Où |
|---|---|---|---|
| C1 | Critique | `use-x-forwarded` = condition de mise en service + tâche rate-limiting BFF | Plan (nouvelle tâche + Task 12/13) |
| C2 | Critique | `STALMAIL_PUBLIC_URL` fixe (https) au lieu des headers ; re-valider la capture hors mode bootstrap | Task 8 + capture |
| H1 | Élevé | Stocker `hash(sid)`, fichier 0600 | Task 3/6 |
| H2 | Élevé | Mutex de refresh par sid | Task 6 |
| H3 | Élevé | Caddy écrase XFF (`trusted_proxies`), documenter/tester | Infra + Task 7 |
| M1 | Moyen | Supprimer l'ancienne session au login | Task 8 |
| M2 | Moyen | Sweep périodique/au démarrage | Task 3/6 |
| M3 | Moyen | Vérifier invalidation tokens au changement de mdp ; brancher `logoutAllForAccount` | Capture + Plan 4 |
| M4 | Moyen | Fallback Referer ; hypothèse `x-forwarded-host` documentée | Task 7 |
| M5 | Moyen | Fail-hard sans `STALMAIL_SECRET` en prod + longueur min | Task 2 |
| L1–L6 | Faible | Bornes zod, mapping d'erreurs, throttle persist, AAD, audit log | Tasks 2/3/8 |
