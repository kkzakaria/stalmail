#!/usr/bin/env bash
set -euo pipefail

# Stalmail — installeur serveur en UNE commande (images GHCR, sans build, sans copie).
#
#   curl -fsSL https://raw.githubusercontent.com/kkzakaria/stalmail/main/install.sh \
#     | bash -s -- mail.getstalmail.com getstalmail.com
#
# Ou en local :  ./install.sh mail.getstalmail.com getstalmail.com
#
# Deux paramètres, dans cet ordre : le hostname public du webmail, puis le domaine des
# adresses e-mail (partie après le @ — distinct du hostname, ex. ci-dessus). Omis →
# prompt sur le terminal (/dev/tty, jamais sur l'entrée standard : compatible avec
# l'usage en pipe ci-dessus). Le script :
#   - vérifie Docker + Compose v2,
#   - récupère compose.prod.yml + Caddyfile depuis le repo (images publiques GHCR),
#   - génère .env (STALMAIL_SECRET aléatoire + STALMAIL_HOSTNAME + STALMAIL_PUBLIC_URL
#     + STALMAIL_MAIL_DOMAIN + hash du jeton de setup),
#   - tire les images et démarre la stack.
# Le reste (DNS, SSL, DKIM) se configure dans le wizard in-app.

# Réf des fichiers récupérés (compose.prod.yml + Caddyfile). Défaut `main` : ce script
# sert d'abord à valider le socle courant. Pour une install reproductible, épingler un
# tag : STALMAIL_REF=v0.1.15 curl … | bash -s -- <hostname>.
REF="${STALMAIL_REF:-main}"
REPO_RAW="https://raw.githubusercontent.com/kkzakaria/stalmail/${REF}"
DIR="${STALMAIL_DIR:-$HOME/stalmail}"

echo "╔══════════════════════════════════╗"
echo "║        Stalmail Installer        ║"
echo "╚══════════════════════════════════╝"
echo ""

# Lit une saisie interactive depuis le terminal (/dev/tty), jamais depuis l'entrée
# standard : en usage pipé (curl ... | bash -s -- ...), stdin porte le SCRIPT lui-même,
# et un `read` non redirigé y avalerait la ligne de code suivante comme saisie
# utilisateur — corruption silencieuse de l'exécution. `[ -r /dev/tty ]` ne suffit PAS
# ici : le nœud existe et est lisible même sans terminal contrôlant (échec seulement à
# l'OUVERTURE, avec ENXIO, pas au niveau des permissions du fichier) ; on sonde donc la
# vraie ouverture dans un SOUS-SHELL jetable (aucun effet de bord sur les fds du script
# principal, message d'erreur bash absorbé par le `2>/dev/null` du sous-shell tout
# entier) pour détecter le cas CI/non interactif et échouer proprement plutôt que de
# laisser échapper l'erreur brute ou de bloquer.
# Usage : prompt_tty "texte du prompt" NOM_VARIABLE "message d'erreur si pas de terminal"
prompt_tty() {
  if ( exec 3< /dev/tty ) 2>/dev/null; then
    read -rp "$1" "$2" < /dev/tty
  else
    echo "$3"
    exit 1
  fi
}

# 1. Hostname (argument ou prompt terminal).
HOSTNAME_ARG="${1:-}"
if [ -z "${HOSTNAME_ARG}" ]; then
  prompt_tty "Hostname public du webmail (ex. mail.getstalmail.com) : " HOSTNAME_ARG \
    "❌ Hostname requis. Aucun terminal disponible pour le demander : passez-le en argument, ex. : ./install.sh mail.getstalmail.com getstalmail.com"
fi
if [ -z "${HOSTNAME_ARG}" ]; then
  echo "❌ Hostname requis."
  exit 1
fi
# FQDN valide attendu (≥ un point, caractères DNS) — évite qu'un hostname erroné se
# propage dans .env / Caddy (ACME) / le wizard.
if ! printf '%s' "${HOSTNAME_ARG}" | grep -qE '^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  echo "❌ Hostname invalide : « ${HOSTNAME_ARG} ». Attendu un FQDN, ex. mail.getstalmail.com"
  exit 1
fi

