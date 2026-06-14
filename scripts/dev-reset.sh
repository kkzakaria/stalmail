#!/usr/bin/env bash
# Reset the Stalmail dev stack to a clean FIRST-RUN (bootstrap) state:
#   - tears the stack down and DROPS its volumes (config, data, shared flag/sentinel,
#     node_modules) so Stalwart comes back up in bootstrap mode,
#   - (optionally) rebuilds the Stalwart image when its entrypoint/Dockerfile changed,
#   - brings everything up (host-network installer → app → stalwart → caddy),
#   - waits until the wizard is reachable, then prints how to open it.
#
# Usage:
#   scripts/dev-reset.sh           # fast reset (reuse the current images)
#   scripts/dev-reset.sh --build   # also rebuild the stalwart image first
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "${HERE}"
COMPOSE="docker compose -f compose.dev.yml"
SETUP_URL="http://localhost:3443/setup"

echo "==> Tearing down the dev stack and removing its volumes…"
${COMPOSE} down -v

if [ "${1:-}" = "--build" ]; then
  echo "==> Rebuilding the stalwart image (entrypoint/Dockerfile changes)…"
  ${COMPOSE} build stalwart
fi

echo "==> Bringing the stack up (installer → app → stalwart → caddy)…"
${COMPOSE} up -d

echo "==> Waiting for the wizard at ${SETUP_URL} (the first run also re-installs node_modules)…"
ready=""
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null "${SETUP_URL}" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 3
done

echo
${COMPOSE} ps
echo
if [ -n "${ready}" ]; then
  echo "✅ Fresh bootstrap ready."
  echo "   Open  https://localhost:8443/setup   (Caddy, self-signed TLS)"
  echo "   or    ${SETUP_URL}   (app direct)"
else
  echo "⚠  The wizard did not answer within the timeout — check the logs:"
  echo "     ${COMPOSE} logs app stalwart installer"
  exit 1
fi
