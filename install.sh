#!/bin/bash
set -euo pipefail

# Run from a checkout of the Stalmail repo (build context = repo root). Brings up the
# compose stack (caddy + app + stock stalwart) with a single `docker compose up -d`.

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

if ! docker compose version &> /dev/null; then
  echo "❌ Le plugin 'docker compose' (v2) est requis."
  echo "   → https://docs.docker.com/compose/install/"
  exit 1
fi

echo "✓ Docker + Compose détectés"

# Générer le secret une fois et le persister dans .env (lu par compose).
if [ ! -f .env ]; then
  SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 64)
  printf 'STALMAIL_SECRET=%s\n' "${SECRET}" > .env
  chmod 600 .env
  echo "✓ .env créé (STALMAIL_SECRET généré)"
else
  echo "✓ .env existant conservé"
fi

echo "→ Démarrage de la stack Stalmail (docker compose)..."
docker compose -f compose.yml up -d --build

echo "→ Vérification du démarrage des services..."
ok=0
for i in $(seq 1 15); do
  running=$(docker compose -f compose.yml ps --services --filter status=running 2>/dev/null | sort -u)
  if printf '%s\n' "${running}" | grep -qx stalwart \
     && printf '%s\n' "${running}" | grep -qx app \
     && printf '%s\n' "${running}" | grep -qx caddy; then ok=1; break; fi
  sleep 2
done
if [ "${ok}" != 1 ]; then
  echo "❌ Un ou plusieurs services ne sont pas démarrés :"
  docker compose -f compose.yml ps
  echo "   Logs : docker compose -f compose.yml logs"
  exit 1
fi
echo "✓ Services démarrés (stalwart, app, caddy)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Ouvre https://$(hostname -I | awk '{print $1}') dans ton navigateur  ║"
echo "║  Le wizard de configuration va démarrer.     ║"
echo "╚══════════════════════════════════════════════╝"
