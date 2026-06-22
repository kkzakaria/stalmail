# Validation en conditions réelles du socle — Runbook & Checklist

> **Exécution : manuelle, par l'utilisateur, sur le serveur Hetzner.** Claude assiste
> et consigne ; pas d'agent d'implémentation. Cocher (`- [ ]`) au fur et à mesure.
>
> Spec : `docs/superpowers/specs/2026-06-22-validation-reelle-socle-design.md`.

**Objectif :** éprouver le socle complet (wizard → envoi/réception réels, sanitisation,
blocage d'images, délivrabilité) sur Hetzner + domaine `getstalmail.com` + Cloudflare DNS.

**Artefacts repo associés (déjà créés) :** `install.sh` (installeur one-command),
`compose.prod.yml` (images GHCR), `Caddyfile` (templété par `STALMAIL_HOSTNAME`),
`.env.example`.

**Principe :** déploiement en **une commande** (`install.sh`), puis **tout** le reste
(domaine, **DNS y compris l'A record**, SSL, DKIM) est publié par le **wizard in-app**.
Aucune copie de fichier ni enregistrement DNS manuel.

## Global Constraints (valeurs exactes)

- Hostname webmail : **`mail.getstalmail.com`** ; URL publique : **`https://mail.getstalmail.com`**.
- Domaine mail : **`getstalmail.com`** ; DNS provider wizard : **Cloudflare** (token API scope *DNS edit* sur la zone).
- Images : **`ghcr.io/kkzakaria/stalmail-app:latest`** + **`ghcr.io/kkzakaria/stalmail-stalwart:latest`** (repo public → pas de `docker login`).
- `.env` (généré par `install.sh`) : `STALMAIL_SECRET`, `STALMAIL_HOSTNAME=mail.getstalmail.com`, `STALMAIL_PUBLIC_URL=https://mail.getstalmail.com`.
- Boîte externe de contrôle : une adresse **que tu possèdes** (ex. Gmail) — notée `<gmail>` ci-dessous.
- Placeholders à substituer : `<ip-hetzner>` (IP publique du serveur), `<gmail>`.
- Secrets dans `.env` (chmod 600), **jamais commités**.

---

# PARTIE 1 — Runbook de déploiement

## Phase 0 — Pré-vol serveur et réseau

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

## Phase 1 — Déploiement (UNE commande)

Aucune copie de fichier, aucun DNS manuel.

- [ ] **1.1 — Installer en une commande** (sur le serveur) :
  ```bash
  curl -fsSL https://raw.githubusercontent.com/kkzakaria/stalmail/main/install.sh \
    | bash -s -- mail.getstalmail.com
  ```
  Le script : vérifie Docker, récupère `compose.prod.yml` + `Caddyfile` dans `~/stalmail`, génère `.env` (secret + hostname), tire les images GHCR, démarre la stack.
  Attendu : `✓ Services démarrés (stalwart, app, caddy)` puis l'encadré avec l'URL `https://<ip>/setup`.
- [ ] **1.2 — Stalwart en mode bootstrap :**
  ```bash
  cd ~/stalmail && docker compose -f compose.prod.yml logs stalwart | grep -i 'bootstrap mode'
  ```
  Attendu : une ligne « bootstrap mode ».

## Phase 2 — Wizard (accès par IP, DNS publié automatiquement)

Le DNS n'existe pas encore → on atteint le wizard via l'**IP** (certificat **auto-signé**,
servi par le fallback `:443` de Caddy). Le wizard publie ensuite **toute** la zone via
Cloudflare, **A record inclus**.

- [ ] **2.1 — Ouvrir** `https://<ip-hetzner>/setup` ; **accepter l'avertissement de certificat auto-signé** (normal, c'est ton serveur). Attendu : écran du wizard (mode bootstrap).
- [ ] **2.2 — Domaine :** saisir `getstalmail.com` (hostname serveur `mail.getstalmail.com`).
- [ ] **2.3 — DNS = Cloudflare :** sélectionner **Cloudflare**, coller le **token API** (scope *DNS edit* sur la zone). Le wizard publie **A (mail→IP) + MX + SPF + DKIM + DMARC**.
- [ ] **2.4 — SSL / DKIM :** laisser le wizard demander le certificat mail + générer les clés DKIM.
- [ ] **2.5 — Terminer :** le superviseur redémarre Stalwart (bootstrap→normal) ; écran *done*.
- [ ] **2.6 — Compte admin :** noter `admin@getstalmail.com` + mot de passe.

## Phase 3 — Bascule sur le domaine et vérifications

- [ ] **3.1 — DNS publié & propagé (1–5 min) :**
  ```bash
  dig +short A   mail.getstalmail.com      # → <ip-hetzner> (publié par le wizard)
  dig +short MX  getstalmail.com
  dig +short TXT getstalmail.com           # SPF (v=spf1 …)
  dig +short TXT default._domainkey.getstalmail.com   # DKIM
  dig +short TXT _dmarc.getstalmail.com    # DMARC
  ```
  Attendu : A → IP du serveur ; MX → serveur ; SPF, DKIM, DMARC présents. **Vérifier que l'A record est bien automatique (publié par le wizard, pas créé à la main).**
- [ ] **3.2 — Certificat ACME du domaine :** une fois l'A record propagé, Caddy émet le certificat pour `mail.getstalmail.com` (au besoin forcer une nouvelle tentative : `docker compose -f compose.prod.yml restart caddy`).
  ```bash
  curl -sI https://mail.getstalmail.com/ | head -1
  ```
  Attendu : `HTTP/2 200` ou `307`, **sans** erreur TLS (cert valide, plus auto-signé).
- [ ] **3.3 — Mode normal :**
  ```bash
  cd ~/stalmail && docker compose -f compose.prod.yml logs stalwart | grep -i 'WITHOUT recovery admin'
  ```
  Attendu : passage en mode normal (recovery admin retiré).
- [ ] **3.4 — Login admin** sur `https://mail.getstalmail.com` avec `admin@getstalmail.com`. Attendu : accès à la boîte.
- [ ] **3.5 — Compte de test :** créer `user@getstalmail.com` (mot de passe connu) via l'admin Stalwart / l'UI de gestion. *(Si la création de compte n'est pas exposée à ce stade, utiliser `admin@getstalmail.com` comme compte de test et `<gmail>` comme contrepartie externe.)*

---

# PARTIE 2 — Checklist d'acceptation

> Pour chaque cas : exécuter les **Étapes**, comparer au **Attendu**, cocher et reporter
> dans le tableau de résultats (Partie 3). En cas d'écart : noter *observé* + ouvrir une issue.

## A. Wizard & setup
- [ ] **A1** Bootstrap → wizard accessible via l'IP (Phase 2.1). *Attendu : écran wizard.*
- [ ] **A2** DNS publié automatiquement par Cloudflare, **A record inclus** (Phase 3.1). *Attendu : A/MX/SPF/DKIM/DMARC présents, aucun créé à la main.*
- [ ] **A3** SSL ACME émis pour le domaine, HTTPS valide (Phase 3.2). *Attendu : certif valide, plus d'avertissement.*
- [ ] **A4** Restart bootstrap→normal (Phase 3.3). *Attendu : mode normal, recovery admin retiré.*
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