# Domaine des adresses e-mail (partie après le @). Distinct du hostname du webmail :
# avec STALMAIL_HOSTNAME=mail.exemple.fr, on attend ici exemple.fr. Requis par
# compose.prod.yml (hôte de politique MTA-STS).
MAIL_DOMAIN_ARG="${2:-}"
if [ -z "${MAIL_DOMAIN_ARG}" ]; then
  # Même précaution que pour HOSTNAME_ARG ci-dessus (voir prompt_tty). C'est ici que le
  # défaut historique se manifestait le plus souvent, puisque l'usage documenté en tête
  # de fichier ne fournit qu'un seul argument (le hostname) → ce prompt était
  # systématiquement atteint en pipe.
  prompt_tty "Domaine des adresses e-mail (ex. getstalmail.com) : " MAIL_DOMAIN_ARG \
    "❌ Domaine des adresses requis. Aucun terminal disponible pour le demander : passez-le en second argument, ex. : ./install.sh mail.getstalmail.com getstalmail.com"
fi
if [ -z "${MAIL_DOMAIN_ARG}" ]; then
  echo "❌ Domaine des adresses requis."
  exit 1
fi
if ! printf '%s' "${MAIL_DOMAIN_ARG}" | grep -qE '^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  echo "❌ Domaine invalide : « ${MAIL_DOMAIN_ARG} ». Attendu un domaine, ex. getstalmail.com"
  exit 1
fi
# Garde-fou (non bloquant) contre la confusion la plus probable : le domaine des
# adresses n'est PAS le hostname du webmail. C'est parfois voulu (webmail sur l'apex),
# mais bien plus souvent une saisie erronée (valeurs identiques ou arguments inversés).
if [ "${MAIL_DOMAIN_ARG}" = "${HOSTNAME_ARG}" ]; then
  echo "⚠ Domaine des adresses (${MAIL_DOMAIN_ARG}) identique au hostname du webmail."
  echo "   Attendu normalement deux valeurs distinctes, ex. hostname=mail.exemple.fr"
  echo "   et domaine=exemple.fr. Si c'est volontaire (webmail sur l'apex), ignorez ce message."
fi

# 2. Docker + Compose.
if ! command -v docker &> /dev/null; then
  echo "❌ Docker n'est pas installé. → https://docs.docker.com/get-docker/"
  exit 1
fi
if ! docker info &> /dev/null; then
  echo "❌ Docker daemon non accessible. Essayez : sudo systemctl start docker"
  exit 1
fi
if ! docker compose version &> /dev/null; then
  echo "❌ Le plugin 'docker compose' (v2) est requis. → https://docs.docker.com/compose/install/"
  exit 1
fi
echo "✓ Docker + Compose détectés"

# 3. Dossier de déploiement + récupération des fichiers (pas de build, pas de copie manuelle).
mkdir -p "${DIR}"
cd "${DIR}"
curl -fsSL "${REPO_RAW}/compose.prod.yml" -o compose.prod.yml
curl -fsSL "${REPO_RAW}/Caddyfile" -o Caddyfile
echo "✓ compose.prod.yml + Caddyfile récupérés dans ${DIR}"

