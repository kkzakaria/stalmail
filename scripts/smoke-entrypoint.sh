#!/bin/bash
# Integration smoke test for the stalmail image entrypoint. Requires building
# the image; intended for CI/local where the network allows `bun install`.
#
# Verifies, against the REAL image:
#   - the container boots and /healthz/live becomes ready
#   - Stalwart starts in bootstrap mode
#   - touching the restart sentinel triggers a supervisor restart
#   - healthz recovers after the restart
#   - `docker stop` results in a clean shutdown
set -euo pipefail

IMAGE="stalmail-entrypoint-smoke"
CONTAINER="stalmail-entrypoint-smoke-run"
HOST_PORT=18080

cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

fail() {
  echo "FAIL: $*" >&2
  echo "----- docker logs -----" >&2
  docker logs "${CONTAINER}" 2>&1 || true
  echo "-----------------------" >&2
  exit 1
}

echo "[smoke] Building image ${IMAGE}..."
docker build -t "${IMAGE}" .

echo "[smoke] Starting container ${CONTAINER}..."
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${CONTAINER}" \
  -e STALMAIL_SECRET=ci-secret \
  -p "${HOST_PORT}:8080" \
  "${IMAGE}" >/dev/null

# ── Wait for healthz ─────────────────────────────────────────────
echo "[smoke] Waiting for http://localhost:${HOST_PORT}/healthz/live..."
i=0
until curl -sf "http://localhost:${HOST_PORT}/healthz/live" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "${i}" -ge 120 ]; then
    fail "healthz never became ready (initial startup)"
  fi
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    fail "container exited during startup"
  fi
  sleep 1
done
echo "OK: healthz ready"

# ── Assert bootstrap mode ────────────────────────────────────────
if docker logs "${CONTAINER}" 2>&1 | grep -qi "bootstrap"; then
  echo "OK: bootstrap mode detected in logs"
else
  fail "expected Stalwart bootstrap mode indication in logs"
fi

# ── Trigger sentinel-based restart ───────────────────────────────
echo "[smoke] Touching restart sentinel..."
docker exec "${CONTAINER}" touch /run/stalmail/restart-stalwart \
  || fail "could not touch restart sentinel via docker exec"

echo "[smoke] Waiting for 'Restart requested' log line..."
i=0
until docker logs "${CONTAINER}" 2>&1 | grep -q "Restart requested"; do
  i=$((i + 1))
  if [ "${i}" -ge 30 ]; then
    fail "'Restart requested' never appeared in logs after touching sentinel"
  fi
  sleep 1
done
echo "OK: 'Restart requested' logged"

echo "[smoke] Waiting for healthz to recover after restart..."
i=0
until curl -sf "http://localhost:${HOST_PORT}/healthz/live" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "${i}" -ge 120 ]; then
    fail "healthz did not recover after restart"
  fi
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    fail "container exited during post-restart recovery"
  fi
  sleep 1
done
echo "OK: healthz recovered after restart"

# ── Clean shutdown ───────────────────────────────────────────────
echo "[smoke] Stopping container (clean SIGTERM shutdown)..."
docker stop "${CONTAINER}" >/dev/null || fail "docker stop failed"
EXIT_CODE="$(docker inspect -f '{{.State.ExitCode}}' "${CONTAINER}")"
# 0 = clean exit; 143 = 128+SIGTERM, also a clean TERM-handled exit.
if [ "${EXIT_CODE}" = "0" ] || [ "${EXIT_CODE}" = "143" ]; then
  echo "OK: clean shutdown (exit code ${EXIT_CODE})"
else
  fail "non-clean shutdown exit code: ${EXIT_CODE}"
fi

echo "ENTRYPOINT IMAGE SMOKE TEST PASSED"
