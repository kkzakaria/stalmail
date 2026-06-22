# Validation en conditions réelles du socle — Design

> Statut : validé en brainstorming (2026-06-22).
> Remplace l'automatisation E2E (`2026-06-22-e2e-composer-design.md`, reportée).
> Objectif : éprouver le socle complet (wizard → envoi/réception réels) sur une vraie
> infrastructure avant de bâtir la suite (4d).

## 1. Objectif & nature du livrable

Valider, **en conditions réelles**, l'ensemble des fonctionnalités livrées jusqu'ici
(wizard, auth, liste, lecteur, actions, composer) sur :

- un **serveur Hetzner** réel,
- un **vrai domaine** (recommandé : un `.com` via **Cloudflare Registrar**, ~10 $/an,
  bonne réputation email ; DNS sur Cloudflare → token API exploité par le wizard),
- de **vrais emails** internes et externes (boîte externe de contrôle : ex. Gmail).

**Livrable** = un **document** (ce dépôt) : un **runbook de déploiement** + une
**checklist d'acceptation** (cas de test avec étapes, résultat attendu, pass/fail).
**L'utilisateur exécute** sur le serveur ; Claude **assiste/dépanne** à la demande et
**consigne les résultats**. Pas d'accès direct au serveur par Claude, pas
d'automatisation (test manuel/réel assumé).

## 2. Prérequis (côté utilisateur) — pièges délivrabilité