# Helper SHA-256 portable (macOS/BSD n'ont pas sha256sum).
# Lit stdin → imprime l'empreinte hex 64 chars en minuscules.
# Pipefail-safe : openssl dgst lit un stdin FINI (printf '%s' ...) ; aucun pipe infini.
sha256hex() {
  if command -v openssl > /dev/null 2>&1; then
    openssl dgst -sha256 | awk '{print $NF}'
  elif command -v sha256sum > /dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

# Génère un jeton de setup (48 hex) dans la variable SETUP_TOKEN. Même précaution
# pipefail que pour SECRET : `openssl rand` en priorité ; fallback tranche FINIE lue par
# bash (pas de pipe sur un producteur infini → pas de SIGPIPE sous `set -o pipefail`).
gen_setup_token() {
  if command -v openssl &> /dev/null; then
    SETUP_TOKEN=$(openssl rand -hex 24)
  else
    # Tranche LARGE (4096 octets) pour garantir assez de caractères hex après filtrage
    # (~6 % de rendement ≫ 48 requis), puis coupe en bash (aucun pipe en aval).
    SETUP_TOKEN=$(LC_ALL=C tr -dc 'a-f0-9' < <(head -c 4096 /dev/urandom))
    SETUP_TOKEN=${SETUP_TOKEN:0:48}
  fi
}

# 4. .env (généré une fois, conservé ensuite).
# SETUP_TOKEN : en clair uniquement en shell (pour l'URL finale), jamais écrit dans .env.
# Seul le hash SHA-256 est persisté. Même précaution pipefail que pour SECRET :
# on utilise `openssl rand` en priorité ; fallback tranche finie lue par bash (pas de pipe
# sur un producteur infini).
SETUP_TOKEN=""
if [ ! -f .env ]; then
  # Secret 64 caractères alphanumériques. NE PAS écrire `tr </dev/urandom | head` :
  # sous `set -o pipefail`, `head` ferme le tuyau dès 64 octets lus → `tr` reçoit
  # SIGPIPE et sort en code ≠ 0 → le pipeline échoue → `set -e` tue le script.
  # On lit donc une tranche FINIE puis on coupe en bash (aucun pipe en aval),
  # avec `openssl` en chemin préféré quand il est disponible.
  if command -v openssl &> /dev/null; then
    SECRET=$(openssl rand -hex 32)
  else
    SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < <(head -c 256 /dev/urandom))
    SECRET=${SECRET:0:64}
  fi
  gen_setup_token
  # Hash SHA-256 du jeton — via le helper portable sha256hex (openssl / sha256sum / shasum).
  SETUP_TOKEN_HASH=$(printf '%s' "${SETUP_TOKEN}" | sha256hex)
  {
    printf 'STALMAIL_SECRET=%s\n' "${SECRET}"
    printf 'STALMAIL_HOSTNAME=%s\n' "${HOSTNAME_ARG}"
    printf 'STALMAIL_PUBLIC_URL=https://%s\n' "${HOSTNAME_ARG}"
    printf 'STALMAIL_SETUP_TOKEN_HASH=%s\n' "${SETUP_TOKEN_HASH}"
    printf 'STALMAIL_MAIL_DOMAIN=%s\n' "${MAIL_DOMAIN_ARG}"
  } > .env
  chmod 600 .env
  echo "✓ .env créé (secret généré, hostname=${HOSTNAME_ARG}, domaine=${MAIL_DOMAIN_ARG})"
else
  # .env existant : ne pas mentir sur le hostname affiché. Si l'argument diffère du
  # STALMAIL_HOSTNAME déjà enregistré, on s'arrête (l'opérateur tranche) ; sinon on réutilise.
  EXISTING_HOSTNAME=$(awk -F= '$1=="STALMAIL_HOSTNAME"{print $2}' .env | tail -n1)
  if [ -n "${EXISTING_HOSTNAME}" ] && [ "${EXISTING_HOSTNAME}" != "${HOSTNAME_ARG}" ]; then
    echo "❌ .env existant utilise STALMAIL_HOSTNAME=${EXISTING_HOSTNAME} (≠ ${HOSTNAME_ARG})."
    echo "   Éditez/supprimez ${DIR}/.env puis relancez, ou relancez avec le bon hostname."
    exit 1
  fi
  HOSTNAME_ARG="${EXISTING_HOSTNAME:-${HOSTNAME_ARG}}"
  echo "✓ .env existant conservé (hostname=${HOSTNAME_ARG})"
  # Migration douce : un .env antérieur à l'auth bootstrap n'a pas STALMAIL_SETUP_TOKEN_HASH.
  # Cette variable est désormais REQUISE par compose.prod.yml → sans elle, `docker compose up`
  # échoue avant tout affichage. On génère donc un jeton et on ajoute son hash au .env ; le
  # jeton en clair (SETUP_TOKEN) sert à imprimer le lien fonctionnel dans l'encadré final.
  EXISTING_SETUP_HASH=$(awk -F= '$1=="STALMAIL_SETUP_TOKEN_HASH"{print $2}' .env | tail -n1)
  if [ -z "${EXISTING_SETUP_HASH}" ]; then
    gen_setup_token
    SETUP_TOKEN_HASH=$(printf '%s' "${SETUP_TOKEN}" | sha256hex)
    printf 'STALMAIL_SETUP_TOKEN_HASH=%s\n' "${SETUP_TOKEN_HASH}" >> .env
    chmod 600 .env
    echo "✓ .env migré (STALMAIL_SETUP_TOKEN_HASH ajouté)"
  fi
  # Si le hash existait déjà, le jeton en clair n'est pas récupérable (seul le hash est
  # persisté) → SETUP_TOKEN reste vide, géré dans l'encadré final ci-dessous.
  # Migration douce : un .env antérieur à la topologie mail n'a pas
  # STALMAIL_MAIL_DOMAIN, désormais REQUISE par compose.prod.yml → sans elle,
  # `docker compose up` échoue avant tout affichage.
  EXISTING_MAIL_DOMAIN=$(awk -F= '$1=="STALMAIL_MAIL_DOMAIN"{print $2}' .env | tail -n1)
  if [ -z "${EXISTING_MAIL_DOMAIN}" ]; then
    printf 'STALMAIL_MAIL_DOMAIN=%s\n' "${MAIL_DOMAIN_ARG}" >> .env
    chmod 600 .env
    echo "✓ .env migré (STALMAIL_MAIL_DOMAIN=${MAIL_DOMAIN_ARG} ajouté)"
  fi
