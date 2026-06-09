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

# Démarrer Stalwart en arrière-plan (credentials passés uniquement à ce process)
STALWART_RECOVERY_ADMIN="${_RECOVERY_ADMIN}" STALWART_URL="${STALWART_URL}" \
  /usr/local/bin/stalwart --config /etc/stalwart/config.toml &
STALWART_PID=$!

# Attendre que Stalwart soit prêt (timeout 60 s)
echo "[stalmail] Waiting for Stalwart..."
_i=0
until curl -sf http://localhost:8080/healthz/live > /dev/null 2>&1; do
  _i=$((_i + 1))
  if [ "${_i}" -ge 60 ]; then
    echo "[stalmail] ERROR: Stalwart failed to start within 60 seconds" >&2
    exit 1
  fi
  sleep 1
done
echo "[stalmail] Stalwart ready"

# Démarrer Caddy en arrière-plan (PID tracké pour wait -n)
caddy run --config /etc/caddy/Caddyfile &
CADDY_PID=$!
echo "[stalmail] Caddy ready"

# Démarrer TanStack Start (BFF a besoin des credentials pour stalwartAdminFetch)
echo "[stalmail] Starting app server..."
STALWART_RECOVERY_ADMIN="${_RECOVERY_ADMIN}" STALWART_URL="${STALWART_URL}" \
  node /app/server.js &
APP_PID=$!

# Tuer proprement tous les processus enfants
cleanup() {
  echo "[stalmail] Shutting down..."
  kill "${STALWART_PID}" "${CADDY_PID}" "${APP_PID}" 2>/dev/null || true
  wait "${STALWART_PID}" "${CADDY_PID}" "${APP_PID}" 2>/dev/null || true
}
# EXIT couvre les sorties inattendues dues à set -e (ex: crash d'un enfant)
trap cleanup EXIT SIGTERM SIGINT

# wait -n disponible depuis bash 4.3 (debian bookworm : bash 5.2)
# &&/|| pour capturer l'exit code sans déclencher set -e
wait -n "${STALWART_PID}" "${CADDY_PID}" "${APP_PID}" && EXIT_CODE=$? || EXIT_CODE=$?
trap - EXIT   # éviter double-appel de cleanup au exit suivant
cleanup
exit "${EXIT_CODE}"
