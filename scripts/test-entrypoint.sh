#!/bin/bash
# Deterministic, Docker-free test of the entrypoint.sh Stalwart supervisor.
# Drives the real entrypoint.sh with stub binaries and asserts:
#   1. startup (Stalwart launched once, healthz ready)
#   2. sentinel-triggered restart (old stub gets TERM, new one launched)
#   3. clean SIGTERM shutdown (running stub stalwart receives TERM — not orphaned)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENTRYPOINT="${REPO_DIR}/entrypoint.sh"

PORT=18099
TMP="$(mktemp -d)"
STARTS="${TMP}/starts"
TERMLOG="${TMP}/termlog"
ENTRY_LOG="${TMP}/entrypoint.log"
: > "${STARTS}"
: > "${TERMLOG}"

ENTRY_PID=""

cleanup() {
  if [ -n "${ENTRY_PID}" ]; then
    # Kill the whole process group of the entrypoint job.
    kill -TERM -- "-${ENTRY_PID}" 2>/dev/null || true
    kill -KILL -- "-${ENTRY_PID}" 2>/dev/null || true
    kill -KILL "${ENTRY_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP}"
}
trap cleanup EXIT INT TERM

fail() {
  echo "FAIL: $*" >&2
  echo "----- entrypoint log -----" >&2
  cat "${ENTRY_LOG}" >&2 2>/dev/null || true
  echo "--------------------------" >&2
  exit 1
}

# ── Stub stalwart ────────────────────────────────────────────────
# Records each launch, serves 200 on the test port for the healthz check,
# and on TERM records the event and kills its python server.
cat > "${TMP}/stalwart" <<EOF
#!/bin/bash
echo "launch \$\$" >> "${STARTS}"
PYPID=""
on_term() {
  echo "term \$\$" >> "${TERMLOG}"
  [ -n "\${PYPID}" ] && kill "\${PYPID}" 2>/dev/null || true
  exit 0
}
trap on_term TERM
python3 -c 'import sys
from http.server import BaseHTTPRequestHandler,HTTPServer
class H(BaseHTTPRequestHandler):
 def do_GET(s): s.send_response(200); s.end_headers(); s.wfile.write(b"ok")
 def log_message(s,*a): pass
HTTPServer.allow_reuse_address=True
HTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()' "${PORT}" &
PYPID=\$!
wait "\${PYPID}"
EOF
chmod +x "${TMP}/stalwart"

# ── Stub caddy / app ─────────────────────────────────────────────
# Long-lived, exit cleanly on TERM, never exit on their own (else wait -n
# in the entrypoint would tear everything down prematurely).
make_longlived_stub() {
  cat > "$1" <<'EOF'
#!/bin/bash
trap 'exit 0' TERM
sleep 300 &
wait
EOF
  chmod +x "$1"
}
make_longlived_stub "${TMP}/caddy"
make_longlived_stub "${TMP}/app"

# ── Launch the entrypoint in its own process group ───────────────
set -m
STALMAIL_SECRET=test \
STALWART_BIN="${TMP}/stalwart" \
STALWART_DATA_DIR="${TMP}" \
STALWART_CONFIG="${TMP}/config.json" \
CADDY_BIN="${TMP}/caddy" \
APP_CMD="${TMP}/app" \
HEALTHZ_URL="http://127.0.0.1:${PORT}/healthz" \
STALMAIL_RUN_DIR="${TMP}/run" \
  bash "${ENTRYPOINT}" > "${ENTRY_LOG}" 2>&1 &
ENTRY_PID=$!
set +m

count_lines() { wc -l < "$1" | tr -d ' '; }

# ── Assertion 1: startup ─────────────────────────────────────────
i=0
until grep -q "Stalwart ready" "${ENTRY_LOG}" 2>/dev/null; do
  i=$((i + 1))
  if [ "${i}" -ge 200 ]; then
    fail "timeout waiting for 'Stalwart ready' (assertion 1)"
  fi
  if ! kill -0 "${ENTRY_PID}" 2>/dev/null; then
    fail "entrypoint exited prematurely before becoming ready (assertion 1)"
  fi
  sleep 0.1
done
starts1="$(count_lines "${STARTS}")"
[ "${starts1}" -eq 1 ] || fail "expected exactly 1 stalwart launch, got ${starts1} (assertion 1)"
echo "OK assertion 1: startup — Stalwart ready, launched exactly once"

# ── Assertion 2: sentinel-triggered restart ──────────────────────
echo 1 > "${TMP}/run/restart-stalwart"
i=0
while :; do
  starts2="$(count_lines "${STARTS}")"
  terms="$(count_lines "${TERMLOG}")"
  if [ "${starts2}" -ge 2 ] && [ "${terms}" -ge 1 ]; then
    break
  fi
  i=$((i + 1))
  if [ "${i}" -ge 100 ]; then
    fail "timeout waiting for restart (starts=${starts2}, terms=${terms}) (assertion 2)"
  fi
  sleep 0.1
done
grep -q "Restart requested" "${ENTRY_LOG}" 2>/dev/null \
  || fail "expected 'Restart requested' in log (assertion 2)"
terms_before_shutdown="$(count_lines "${TERMLOG}")"
echo "OK assertion 2: sentinel restart — relaunched (${starts2} starts), old stub got TERM (${terms_before_shutdown} terms), 'Restart requested' logged"

# ── Assertion 3: clean SIGTERM shutdown ──────────────────────────
kill -TERM "${ENTRY_PID}"
i=0
while kill -0 "${ENTRY_PID}" 2>/dev/null; do
  i=$((i + 1))
  if [ "${i}" -ge 100 ]; then
    fail "timeout waiting for entrypoint to exit on SIGTERM (assertion 3)"
  fi
  sleep 0.1
done
wait "${ENTRY_PID}" 2>/dev/null || true
terms_after_shutdown="$(count_lines "${TERMLOG}")"
[ "${terms_after_shutdown}" -gt "${terms_before_shutdown}" ] \
  || fail "running stub stalwart did NOT receive TERM on shutdown — orphaned? (before=${terms_before_shutdown}, after=${terms_after_shutdown}) (assertion 3)"
if kill -0 "${ENTRY_PID}" 2>/dev/null; then
  fail "entrypoint process still alive after shutdown (assertion 3)"
fi
echo "OK assertion 3: clean shutdown — entrypoint exited, running stalwart got TERM (terms ${terms_before_shutdown} -> ${terms_after_shutdown})"

ENTRY_PID=""  # already reaped; cleanup needn't kill it
echo "ENTRYPOINT SUPERVISOR TEST PASSED"
