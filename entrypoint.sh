#!/bin/bash
set -euo pipefail

# STALMAIL_SECRET est requis — le container refuse de démarrer sans lui
: "${STALMAIL_SECRET:?STALMAIL_SECRET must be set to a strong random value (see install.sh)}"

# Dériver les credentials admin (uniquement si non fournis explicitement)
_RECOVERY_ADMIN="${STALWART_RECOVERY_ADMIN:-stalmail-admin:${STALMAIL_SECRET}}"
STALWART_URL="http://localhost:8080"

# Initialiser la config Stalwart au premier démarrage
if [ ! -f /etc/stalwart/config.toml ]; then
  echo "[stalmail] First boot: initializing Stalwart config..."
  /usr/local/bin/stalwart --init /etc/stalwart
fi

# Démarrer Stalwart en background (credentials passés uniquement à ce process)
STALWART_RECOVERY_ADMIN="${_RECOVERY_ADMIN}" STALWART_URL="${STALWART_URL}" \
  /usr/local/bin/stalwart --config /etc/stalwart/config.toml &
STALWART_PID=$!

# Attendre que Stalwart soit prêt
echo "[stalmail] Waiting for Stalwart..."
until curl -sf http://localhost:8080/healthz/live > /dev/null 2>&1; do
  sleep 1
done
echo "[stalmail] Stalwart ready"

# Démarrer Caddy en background (pas accès aux credentials admin)
caddy start --config /etc/caddy/Caddyfile
echo "[stalmail] Caddy ready"

# Démarrer TanStack Start (BFF a besoin des credentials pour stalwartAdminFetch)
echo "[stalmail] Starting app server..."
STALWART_RECOVERY_ADMIN="${_RECOVERY_ADMIN}" STALWART_URL="${STALWART_URL}" \
  node /app/server.js &
APP_PID=$!

# Forwarder les signaux
trap "kill ${STALWART_PID} ${APP_PID}; caddy stop" SIGTERM SIGINT

wait ${STALWART_PID} ${APP_PID}
