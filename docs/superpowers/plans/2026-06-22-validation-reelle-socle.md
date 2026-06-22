# Validation en conditions réelles du socle — Runbook & Checklist

> **Exécution : manuelle, par l'utilisateur, sur le serveur Hetzner.** Claude assiste
> et consigne ; pas d'agent d'implémentation. Cocher (`- [ ]`) au fur et à mesure.
>
> Spec : `docs/superpowers/specs/2026-06-22-validation-reelle-socle-design.md`.

**Objectif :** éprouver le socle complet (wizard → envoi/réception réels, sanitisation,
blocage d'images, délivrabilité) sur Hetzner + domaine `getstalmail.com` + Cloudflare DNS.

**Artefacts repo associés (déjà créés) :** `compose.prod.yml`, `.env.example`,
`Caddyfile.prod.example`.

## Global Constraints (valeurs exactes)

- Hostname webmail : **`mail.getstalmail.com`** ; URL publique : **`https://mail.getstalmail.com`**.
- Domaine mail : **`getstalmail.com`** ; DNS provider wizard : **Cloudflare** (token API scope *DNS edit* sur la zone).
- Images : **`ghcr.io/kkzakaria/stalmail-app:latest`** + **`ghcr.io/kkzakaria/stalmail-stalwart:latest`** (repo public → pas de `docker login`).
- Boîte externe de contrôle : une adresse **que tu possèdes** (ex. Gmail) — notée `<gmail>` ci-dessous.
- Placeholders à substituer : `<ip-hetzner>` (IP publique du serveur), `<gmail>`.
- Secrets dans `.env` (chmod 600), **jamais commités**.

---

# PARTIE 1 — Runbook de déploiement

### Phase 0 — Pré-vol serveur & réseau

- [ ] **0.1 — Accès & Docker.** SSH sur le serveur ; vérifier Docker + Compose v2 :
  ```bash
  docker --version && docker compose version
  ```
  Attendu : deux versions affichées. Sinon installer : https://docs.docker.com/engine/install/
- [ ] **0.2 — Ports entrants ouverts** (firewall OS + Hetzner Cloud Firewall) : `80, 443, 25, 587, 465, 993, 143`.
  ```bash
  sudo ss -tlnp | grep -E ':(80|443|25|587|465|993|143)\b' || echo "(rien encore — normal avant up)"
  ```
- [ ] **0.3 — Port 25 SORTANT débloqué** (ticket Hetzner « Sending mails not possible »).
  Vérifier vers un MX externe :
  ```bash
  nc -zv gmail-smtp-in.l.google.com 25
  ```
  Attendu : `succeeded` / `open`. Si `timed out` → port 25 encore bloqué, **ne pas continuer les tests d'envoi externe**.
- [ ] **0.4 — rDNS / PTR.** Dans la console Hetzner, régler le reverse DNS de `<ip-hetzner>` sur `mail.getstalmail.com`. Vérifier :
  ```bash
  dig +short -x <ip-hetzner>
  ```
  Attendu : `mail.getstalmail.com.`

### Phase 1 — DNS initial (A record web)

Caddy a besoin que `mail.getstalmail.com` résolve **avant** de pouvoir émettre le certificat ACME (le wizard publiera ensuite MX/SPF/DKIM/DMARC).

- [ ] **1.1 — Enregistrement A** dans Cloudflare : `mail.getstalmail.com` → `<ip-hetzner>`, **proxy désactivé (DNS only, nuage gris)** — l'ACME et les ports mail exigent un accès direct, pas le proxy Cloudflare.
- [ ] **1.2 — Vérifier la résolution :**
  ```bash
  dig +short mail.getstalmail.com
  ```
  Attendu : `<ip-hetzner>`.

### Phase 2 — Déposer la configuration sur le serveur

Dans un dossier dédié (ex. `~/stalmail`) sur le serveur, déposer **3 fichiers** :

- [ ] **2.1 — `compose.prod.yml`** (copie depuis le repo, identique).
- [ ] **2.2 — `Caddyfile`** = contenu de `Caddyfile.prod.example` (hostname déjà = `mail.getstalmail.com`).
- [ ] **2.3 — `.env`** (chmod 600) :
  ```bash
  printf 'STALMAIL_SECRET=%s\n' "$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 64)" > .env
  printf 'STALMAIL_PUBLIC_URL=%s\n' 'https://mail.getstalmail.com' >> .env
  chmod 600 .env
  cat .env   # vérifier les deux lignes
  ```

### Phase 3 — Démarrage

- [ ] **3.1 — Tirer les images & démarrer :**
  ```bash
  docker compose -f compose.prod.yml pull
  docker compose -f compose.prod.yml up -d
  docker compose -f compose.prod.yml ps
  ```
  Attendu : `stalwart`, `app`, `caddy` en `running`.
- [ ] **3.2 — Stalwart en mode bootstrap :**
  ```bash
  docker compose -f compose.prod.yml logs stalwart | grep -i 'bootstrap mode'
  ```
  Attendu : une ligne « bootstrap mode ».
- [ ] **3.3 — Certificat TLS Caddy émis** (peut prendre ~30 s) :
  ```bash
  docker compose -f compose.prod.yml logs caddy | grep -iE 'certificate obtained|serving initial configuration'
  curl -sI https://mail.getstalmail.com/ | head -1
  ```
  Attendu : certif obtenu ; `HTTP/2 200` ou `307` (redirection vers /login ou /setup). Pas d'erreur TLS.

### Phase 4 — Wizard de setup

- [ ] **4.1 — Ouvrir** `https://mail.getstalmail.com/setup` dans le navigateur. Attendu : écran du wizard (mode bootstrap).
- [ ] **4.2 — Domaine :** saisir `getstalmail.com`.
- [ ] **4.3 — DNS = Cloudflare :** sélectionner le provider **Cloudflare**, coller le **token API** (scope *DNS edit* sur la zone). Le wizard publie A/MX/SPF/DKIM/DMARC.
- [ ] **4.4 — SSL / ACME :** laisser le wizard demander le certificat (mail).
- [ ] **4.5 — DKIM :** clés générées par le wizard.
- [ ] **4.6 — Terminer :** le superviseur redémarre Stalwart (bootstrap→normal) ; écran *done*.
- [ ] **4.7 — Compte admin :** noter l'adresse `admin@getstalmail.com` et son mot de passe (généré/saisi au wizard).

### Phase 5 — Vérifications post-déploiement

- [ ] **5.1 — Mode normal :**
  ```bash
  docker compose -f compose.prod.yml logs stalwart | grep -i 'WITHOUT recovery admin'
  ```
  Attendu : ligne indiquant le passage en mode normal (recovery admin retiré).
- [ ] **5.2 — DNS publié (propagation 1–5 min) :**
  ```bash
  dig +short MX getstalmail.com
  dig +short TXT getstalmail.com            # SPF (v=spf1 …)
  dig +short TXT default._domainkey.getstalmail.com   # DKIM
  dig +short TXT _dmarc.getstalmail.com     # DMARC
  ```
  Attendu : MX → le serveur ; SPF, DKIM, DMARC présents.
- [ ] **5.3 — Login admin** sur `https://mail.getstalmail.com` avec `admin@getstalmail.com`. Attendu : accès à la boîte (Inbox vide).
- [ ] **5.4 — Compte de test :** créer un second mailbox `user@getstalmail.com` (mot de passe connu) via l'admin Stalwart / le wizard de gestion. *(Si la création de compte utilisateur n'est pas exposée dans l'UI à ce stade, utiliser `admin@getstalmail.com` comme compte de test et `<gmail>` comme contrepartie externe.)*

---

# PARTIE 2 — Checklist d'acceptation

> Pour chaque cas : exécuter les **Étapes**, comparer au **Attendu**, cocher et reporter
> dans le tableau de résultats (Partie 3). En cas d'écart : noter *observé* + ouvrir une issue.

## A. Wizard & setup
- [ ] **A1** Bootstrap → wizard accessible (Phase 4.1). *Attendu : écran wizard.*
- [ ] **A2** DNS publié automatiquement par Cloudflare (5.2). *Attendu : MX/SPF/DKIM/DMARC présents.*
- [ ] **A3** SSL émis, HTTPS valide (3.3). *Attendu : certif valide, pas d'avertissement navigateur.*
- [ ] **A4** Restart bootstrap→normal (5.1). *Attendu : mode normal, recovery admin retiré.*
- [ ] **A5** `/setup` re-protégé après configuration. *Étape : ouvrir `/setup` reconnecté.* *Attendu : redirection (plus le wizard).*

## B. Auth & session
- [ ] **B1** Login admin + compte test. *Attendu : accès boîte.*
- [ ] **B2** Persistance : rafraîchir la page connecté. *Attendu : reste connecté.*
- [ ] **B3** Expiration/déconnexion : se déconnecter (ou cookie supprimé) puis ouvrir `/mail/inbox`. *Attendu : redirection `/login`.*

## C. Liste
- [ ] **C1** Dossiers présents (Inbox/Sent/Drafts/Trash/Spam/Archive). *Attendu : sidebar complète.*
- [ ] **C2** Compteurs de non-lus cohérents après réception. *Attendu : pastille mise à jour.*

## D. Lecteur & actions
- [ ] **D1** Ouvrir un fil → rendu dans l'**iframe sandbox**. *Attendu : contenu rendu, isolé.*
- [ ] **D2** Email avec **image distante** → image **bloquée** + bandeau « Afficher les images » ; cliquer affiche l'image. *Attendu : blocage par défaut, affichage sur action.*
- [ ] **D3** Email avec pièce jointe → pièce jointe **listée**. *Attendu : nom/type/taille affichés.*
- [ ] **D4** Actions : favori ★, lu/non-lu, archiver, corbeille, spam, retirer du spam. *Attendu : chaque action déplace/marque correctement + toast.*

## E. Composer — envoi / réception
- [ ] **E1** **Interne → externe** : depuis `user@getstalmail.com`, nouveau message → `<gmail>` → Envoyer. *Attendu : message dans **Sent** ; arrive dans la **boîte de réception Gmail (pas spam)**.*
- [ ] **E2** **Authentification Gmail** : dans Gmail, « Afficher l'original ». *Attendu : **SPF=PASS, DKIM=PASS, DMARC=PASS**.*
- [ ] **E3** **Externe → interne** : depuis `<gmail>`, envoyer un mail (avec une image distante + un lien) → `user@getstalmail.com`. *Attendu : reçu dans Inbox ; rendu sandbox ; **image bloquée** par défaut.*
- [ ] **E4** **Répondre** : ouvrir le mail reçu en E3 → Répondre → Envoyer. *Attendu : Gmail montre la réponse **dans le même fil** ; en-tête `In-Reply-To`/`References` présent (Gmail « Afficher l'original »).*
- [ ] **E5** **Répondre à tous** : recevoir un mail adressé à `user@` avec `<gmail>` en copie → Répondre à tous. *Attendu : `<gmail>` en destinataire, `user@` (soi) **non** ré-ajouté.*
- [ ] **E6** **Transférer** : transférer un mail reçu vers `<gmail>`. *Attendu : objet `Fwd: …`, **corps cité** présent, reçu côté Gmail.*
- [ ] **E7** **Sanitisation HTML** : depuis Gmail, envoyer à `user@` un HTML hostile :
  ```html
  <p>ok</p><img src="https://exemple.invalid/x.png" onerror="alert('xss')">
  <script>alert('xss')</script><a href="javascript:alert(1)">lien</a>
  ```
  *Attendu : aucune exécution JS ; `<script>`/`onerror`/`javascript:` neutralisés ; image distante bloquée. (Vérifier aussi à l'envoi depuis Stalmail : le corps reçu est nettoyé.)*
- [ ] **E8** **Adresse invalide** : nouveau message → À = `pas-une-adresse` → Envoyer. *Attendu : toast d'erreur, **aucun** envoi.*
- [ ] **E9** **Rate-limit** (best-effort) : envoyer rapidement plusieurs messages. *Attendu : sous le seuil OK ; au-delà (30/h) toast d'erreur générique. (Couverture fine = test unitaire ; ici best-effort.)*

## F. Délivrabilité
- [ ] **F1** **mail-tester.com** : envoyer un message depuis `user@` à l'adresse fournie par mail-tester → relever le score. *Attendu : **≥ 9/10**.*
- [ ] **F2** **rDNS** confirmé (0.4). *Attendu : PTR = `mail.getstalmail.com`.*
- [ ] **F3** **Pas de blacklist** : vérifier l'IP sur un outil type MXToolbox blacklist. *Attendu : aucune liste noire majeure.*

---

# PARTIE 3 — Tableau de résultats

| Cas | Pass/Fail | Notes / observé / issue |
|---|---|---|
| A1 Wizard accessible | | |
| A2 DNS auto Cloudflare | | |
| A3 SSL/HTTPS | | |
| A4 Restart normal | | |
| A5 /setup re-protégé | | |
| B1 Login | | |
| B2 Persistance session | | |
| B3 Expiration→/login | | |
| C1 Dossiers | | |
| C2 Compteurs non-lus | | |
| D1 iframe sandbox | | |
| D2 Blocage images | | |
| D3 Pièce jointe listée | | |
| D4 Actions (★/lu/archive/trash/spam) | | |
| E1 Interne→externe (inbox, pas spam) | | |
| E2 SPF/DKIM/DMARC pass | | |
| E3 Externe→interne (sandbox, image bloquée) | | |
| E4 Répondre (threading) | | |
| E5 Répondre à tous (auto-exclusion) | | |
| E6 Transférer (Fwd: + citation) | | |
| E7 Sanitisation HTML | | |
| E8 Adresse invalide (toast, pas d'envoi) | | |
| E9 Rate-limit (best-effort) | | |
| F1 mail-tester ≥ 9/10 | | |
| F2 rDNS | | |
| F3 Blacklist | | |

**Synthèse :** _(à remplir)_ — nb pass / fail, anomalies bloquantes, décisions (corriger avant 4d ?).

---

## Self-Review (couverture spec)

- Spec §3 runbook → Parties 1 (Phases 0–5). ✅
- Spec §4 checklist A–F → Partie 2 (A1–A5, B1–B3, C1–C2, D1–D4, E1–E9, F1–F3). ✅
- Spec §2 prérequis (port 25, rDNS, ports, token Cloudflare, boîte externe) → Phase 0 + Global Constraints. ✅
- Spec §6 sécurité (.env non commité, recovery admin retiré, emails vers boîtes possédées) → Global Constraints + 5.1 + E (vers `<gmail>` perso). ✅
- Spec §5 recueil résultats → Partie 3 (tableau pass/fail). ✅
- **Limite connue** : 5.4 — la création d'un 2ᵉ compte interne (`user@`) dépend de ce qui est exposé par l'UI/Stalwart à ce stade ; fallback documenté (admin@ + Gmail comme contrepartie). À lever si l'UI de gestion des comptes n'existe pas encore (alors interne→interne se fait admin↔user créé via Stalwart, ou se limite à interne↔externe).
- **Code** : aucune modification applicative requise (le rate-limit reste best-effort en E2E réel ; l'override d'env `STALMAIL_SEND_RATE_MAX` est resté dans le spec E2E automatisé reporté, hors de ce périmètre).
