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
  ( cd "${STALWART_DATA_DIR}" && exec "${STALWART_BIN}" --config "${STALWART_CONFIG}" ) &
  STALWART_PID=$!
}

trap 'term_wait_kill "${STALWART_PID}"; exit 0' TERM INT
start_stalwart

while true; do
  if [ -f "${SENTINEL}" ]; then
    rm -f "${SENTINEL}"
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
