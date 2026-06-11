#!/usr/bin/env bash
# Stub-based test for docker/stalwart/entrypoint.sh: a fake stalwart binary lets us
# assert (1) it starts once, (2) a sentinel triggers a restart, (3) the recovery-admin
# hardening drops STALWART_RECOVERY_ADMIN once the setup flag is present, (4) TERM
# shuts it down.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="${HERE}/docker/stalwart/entrypoint.sh"
TMP="$(mktemp -d)"
ENTRY_PID=""
trap 'rm -rf "${TMP}"; [ -n "${ENTRY_PID}" ] && kill "${ENTRY_PID}" 2>/dev/null || true' EXIT

# Fake stalwart: on each start, record whether the recovery admin is in its env, then
# sleep forever (until TERM).
cat > "${TMP}/stalwart" <<'STUB'
#!/usr/bin/env bash
if [ -n "${STALWART_RECOVERY_ADMIN:-}" ]; then rec=SET; else rec=UNSET; fi
echo "start $$ recovery=${rec}" >> "${STARTS_LOG}"
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
  STALWART_RECOVERY_ADMIN="stalmail-admin:test-secret" \
  bash "${ENTRY}" >/dev/null 2>&1 &
ENTRY_PID=$!

count() { wc -l < "$1" | tr -d ' '; }
wait_for() { i=0; until [ "$(count "$1")" -ge "$2" ]; do sleep 0.2; i=$((i+1)); [ "$i" -lt 50 ] || { echo "FAIL: $3"; exit 1; }; done; }
assert_start_recovery() { # <1-based line index> <SET|UNSET> <message>
  got="$(sed -n "${1}p" "${TMP}/starts")"
  case "${got}" in *"recovery=${2}"*) ;; *) echo "FAIL: $3 (got: ${got})"; exit 1;; esac
}

wait_for "${TMP}/starts" 1 "stalwart did not start"
echo "OK 1: started once"

# Pre-setup (flag absent): the recovery admin is passed through to Stalwart.
assert_start_recovery 1 SET "recovery admin should be present before setup"
echo "OK 2: recovery admin active pre-setup"

# Sentinel → restart (a 2nd start, and the 1st got TERM). Flag still absent → still SET.
touch "${TMP}/shared/restart-stalwart"
wait_for "${TMP}/starts" 2 "sentinel did not trigger a restart"
wait_for "${TMP}/terms" 1 "old stalwart was not terminated on restart"
assert_start_recovery 2 SET "recovery admin should still be present mid-wizard"
echo "OK 3: sentinel restart (recovery still active)"

# Finalize: the wizard writes the configured flag → next (re)start drops the recovery admin.
touch "${TMP}/shared/.stalmail-configured"
touch "${TMP}/shared/restart-stalwart"
wait_for "${TMP}/starts" 3 "flagged restart did not start"
assert_start_recovery 3 UNSET "recovery admin must be dropped once setup is complete"
echo "OK 4: recovery admin hardened after setup flag"

# TERM the supervisor → running stalwart gets TERM.
kill -TERM "${ENTRY_PID}"
wait_for "${TMP}/terms" 3 "running stalwart not terminated on shutdown"
echo "OK 5: clean shutdown"
echo "STALWART SUPERVISOR TEST PASSED"
