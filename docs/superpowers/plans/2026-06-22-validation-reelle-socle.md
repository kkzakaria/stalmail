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

**Principe :** déploiement en **une commande** (`install.sh`), puis le **wizard in-app**
publie automatiquement la **zone mail** (MX, SPF, DKIM, DMARC, SRV, CNAME autoconfig…)
via le provider DNS. **Exception : les enregistrements A/AAAA sont créés MANUELLEMENT.**
Stalwart ne publie jamais d'adresse (son enum `DnsRecordType` n'a pas de `a`/`aaaa` — il
ignore l'IP publique de l'hôte). Voir issue **#61** (auto A/AAAA + guidage, à concevoir).
Aucune autre copie de fichier ni enregistrement DNS manuel.

## Global Constraints (valeurs exactes)

- Hostname webmail (= `STALMAIL_HOSTNAME`) : **`getstalmail.com`** ; URL publique : **`https://getstalmail.com`**. *(Validation réelle : le webmail a été déployé sur l'apex `getstalmail.com`, pas sur `mail.`.)*
- Domaine mail : **`getstalmail.com`** ; DNS provider wizard : **Cloudflare** (token API scope *DNS edit* sur la zone).
- **Host mail** (cible des MX/SRV/CNAME de la zone Stalwart) : **`mail.getstalmail.com`** — distinct du hostname webmail. Nécessite son propre A record (manuel).
- **Enregistrements A à créer MANUELLEMENT dans Cloudflare** (DNS only / nuage gris) : `getstalmail.com` → `<ip-hetzner>` **et** `mail.getstalmail.com` → `<ip-hetzner>`. Cf. #61.
- Images : **`ghcr.io/kkzakaria/stalmail-app:latest`** + **`ghcr.io/kkzakaria/stalmail-stalwart:latest`** (repo public → pas de `docker login`).
- `.env` (généré par `install.sh`) : `STALMAIL_SECRET`, `STALMAIL_HOSTNAME=getstalmail.com`, `STALMAIL_PUBLIC_URL=https://getstalmail.com`, `STALMAIL_SETUP_TOKEN_HASH` (SHA-256 du jeton de setup — le clair n'est imprimé qu'une fois dans l'URL finale).
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
    | bash -s -- getstalmail.com
  ```
  Le script : vérifie Docker, récupère `compose.prod.yml` + `Caddyfile` dans `~/stalmail`, génère `.env` (secret + hostname), tire les images GHCR, démarre la stack.
  Attendu : `✓ Services démarrés (stalwart, app, caddy)` puis l'encadré avec l'URL `https://<ip>/setup#token=<jeton>` (lien à usage unique — conserver pour la Phase 2.1).
- [ ] **1.2 — Stalwart en mode bootstrap :**
  ```bash
  cd ~/stalmail && docker compose -f compose.prod.yml logs stalwart | grep -i 'bootstrap mode'
  ```
  Attendu : une ligne « bootstrap mode ».

## Phase 2 — Wizard (accès par IP, DNS publié automatiquement)

Le DNS n'existe pas encore → on atteint le wizard via l'**IP** (certificat **auto-signé**,
servi par le fallback `:443` de Caddy). Le wizard publie ensuite la **zone mail** via
Cloudflare (MX/SPF/DKIM/DMARC/SRV/CNAME). **Les A/AAAA restent à ta charge** (étape 2.3bis).

- [ ] **2.1 — Ouvrir le lien de setup imprimé par `install.sh`** (format `https://<ip-hetzner>/setup#token=<jeton>`) ; **accepter l'avertissement de certificat auto-signé** (normal, c'est ton serveur). Le fragment `#token=…` autorise le wizard — sans lui la page est verrouillée. Attendu : écran du wizard (mode bootstrap).
  > Si le lien est perdu (`.env` existant, relance) : générer un nouveau jeton et mettre à jour `STALMAIL_SETUP_TOKEN_HASH` dans `.env`, redémarrer `app`, ouvrir la nouvelle URL.
  > ```bash
  > TOKEN=$(openssl rand -hex 24)
  > HASH=$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')
  > # Éditer ~/stalmail/.env : remplacer STALMAIL_SETUP_TOKEN_HASH=$HASH
  > docker compose -f ~/stalmail/compose.prod.yml up -d app
  > echo "https://<ip-hetzner>/setup#token=$TOKEN"
  > ```
- [ ] **2.2 — Domaine :** saisir `getstalmail.com` (hostname serveur `getstalmail.com`).
- [ ] **2.3 — DNS = Cloudflare :** sélectionner **Cloudflare**, coller le **token API** (scope *DNS edit* sur la zone). Le wizard publie **MX + SPF + DKIM + DMARC + SRV + CNAME** (**pas** les A/AAAA — cf. #61).
  > ⚠️ Si le token est **invalide**, le wizard n'affiche **pas** d'erreur (la grille se fie à la résolution DNS, satisfiable par du cache) alors que la tâche Stalwart `DnsManagement` est `Failed` → publication en réalité échouée. Voir issue **#62**. Vérifie avec un **bon** token (scope *Zone:DNS:Edit*).
- [ ] **2.3bis — A records MANUELS** dans Cloudflare (**avant** ou pendant le step SSL), **DNS only (nuage gris)** :
  | Type | Nom | Contenu |
  |---|---|---|
  | A | `getstalmail.com` (`@`) | `<ip-hetzner>` |
  | A | `mail.getstalmail.com` | `<ip-hetzner>` |
  > Sans ces A, ni le webmail ni l'ACME ne fonctionnent (les MX/SRV/CNAME pointent dans le vide). Laisse **~1-2 min de propagation** avant de tester l'HTTPS.
- [ ] **2.4 — SSL / DKIM :** laisser le wizard demander le certificat mail (ACME **DNS-01**) + générer les clés DKIM. Le badge peut afficher « en attente » brièvement ; la délivrance se fait en arrière-plan (corrigé en v0.1.20 : statut `valid` quand le renouvellement est planifié).
- [ ] **2.5 — Terminer :** le superviseur redémarre Stalwart (bootstrap→normal) ; écran *done*.
- [ ] **2.6 — Compte admin :** noter `admin@getstalmail.com` + mot de passe.

## Phase 3 — Bascule sur le domaine et vérifications

- [ ] **3.1 — DNS publié & propagé (1–5 min) :**
  ```bash
  dig +short A   getstalmail.com           # → <ip-hetzner> (A MANUEL apex)
  dig +short A   mail.getstalmail.com       # → <ip-hetzner> (A MANUEL host mail)
  dig +short MX  getstalmail.com            # → mail.getstalmail.com (auto wizard)
  dig +short TXT getstalmail.com            # SPF (v=spf1 …) (auto)
  dig +short TXT _dmarc.getstalmail.com     # DMARC (auto)
  # DKIM : sélecteurs réels de la forme v1-ed25519-AAAAMMJJ / v1-rsa-AAAAMMJJ
  ```
  Attendu : les **2 A** (apex + mail) → IP du serveur (**créés à la main** — Stalwart ne les publie pas, #61) ; MX/SPF/DKIM/DMARC/SRV/CNAME présents (publiés par le wizard).
- [ ] **3.2 — Certificat ACME (webmail) :** une fois l'A apex propagé, Caddy émet le certificat Let's Encrypt pour `getstalmail.com` (challenge **HTTP-01** sur :80). Tant que l'A n'est pas propagé, Caddy échoue avec `no valid A records found` → le navigateur voit `SSL_ERROR_INTERNAL_ERROR_ALERT` (transitoire ; Caddy retente seul avec backoff).
  ```bash
  echo | openssl s_client -connect 127.0.0.1:443 -servername getstalmail.com 2>/dev/null | openssl x509 -noout -issuer -subject -dates
  curl -sI https://getstalmail.com/ | head -1
  ```
  Attendu : cert `issuer=…Let's Encrypt…`, `subject=CN=getstalmail.com` ; `HTTP/2 200`/`307` **sans** erreur TLS. *(Le cert **mail** de Stalwart, lui, se vérifie sur le port 993 : `openssl s_client -connect 127.0.0.1:993 -servername getstalmail.com`.)*
- [ ] **3.3 — Mode normal :**
  ```bash
  cd ~/stalmail && docker compose -f compose.prod.yml logs stalwart | grep -i 'WITHOUT recovery admin'
  ```
  Attendu : passage en mode normal (recovery admin retiré).
- [ ] **3.4 — Login admin** sur `https://getstalmail.com` avec `admin@getstalmail.com`. Attendu : accès à la boîte.
- [ ] **3.5 — Compte de test :** créer `user@getstalmail.com` (mot de passe connu) via l'admin Stalwart / l'UI de gestion. *(Si la création de compte n'est pas exposée à ce stade, utiliser `admin@getstalmail.com` comme compte de test et `<gmail>` comme contrepartie externe.)*

---

# PARTIE 2 — Checklist d'acceptation

> Pour chaque cas : exécuter les **Étapes**, comparer au **Attendu**, cocher et reporter
> dans le tableau de résultats (Partie 3). En cas d'écart : noter *observé* + ouvrir une issue.

## A. Wizard & setup
- [ ] **A1** Bootstrap → wizard accessible via l'IP (Phase 2.1). *Attendu : écran wizard.*
- [ ] **A2** Zone mail publiée automatiquement par Cloudflare (MX/SPF/DKIM/DMARC/SRV/CNAME) ; **A/AAAA créés manuellement** (Phase 2.3bis / 3.1). *Attendu : zone mail auto présente ; les 2 A (apex + mail) présents, créés à la main (#61).*
- [ ] **A3** SSL ACME émis pour `getstalmail.com`, HTTPS valide (Phase 3.2). *Attendu : cert Let's Encrypt valide, plus d'avertissement.*
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
| A1 Wizard accessible | ✅ Pass | Accès par IP `https://<ip>/setup#token=…`, cert bootstrap auto-signé. |
| A2 DNS auto Cloudflare | ✅ Pass | Zone mail auto OK (CNAME inclus après fix v0.1.20). **A/AAAA manuels** (Stalwart ne les publie pas → #61). Token invalide non détecté → #62. |
| A3 SSL/HTTPS | ✅ Pass | Cert Let's Encrypt `CN=getstalmail.com` (Caddy, HTTP-01). `SSL_ERROR_INTERNAL_ERROR_ALERT` **transitoire** tant que l'A apex n'est pas propagé. Cert mail Stalwart OK (:993, DNS-01). Statut SSL `valid` corrigé en v0.1.20. |
| A4 Restart normal | ✅ Pass | Wizard terminé, superviseur bootstrap→normal OK ; webmail affiché. |
| A5 /setup re-protégé | ⏳ À vérifier | Non testé explicitement. |
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

**Synthèse (au 2026-06-24) :** socle validé **de bout en bout jusqu'à l'accès webmail** —
install one-command → bootstrap auth → wizard (DNS mail auto + A manuels) → certs
Let's Encrypt (Stalwart mail :993 + Caddy webmail :443) → **webmail accessible en HTTPS valide**.
Acceptation A1–A4 ✅ ; A5 + B→F (auth, lecteur, composer, délivrabilité) **restent à dérouler**.

### Bugs trouvés en validation & correctifs

| Découverte | Résolution |
|---|---|
| `install.sh` pipefail / Caddyfile bootstrap / assets / secret DnsServer | corrigés (pré-0.1.18) |
| Auth bootstrap (jeton dédié) | **v0.1.18** |
| `publishRecords` doit être un objet, pas un tableau (gestion DNS auto rejetée) | **v0.1.19** |
| Vérif CNAME absente + comparaison sensible à la casse (grille DNS) | **v0.1.20** |
| Statut SSL bloqué « en attente » alors que le cert est émis (`AcmeRenewal` planifié) | **v0.1.20** |
| **A/AAAA non auto-créés** (Stalwart n'a pas de `a`/`aaaa`) + pas de guidage | issue **#61** (à concevoir) |
| **Token DNS invalide non détecté** (`DnsManagement: Failed` non surfacé) | issue **#62** |
| Erreurs pré-`try` masquées en `SETUP-UNKNOWN` opaque | issue **#63** |

### Hygiène pour les itérations de test

- **Éviter les `down -v` répétés** : ça efface le volume `stalmail-caddy-data` → Caddy (et Stalwart) redemandent les certs ACME à zéro à chaque run → risque d'**épuiser les quotas Let's Encrypt** (production). Préserver le volume, ou basculer sur **LE staging** pour les tests intensifs.
- Après création des **A records**, laisser **~1-2 min de propagation** avant de tester `https://getstalmail.com` (sinon `SSL_ERROR_INTERNAL_ERROR_ALERT` transitoire le temps que Caddy obtienne le cert).
- Les erreurs au wizard ne sont pas toujours loguées sur stdout de l'app → diagnostiquer via probes JMAP (tâches `DnsManagement`/`AcmeRenewal`, `Domain/get`) et `openssl s_client`.

---

## Self-Review (couverture spec)

- Spec §3 runbook → Parties 1 (Phases 0–5). ✅
- Spec §4 checklist A–F → Partie 2 (A1–A5, B1–B3, C1–C2, D1–D4, E1–E9, F1–F3). ✅
- Spec §2 prérequis (port 25, rDNS, ports, token Cloudflare, boîte externe) → Phase 0 + Global Constraints. ✅
- Spec §6 sécurité (.env non commité, recovery admin retiré, emails vers boîtes possédées) → Global Constraints + 5.1 + E (vers `<gmail>` perso). ✅
- Spec §5 recueil résultats → Partie 3 (tableau pass/fail). ✅
- **Limite connue** : 5.4 — la création d'un 2ᵉ compte interne (`user@`) dépend de ce qui est exposé par l'UI/Stalwart à ce stade ; fallback documenté (admin@ + Gmail comme contrepartie). À lever si l'UI de gestion des comptes n'existe pas encore (alors interne→interne se fait admin↔user créé via Stalwart, ou se limite à interne↔externe).
- **Code** : aucune modification applicative requise (le rate-limit reste best-effort en E2E réel ; l'override d'env `STALMAIL_SEND_RATE_MAX` est resté dans le spec E2E automatisé reporté, hors de ce périmètre).
