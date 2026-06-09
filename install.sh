#!/bin/bash
set -euo pipefail

CONTAINER_NAME="stalmail"
IMAGE="ghcr.io/stalmail/stalmail:latest"

echo "╔══════════════════════════════════╗"
echo "║        Stalmail Installer        ║"
echo "╚══════════════════════════════════╝"
echo ""

# Vérifier Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker n'est pas installé."
  echo "   → https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &> /dev/null; then
  echo "❌ Docker daemon non accessible. Essayez : sudo systemctl start docker"
  exit 1
fi

echo "✓ Docker détecté"

# Arrêter un container existant
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "→ Container existant détecté, arrêt..."
  docker stop "${CONTAINER_NAME}" > /dev/null 2>&1 || true
  docker rm "${CONTAINER_NAME}" > /dev/null 2>&1 || true
fi

# Créer les volumes s'ils n'existent pas
docker volume create stalmail-config > /dev/null 2>&1 || true
docker volume create stalmail-data > /dev/null 2>&1 || true
echo "✓ Volumes prêts (stalmail-config, stalmail-data)"

# Générer STALMAIL_SECRET
SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 64)

# Lancer le container
echo "→ Démarrage de Stalmail..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -e "STALMAIL_SECRET=${SECRET}" \
  -p 443:443 -p 80:80 \
  -p 25:25 -p 587:587 -p 465:465 \
  -p 993:993 -p 143:143 \
  -v stalmail-config:/etc/stalwart \
  -v stalmail-data:/var/lib/stalwart \
  "${IMAGE}" > /dev/null

echo "✓ Stalmail démarré"
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Ouvre http://$(hostname -I | awk '{print $1}') dans ton navigateur  ║"
echo "║  Le wizard de configuration va démarrer.     ║"
echo "╚══════════════════════════════════════════════╝"
