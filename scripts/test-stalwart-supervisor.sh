#!/usr/bin/env bash
# Stub-based test for docker/stalwart/entrypoint.sh: a fake stalwart binary lets us
# assert (1) it starts once, (2) a sentinel triggers a restart, (3) TERM shuts it down.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="${HERE}/docker/stalwart/entrypoint.sh"
TMP="$(mktemp -d)"
ENTRY_PID=""
trap 'rm -rf "${TMP}"; [ -n "${ENTRY_PID}" ] && kill "${ENTRY_PID}" 2>/dev/null || true' EXIT

# Fake stalwart: append a line on each start, then sleep forever (until TERM).
cat > "${TMP}/stalwart" <<'STUB'
#!/usr/bin/env bash
echo "start $$" >> "${STARTS_LOG}"
trap 'echo "term $$" >> "${TERMS_LOG}"; exit 0' TERM
while true; do sleep 0.2; done
STUB
chmod +x "${TMP}/stalwart"
mkdir -p "${TMP}/data" "${TMP}/shared"
: > "${TMP}/starts"; : > "${TMP}/terms"

STARTS_LOG="${TMP}/starts" TERMS_LOG="${TMP}/terms" \
  STALWART_BIN="${TMP}/stalwart" \
  STALWART_CONFIG="${TMP}/config.json" \
  STALWART_DATA_DIR="${TMP}/data" \
  STALMAIL_RUN_DIR="${TMP}/shared" \
  bash "${ENTRY}" >/dev/null 2>&1 &
ENTRY_PID=$!

count() { wc -l < "$1" | tr -d ' '; }
wait_for() { i=0; until [ "$(count "$1")" -ge "$2" ]; do sleep 0.2; i=$((i+1)); [ "$i" -lt 50 ] || { echo "FAIL: $3"; exit 1; }; done; }

wait_for "${TMP}/starts" 1 "stalwart did not start"
echo "OK 1: started once"

# Sentinel → restart (a 2nd start, and the 1st got TERM).
touch "${TMP}/shared/restart-stalwart"
wait_for "${TMP}/starts" 2 "sentinel did not trigger a restart"
wait_for "${TMP}/terms" 1 "old stalwart was not terminated on restart"
echo "OK 2: sentinel restart"

# TERM the supervisor → running stalwart gets TERM.
kill -TERM "${ENTRY_PID}"
wait_for "${TMP}/terms" 2 "running stalwart not terminated on shutdown"
echo "OK 3: clean shutdown"
echo "STALWART SUPERVISOR TEST PASSED"