fi

# 5. Démarrage.
echo "→ Récupération des images GHCR + démarrage..."
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d

echo "→ Vérification du démarrage des services..."
ok=0
for _ in $(seq 1 15); do
  running=$(docker compose -f compose.prod.yml ps --services --filter status=running 2>/dev/null | sort -u)
  if printf '%s\n' "${running}" | grep -qx stalwart \
     && printf '%s\n' "${running}" | grep -qx app \
     && printf '%s\n' "${running}" | grep -qx caddy; then ok=1; break; fi
  sleep 2
done
if [ "${ok}" != 1 ]; then
  echo "❌ Un ou plusieurs services ne sont pas démarrés :"
  docker compose -f compose.prod.yml ps
  echo "   Logs : docker compose -f compose.prod.yml logs"
  exit 1
fi
echo "✓ Services démarrés (stalwart, app, caddy)"

# IP publique pour l'URL d'accès au wizard. `hostname -I` (Linux) puis fallbacks
# portables (macOS/BSD) ; placeholder si rien n'est détecté (n'empêche pas l'install).
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "${IP}" ] && IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
[ -z "${IP}" ] && IP=$(ipconfig getifaddr en0 2>/dev/null)
[ -z "${IP}" ] && IP="<ip-du-serveur>"
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  Stalmail démarré.                                             ║"
echo "║                                                                ║"
if [ -n "${SETUP_TOKEN}" ]; then
echo "║  1. Ouvre le wizard (certificat auto-signé → accepte           ║"
echo "║     l'avertissement) avec CE lien contenant ton jeton :        ║"
echo "║                                                                ║"
echo "║    https://${IP}/setup#token=${SETUP_TOKEN}"
echo "║                                                                ║"
echo "║     Le jeton autorise le wizard ; il n'est pas stocké côté     ║"
echo "║     serveur (seul son hash SHA-256 est dans .env).             ║"
echo "║     ⚠ Ne partage pas cette URL — elle ouvre le setup.          ║"
else
echo "║  1. Jeton de setup non disponible (.env existant).             ║"
echo "║     Pour regénérer un lien de setup :                          ║"
echo "║       TOKEN=\$(openssl rand -hex 24)                            ║"
echo "║       HASH=\$(printf '%s' \"\$TOKEN\" | openssl dgst -sha256 | awk '{print \$NF}')"
echo "║       # Mettre à jour STALMAIL_SETUP_TOKEN_HASH dans .env,     ║"
echo "║       # puis redémarrer : docker compose -f compose.prod.yml   ║"
echo "║       #   up -d app                                            ║"
echo "║       # URL : https://${IP}/setup#token=\$TOKEN               ║"
fi
echo "║                                                                ║"
echo "║  2. Renseigne le domaine + le token Cloudflare : le wizard     ║"
echo "║     publie TOUT le DNS (A, MX, SPF, DKIM, DMARC).             ║"
echo "║  3. Une fois le DNS propagé, utilise :                         ║"
echo "║         https://${HOSTNAME_ARG}"
echo "╚════════════════════════════════════════════════════════════════╝"