| Prérequis | Détail / piège |
|---|---|
| Serveur Hetzner + SSH | Docker + Compose installés (sinon étape d'install dans le runbook) |
| **Port 25 sortant** | **Bloqué par défaut chez Hetzner** → ouvrir un ticket pour le débloquer, sinon aucun envoi externe |
| Ports entrants | 80, 443, 465, 587, 993 ouverts (firewall + Hetzner Cloud Firewall) |
| **rDNS / PTR** | IP du serveur → `mail.<domaine>` (console Hetzner) ; indispensable pour ne pas tomber en spam |
| Domaine | `.com` via Cloudflare Registrar ; zone DNS sur Cloudflare |
| **Token API Cloudflare** | Scope DNS edit sur la zone ; fourni au wizard (mode provider automatisé) |
| Boîte externe de contrôle | Gmail (ou équivalent) que l'utilisateur possède |

## 3. Runbook de déploiement

1. **Préparer le serveur** : installer Docker + Compose ; ouvrir les ports ; configurer
   le **PTR** ; vérifier que le port 25 sortant est débloqué (`nc -zv <mx-externe> 25`).
2. **Déposer la configuration** : `compose.yml` + `Caddyfile` + un `.env`
   (`STALMAIL_PUBLIC_URL=https://mail.<domaine>`, `STALMAIL_SECRET`,
   `STALWART_RECOVERY_ADMIN`). **Tirer les images GHCR**
   (`ghcr.io/kkzakaria/stalmail-app:latest` et `…-stalwart:latest`) — pas de build sur
   le serveur. (Le `compose.yml` actuel `build:`+`image: stalmail-*:latest` ; le runbook
   précisera l'override d'images GHCR, ou un `compose.prod.yml` dédié — tranché au plan.)
3. **Démarrer** : `docker compose up -d` → Stalwart en **mode bootstrap**.
4. **Wizard** : ouvrir `https://mail.<domaine>/setup` →
   - saisir le domaine,
   - **DNS = Cloudflare** + token API → le wizard **publie** A/MX/SPF/DKIM/DMARC,
   - **SSL/ACME** (certificat émis),
   - **DKIM** généré,
   - **restart** bootstrap→normal via le superviseur,
   - **done**.
5. **Vérifications post-déploiement** : `dig MX/TXT` (SPF, DKIM `default._domainkey`,
   DMARC) propagés ; certificat TLS valide ; **login admin** sur `https://mail.<domaine>`.

## 4. Checklist d'acceptation (par fonctionnalité)

### A. Wizard & setup
Bootstrap atteint ; domaine accepté ; **DNS publié automatiquement** (Cloudflare) ;
**SSL** émis ; **DKIM** généré ; restart bootstrap→normal ; écran *done* ; setup
re-protégé (`/setup` redirige une fois configuré).

### B. Auth & session
Login (admin + compte de test) ; session persistante après refresh ; expiration →
redirection `/login` ; logout.

### C. Liste
Dossiers (Inbox/Sent/Drafts/Trash/Spam/Archive) ; liste virtualisée fluide ;
compteurs de non-lus cohérents.

### D. Lecteur & actions
Ouverture d'un fil ; rendu HTML en **iframe sandbox** ; **blocage des images
distantes** + bouton « Afficher les images » ; pièces jointes listées ; actions
favori / lu-non-lu / archiver / corbeille / spam (et retrait du spam).

### E. Composer — envoi / réception (cœur)
1. **Interne → externe** (vers Gmail) : arrive en **inbox (pas spam)** ; en-têtes Gmail
   montrent **SPF=pass, DKIM=pass, DMARC=pass**.
2. **Externe → interne** (depuis Gmail) : reçu ; rendu HTML **sandboxé** ; **images
   distantes bloquées** ; « Afficher les images » fonctionne.
3. **Répondre** : la réponse chaîne le fil (**In-Reply-To/References** ; vérifiable
   côté Gmail « afficher l'original » et dans le fil Stalmail).
4. **Répondre à tous** : `cc` correct, **expéditeur non ré-inclus**.
5. **Transférer** : objet `Fwd:`, **corps cité** présent, destinataire externe reçoit.
6. **Sanitisation HTML** : recevoir un message au **HTML hostile** (`<script>`,
   `<img onerror>`, `javascript:`) → neutralisé au rendu ; en rédaction, le corps
   envoyé est nettoyé.
7. **Adresse invalide** : toast d'erreur, aucun envoi.
8. **Rate-limit** : best-effort (note : seuil 30/h ; couvert finement en unitaire).

### F. Délivrabilité
Score **mail-tester.com** (viser ≥ 9/10) ; **rDNS** correct ; en-têtes
d'authentification ; absence de blacklist sur l'IP.

## 5. Recueil des résultats

Un tableau **pass / fail / notes** par cas (section dédiée du document, ou fichier
`results` daté). Chaque **fail** ou anomalie est décrit (étapes, attendu, observé) et
**transformé en issue/correctif** — c'est le but : révéler les fragilités du socle
avant la 4d.

## 6. Sécurité / précautions

- Secrets dans `.env` **non commité** ; `STALWART_RECOVERY_ADMIN` non exposé après
  setup (hardening déjà géré par le superviseur) ; token Cloudflare à scope minimal.
- Emails externes **uniquement vers des boîtes que l'utilisateur possède** (pas
  d'envoi non sollicité).
- Domaine/serveur de test ; aucune donnée réelle d'utilisateur.

## 7. Hors scope

- **Automatisation** (volontairement manuel/réel ; l'E2E automatisé est reporté).
- **Calendrier / contacts** (non implémentés).
- **Montée en charge / performance**.
- Multi-domaines, multi-tenant.

## 8. Références

- Wizard : `docs/superpowers/specs/2026-06-09-setup-wizard-design.md`,
  `2026-06-10-wizard-2b-ii-a-account-dns.md`, `2026-06-10-wizard-2b-ii-b-ssl-done.md`
- Composer 4c : `docs/superpowers/specs/2026-06-21-plan-4c-composer-design.md`
- Lecteur/actions 4b, liste 4a, auth 3a : specs correspondantes sous `docs/superpowers/specs/`
- Déploiement : `compose.yml`, `Caddyfile`, `docker/app/Dockerfile`, `docker/stalwart/Dockerfile`,
  CD GHCR (`.github/workflows/cd.yml`)
- Providers DNS : `src/server/stalwart-dns.ts` (`DNS_PROVIDERS`, dont `Cloudflare`)
- E2E automatisé reporté : `docs/superpowers/specs/2026-06-22-e2e-composer-design.md`
