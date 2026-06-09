#!/bin/bash
set -euo pipefail

# Générer STALWART_RECOVERY_ADMIN depuis STALMAIL_SECRET si non fourni
export STALWART_RECOVERY_ADMIN="${STALWART_RECOVERY_ADMIN:-stalmail-admin:${STALMAIL_SECRET}}"
export STALWART_URL="http://localhost:8080"

# Initialiser la config Stalwart au premier démarrage
if [ ! -f /etc/stalwart/config.toml ]; then
  echo "[stalmail] First boot: initializing Stalwart config..."
  /usr/local/bin/stalwart --init /etc/stalwart
fi

# Démarrer Stalwart en background
/usr/local/bin/stalwart --config /etc/stalwart/config.toml &
STALWART_PID=$!

# Attendre que Stalwart soit prêt
echo "[stalmail] Waiting for Stalwart..."
until curl -sf http://localhost:8080/healthz/live > /dev/null 2>&1; do
  sleep 1
done
echo "[stalmail] Stalwart ready"

# Démarrer Caddy en background
caddy start --config /etc/caddy/Caddyfile
echo "[stalmail] Caddy ready"

# Démarrer TanStack Start
echo "[stalmail] Starting app server..."
cd /app && node server.js &
APP_PID=$!

# Forwarder les signaux
trap "kill ${STALWART_PID} ${APP_PID}; caddy stop" SIGTERM SIGINT

wait ${STALWART_PID} ${APP_PID}
