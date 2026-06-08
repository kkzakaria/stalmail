# Stalmail — Design Document

**Date :** 2026-06-08  
**Stack :** TanStack Start · React 19 · Tailwind v4 · shadcn/ui  
**Stalwart version cible :** v0.16.x

---

## 1. Vision

Stalmail est un webmail client pour [Stalwart](https://stalw.art/) qui simplifie radicalement le self-hosting d'un serveur mail. L'objectif : un utilisateur solo, une famille, une petite équipe ou un développeur peut lancer son propre serveur mail en une seule commande, sans toucher à la configuration de Stalwart.

**Cible :** self-hosters solo, petites équipes/familles, développeurs.

---

## 2. Architecture globale

### Approche retenue : TanStack Start comme shell

TanStack Start est le point d'entrée de l'application. Au premier démarrage, il détecte que Stalwart n'est pas configuré et affiche le wizard. Après le wizard, Stalwart tourne configuré et le webmail est opérationnel.

### Image Docker

```
FROM debian:bookworm-slim
# binaire Stalwart (copié depuis image officielle stalwartlabs/stalwart)
# build TanStack Start (Node.js)
# Caddy pour TLS termination
COPY entrypoint.sh /
VOLUME /etc/stalwart   # bootstrap config (minimal, recréable)
VOLUME /var/lib/stalwart  # CRITIQUE : emails + clés + config complète
EXPOSE 443 80 25 587 465 993 143
ENTRYPOINT ["/entrypoint.sh"]
```

### entrypoint.sh

1. Initialise `/var/lib/stalwart/` si première exécution
2. Démarre Stalwart en background (SIGTERM forwarded)
3. Healthcheck : attend que Stalwart réponde sur `:8080`
4. Démarre le serveur TanStack Start

### Topologie réseau interne

```
Browser
  ↓ HTTPS :443
Caddy (TLS termination)
  ↓ HTTP
TanStack Start :3000  (BFF)
  ↓ HTTP localhost
Stalwart :8080  (JMAP + API admin — jamais exposé publiquement)

Ports mail exposés directement (clients natifs) :
  25 / 587 / 465  SMTP
  993 / 143       IMAP
```

### Installation utilisateur

```bash
curl -sSL https://get.stalmail.io | sh
```

Le script vérifie Docker, crée les volumes nommés, lance le container avec tous les ports, ouvre le browser sur le wizard. La commande `docker run` complète est documentée pour les utilisateurs avancés mais n'est pas le happy path.

### Variables d'environnement

| Variable | Usage | Obligatoire |
|---|---|---|
| `STALMAIL_SECRET` | Clé de signature des sessions (générée automatiquement par l'install script si absente) | Oui |
| `STALMAIL_PORT` | Port HTTPS (défaut : 443) | Non |

Tout le reste est configuré via le wizard.

---

## 3. Volumes et sécurité des données

Stalwart v0.16 stocke **tout** dans sa base de données interne :
- Clés DKIM privées (rotation automatique tous les 90j par défaut)
- Clés ACME et certificats TLS (renouvellement automatique)
- Configuration complète (plus de split fichier/BDD depuis v0.16)
- Emails, index full-text, cache

| Volume | Contenu | Criticité |
|---|---|---|
| `stalmail-config` → `/etc/stalwart/` | Fichier bootstrap minimal pointant vers la BDD | Faible — recréable |
| `stalmail-data` → `/var/lib/stalwart/` | **Tout** : emails, toutes les clés, toute la config | **Critique — backup impératif** |

Stalwart gère le cycle de vie des clés nativement (émission, renouvellement, rotation DKIM). Aucune gestion manuelle de clés dans Stalmail.

**Permissions :** les volumes sont montés avec UID 2000 (compte de service Stalwart).

**Rappel backup :** affiché en fin de wizard et dans les réglages — uniquement `stalmail-data`.

---

## 4. Sécurité applicative

**Tokens OAuth en httpOnly cookies**  
Le serveur TanStack Start (BFF) gère le flow OAuth complet avec Stalwart. Les tokens d'accès sont stockés en httpOnly cookies — invisibles au JavaScript, immunisés contre XSS. Le browser ne détient jamais de token.

**API admin Stalwart isolée**  
L'API admin (`/api/*`) de Stalwart n'est jamais exposée publiquement. Seul le BFF y accède, uniquement durant le wizard et les opérations d'administration.

**Surface d'attaque**  
Seul le port 443 (HTTPS) est exposé pour le webmail. Les ports mail (25, 587, etc.) sont exposés séparément pour les clients natifs mais ne donnent pas accès à l'interface web.

---

## 5. Structure de l'application TanStack Start

### Routes

```
/setup/*          → Wizard first-run (6 étapes)
/login            → Authentification OAuth
/                 → Redirect vers /mail/inbox
/mail/:folder     → Dossier (inbox, sent, drafts, trash, spam, archive, snoozed)
/mail/label/:id   → Vue étiquette
/settings/*       → Réglages utilisateur
```

**Détection first-run :** le BFF vérifie la présence d'un fichier flag `/var/lib/stalwart/.stalmail-configured` au démarrage. Ce fichier est créé par le BFF à la fin du wizard (étape 6). Si absent → redirect `/setup`. Si présent et non authentifié → redirect `/login`. Si présent et authentifié → `/mail/inbox`. Cette approche évite de dépendre du format de réponse de Stalwart en mode bootstrap.

**Auth BFF → API admin Stalwart (pendant le wizard) :** Stalwart démarre en "bootstrap mode" avec des credentials temporaires. L'image Docker stalmail définit `STALWART_RECOVERY_ADMIN=stalmail-internal:<secret>` comme variable d'environnement interne (générée à l'installation, jamais exposée à l'utilisateur). Le BFF utilise ce credential pour appeler l'API admin de Stalwart pendant toute la durée du wizard. Une fois le wizard terminé, ce credential n'est plus utilisé — les appels admin passent par le token OAuth de l'utilisateur admin.

### Server Functions (BFF)

```
src/server/
  auth.ts        → login, logout, refresh token OAuth
  jmap.ts        → queryEmails, getThread, setEmail, sendEmail, search
  events.ts      → SSE relay depuis JMAP push Stalwart
  admin.ts       → appels API admin Stalwart (wizard uniquement)
```

### Composants principaux

Alignés sur le design Claude Design fourni :

```
Sidebar           → navigation, compte, étiquettes, thème (light/dark)
MailList          → threads, filtres, tri, multi-select (Shift+click)
Reader            → lecteur de thread complet
Composer          → modal nouveau message / réponse / transfert
SetupWizard       → 6 étapes first-run
Toast             → feedback actions (archive, snooze, label…)
```

### State management

- **TanStack Query** pour le cache serveur (emails, threads, dossiers)
- **Loaders TanStack Router** pour le pre-fetch au changement de dossier
- **Mutations optimistes** : archive, star, move, label répondent immédiatement ; rollback si la confirmation BFF échoue

---

## 6. Setup Wizard (6 étapes)

Linéaire, une seule décision par écran. Repris-able : si le browser se ferme en cours, la progression est persistée côté serveur.

| Étape | Contenu |
|---|---|
| 1. Bienvenue | Choix de langue, bouton Commencer |
| 2. Domaine | Saisie du hostname public (`mail.exemple.fr`). Vérification DNS optionnelle (warning si le domaine ne pointe pas encore sur cette IP). |
| 3. DNS Provider | Sélection parmi les 58+ providers intégrés Stalwart (Cloudflare, OVH, Gandi…) ou "Manuel". Saisie clé API. Configuration automatique MX, SPF, DKIM, DMARC avec statut temps réel par record (✓ créé / ⚠ existant / ✕ erreur). Option Manuel affiche les records à copier-coller. |
| 4. SSL | Aucune action utilisateur. Le BFF déclenche la demande ACME via l'API admin Stalwart. Progression temps réel via SSE. En cas d'échec : message clair avec cause et lien doc. |
| 5. Premier compte | Nom complet, adresse email, mot de passe. Ce compte est admin et premier utilisateur. Indicateur de force du mot de passe. |
| 6. Terminé | Récap (domaine, SSL, compte). Rappel backup `stalmail-data`. Bouton "Ouvrir ma boîte mail" → `/login`. |

**Technique :** toutes les étapes appellent des server functions qui proxient vers l'API admin Stalwart (port interne). Le browser n'appelle jamais l'API admin directement.

---

## 7. Flux email — JMAP

### Protocole

JMAP (`/jmap` sur Stalwart) est le protocole unique pour toutes les opérations email. JSON sur HTTP, conçu pour les webmails, supporte le push natif.

### Opérations principales

| Action | Méthode JMAP |
|---|---|
| Lister les threads | `Email/query` + `Thread/get` + `Email/get` |
| Lire un email | `Email/get` (corps complet) |
| Envoyer / répondre | `Email/set` (draft) + `EmailSubmission/set` |
| Archiver / déplacer | `Email/set` (update `mailboxIds`) |
| Étoiler | `Email/set` (update `keywords`) |
| Recherche full-text | `Email/query` avec `filter` |
| Étiquettes | Mailboxes JMAP custom |
| Snooze | Déplacement vers mailbox `snoozed` + métadonnée de date |

### Temps réel (live mail)

Stalwart expose un endpoint JMAP push via SSE. Le BFF subscribe au push et relaie les événements au client via `/api/events`. À réception d'un événement, TanStack Query invalide le cache concerné. Implémentation du "live mail" visible dans le design.

---

## 8. Features webmail (scope initial)

D'après le design Claude Design :

- Layout 3 colonnes : Sidebar / Liste / Lecteur
- Thème light/dark, couleur accent personnalisable
- Densité compact / normal / confortable
- Multi-compte (compte secondaire dans le menu utilisateur)
- Étiquettes colorées (création, assignation, filtrage)
- Multi-sélection (clic + Shift+clic pour plage)
- Actions en hover : archiver, étiqueter, snooze, supprimer
- Snooze avec options prédéfinies (plus tard aujourd'hui, demain, week-end, semaine prochaine)
- Filtres : Tous / Non lus / Favoris + filtre par date (aujourd'hui, hier, 7j, 30j, plage custom)
- Tri date ascendant / descendant
- Recherche (raccourci `/`)
- Raccourci `c` pour composer
- AI summary (toggleable) — **stub dans la v1** : le toggle existe dans l'UI mais la feature est désactivée ; l'implémentation (résumé local ou API externe) est hors scope initial
- Toast notifications pour toutes les actions
- Composer modal (nouveau message, réponse, transfert)

**Hors scope initial :** calendrier, contacts (CalDAV/CardDAV — prévu dans une itération suivante).

---

## 9. Gestion des erreurs

| Niveau | Comportement |
|---|---|
| Erreurs JMAP | Toast avec message lisible, mutations optimistes rollback-ées |
| Erreur auth (401) | Redirect transparent vers `/login`, état de la page mémorisé pour retour |
| Erreurs wizard | État d'erreur par étape, message actionnable, wizard repris-able |
| SSL/ACME échec | Message avec cause précise + lien documentation Stalwart |
| DNS échec | Détail par record, option bascule vers configuration manuelle |

---

## 10. Hors scope — itérations futures

- Calendrier (CalDAV)
- Contacts (CardDAV)
- Panel admin multi-utilisateurs
- Support POP3
- Notifications push mobile

---

## Références

### Stalwart
- [Site officiel](https://stalw.art/)
- [GitHub stalwartlabs/stalwart](https://github.com/stalwartlabs/stalwart)
- [Releases (v0.16.x)](https://github.com/stalwartlabs/stalwart/releases)
- [Blog — Stalwart v0.16 : A New Foundation](https://stalw.art/blog/stalwart-0-16/) — architectural changes (all config in DB, DKIM in DB)
- [Blog — Roadmap & webmail](https://stalw.art/blog/roadmap/)
- [Documentation — Installation Docker](https://stalw.art/docs/install/platform/docker/)
- [Documentation — Vue d'ensemble HTTP](https://stalw.art/docs/http/overview/)
- [Documentation — API Endpoints](https://stalw.art/docs/development/api/)
- [Documentation — TLS & ACME](https://stalw.art/docs/server/tls/acme/configuration/)
- [Documentation — Domaine & DKIM](https://stalw.art/docs/ref/object/domain/)
- [Documentation — Prérequis système](https://stalw.art/docs/install/requirements/)

### Stack technique
- [TanStack Start](https://tanstack.com/start/latest)
- [TanStack Router](https://tanstack.com/router/latest)
- [TanStack Query](https://tanstack.com/query/latest)
- [shadcn/ui](https://ui.shadcn.com/)
- [JMAP RFC 8620](https://datatracker.ietf.org/doc/html/rfc8620)
- [JMAP for Email RFC 8621](https://datatracker.ietf.org/doc/html/rfc8621)
