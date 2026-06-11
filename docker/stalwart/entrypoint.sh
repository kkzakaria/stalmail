#!/usr/bin/env bash
# Restart-supervisor for the STOCK Stalwart binary, run as the stalwart service's
# entrypoint. Launches `stalwart --config <path>` from its data dir (matching the
# official image), and restarts it when the BFF writes the shared-volume sentinel —
# the bootstrap→normal transition. The Stalwart binary and config stay 100% stock.
set -euo pipefail

STALWART_BIN="${STALWART_BIN:-/usr/local/bin/stalwart}"
STALWART_CONFIG="${STALWART_CONFIG:-/etc/stalwart/config.json}"
STALWART_DATA_DIR="${STALWART_DATA_DIR:-/var/lib/stalwart}"
RUN_DIR="${STALMAIL_RUN_DIR:-/shared}"
SENTINEL="${RUN_DIR}/restart-stalwart"
# Recovery-admin hardening: the wizard writes this flag (markSetupComplete) into the
# shared volume on finalize. Its presence at (re)start makes us drop the permanent
# STALWART_RECOVERY_ADMIN credential — see start_stalwart.
CONFIGURED_FLAG="${STALMAIL_CONFIGURED_FLAG:-${RUN_DIR}/.stalmail-configured}"
mkdir -p "${RUN_DIR}"

term_wait_kill() {
  local pid="$1" i
  kill -TERM "${pid}" 2>/dev/null || true
  for i in $(seq 1 10); do kill -0 "${pid}" 2>/dev/null || return 0; sleep 0.5; done
  kill -KILL "${pid}" 2>/dev/null || true
}

start_stalwart() {
  # Subshell cd so Stalwart runs from its data dir (like the official WORKDIR) without
  # changing this script's cwd. exec keeps the subshell PID = the real process.
  #
  # Hardening: once setup is complete (flag present), launch Stalwart WITHOUT the
  # recovery admin so the management API on :8080 is no longer reachable via the
  # permanent recovery credential. Before setup the flag is absent, so the recovery
  # admin stays active for the wizard; the gate takes effect at the next (re)start
  # after finalize. (`env -u` execs Stalwart with that single var removed.)
  if [ -f "${CONFIGURED_FLAG}" ]; then
    echo "[stalwart-sup] setup complete — starting Stalwart WITHOUT recovery admin (:8080 management hardened)"
    ( cd "${STALWART_DATA_DIR}" && exec env -u STALWART_RECOVERY_ADMIN "${STALWART_BIN}" --config "${STALWART_CONFIG}" ) &
  else
    ( cd "${STALWART_DATA_DIR}" && exec "${STALWART_BIN}" --config "${STALWART_CONFIG}" ) &
  fi
  STALWART_PID=$!
}

trap 'term_wait_kill "${STALWART_PID}"; exit 0' TERM INT
start_stalwart

while true; do
  if [ -f "${SENTINEL}" ]; then
    if ! rm -f "${SENTINEL}" || [ -f "${SENTINEL}" ]; then
      echo "[stalwart-sup] WARN: could not remove sentinel ${SENTINEL}; backing off 30s to avoid a restart loop" >&2
      sleep 30
      continue
    fi
    echo "[stalwart-sup] restart requested — restarting Stalwart into normal mode..."
    term_wait_kill "${STALWART_PID}"
    wait "${STALWART_PID}" 2>/dev/null || true
    start_stalwart
  fi
  if ! kill -0 "${STALWART_PID}" 2>/dev/null; then
    echo "[stalwart-sup] Stalwart exited; supervisor exiting so Docker can restart it" >&2
    wait "${STALWART_PID}" 2>/dev/null
    exit $?
  fi
  sleep 2
done
