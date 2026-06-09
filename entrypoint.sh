#!/bin/bash
set -euo pipefail

# STALMAIL_SECRET est requis — le container refuse de démarrer sans lui
: "${STALMAIL_SECRET:?STALMAIL_SECRET must be set to a strong random value (see install.sh)}"

# Dériver les credentials admin (uniquement si non fournis explicitement)
_RECOVERY_ADMIN="${STALWART_RECOVERY_ADMIN:-stalmail-admin:${STALMAIL_SECRET}}"

# ── Stalwart (v0.16 bootstrap model) ─────────────────────────────
# No --init / config.toml. On a blank /etc/stalwart the server enters
# bootstrap mode automatically; the BFF drives setup and asks for a restart
# via the sentinel below to switch into normal mode.
export STALWART_RECOVERY_ADMIN="${_RECOVERY_ADMIN}"
export STALWART_URL="http://localhost:8080"

RUN_DIR="${STALMAIL_RUN_DIR:-/run/stalmail}"
mkdir -p "${RUN_DIR}"
RESTART_SENTINEL="${RUN_DIR}/restart-stalwart"

start_stalwart() {
  /usr/local/bin/stalwart &
  STALWART_PID=$!
}

# Supervisor: (re)start Stalwart for the life of the container. A restart is
# requested by the BFF touching ${RESTART_SENTINEL} (after the Bootstrap submit).
supervise_stalwart() {
  start_stalwart
  while true; do
    if [ -f "${RESTART_SENTINEL}" ]; then
      rm -f "${RESTART_SENTINEL}"
      echo "[stalmail] Restart requested — restarting Stalwart into normal mode..."
      kill "${STALWART_PID}" 2>/dev/null || true
      wait "${STALWART_PID}" 2>/dev/null || true
      start_stalwart
    fi
    # If Stalwart died on its own (crash), exit the supervisor so the container
    # restarts under Docker's restart policy.
    if ! kill -0 "${STALWART_PID}" 2>/dev/null; then
      echo "[stalmail] Stalwart exited unexpectedly" >&2
      return 1
    fi
    sleep 2
  done
}

supervise_stalwart &
SUPERVISOR_PID=$!

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
  STALMAIL_RUN_DIR="${RUN_DIR}" \
  node /app/server/server.js &
APP_PID=$!

# Tuer proprement tous les processus enfants
cleanup() {
  echo "[stalmail] Shutting down..."
  kill "${SUPERVISOR_PID}" "${STALWART_PID}" "${CADDY_PID}" "${APP_PID}" 2>/dev/null || true
  wait "${SUPERVISOR_PID}" "${CADDY_PID}" "${APP_PID}" 2>/dev/null || true
}
# EXIT couvre les sorties inattendues dues à set -e (ex: crash d'un enfant)
trap cleanup EXIT SIGTERM SIGINT

# wait -n disponible depuis bash 4.3 (debian bookworm : bash 5.2)
# &&/|| pour capturer l'exit code sans déclencher set -e
wait -n "${SUPERVISOR_PID}" "${CADDY_PID}" "${APP_PID}" 2>/dev/null && EXIT_CODE=$? || EXIT_CODE=$?
trap - EXIT   # éviter double-appel de cleanup au exit suivant
cleanup
exit "${EXIT_CODE}"
