#!/usr/bin/env bash
set -euo pipefail

# Stalmail — installeur serveur en UNE commande (images GHCR, sans build, sans copie).
#
#   curl -fsSL https://raw.githubusercontent.com/kkzakaria/stalmail/main/install.sh \
#     | bash -s -- mail.getstalmail.com
#
# Ou en local :  ./install.sh mail.getstalmail.com
#
# Le SEUL paramètre requis est le hostname public. Le script :
#   - vérifie Docker + Compose v2,
#   - récupère compose.prod.yml + Caddyfile depuis le repo (images publiques GHCR),
#   - génère .env (STALMAIL_SECRET aléatoire + STALMAIL_HOSTNAME + STALMAIL_PUBLIC_URL),
#   - tire les images et démarre la stack.
# Le reste (domaine, DNS, SSL, DKIM) se configure dans le wizard in-app.

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

# 1. Hostname (argument ou prompt).
HOSTNAME_ARG="${1:-}"
if [ -z "${HOSTNAME_ARG}" ]; then
  read -rp "Hostname public du webmail (ex. mail.getstalmail.com) : " HOSTNAME_ARG
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

# 4. .env (généré une fois, conservé ensuite).
if [ ! -f .env ]; then
  SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 64)
  {
    printf 'STALMAIL_SECRET=%s\n' "${SECRET}"
    printf 'STALMAIL_HOSTNAME=%s\n' "${HOSTNAME_ARG}"
    printf 'STALMAIL_PUBLIC_URL=https://%s\n' "${HOSTNAME_ARG}"
  } > .env
  chmod 600 .env
  echo "✓ .env créé (secret généré, hostname=${HOSTNAME_ARG})"
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
echo "║  Stalmail démarré.                                               ║"
echo "║                                                                  ║"
echo "║  1. Ouvre le wizard via l'IP (certificat auto-signé, accepte     ║"
echo "║     l'avertissement) :   https://${IP}/setup"
echo "║  2. Renseigne le domaine + le token Cloudflare : le wizard       ║"
echo "║     publie TOUT le DNS (A, MX, SPF, DKIM, DMARC).                 ║"
echo "║  3. Une fois le DNS propagé, utilise :                           ║"
echo "║         https://${HOSTNAME_ARG}"
echo "╚════════════════════════════════════════════════════════════════╝"
