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

REPO_RAW="https://raw.githubusercontent.com/kkzakaria/stalmail/main"
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
  echo "✓ .env existant conservé"
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

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
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
