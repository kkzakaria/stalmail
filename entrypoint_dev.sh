#!/bin/bash
# Dev entrypoint — runs the EXACT same orchestration as the production entrypoint.sh
# (Stalwart supervised + restart-sentinel handling + Caddy + healthcheck + clean
# shutdown), but launches the Vite dev server (HMR) instead of the built bundle.
#
# It does this by `exec`-ing entrypoint.sh itself (not copying it), so development
# continuously exercises the production orchestration path: any breakage in
# supervision, the bootstrap→normal restart, or shutdown surfaces here, in dev.
set -euo pipefail

# entrypoint.sh requires STALMAIL_SECRET; provide an insecure default for dev only.
export STALMAIL_SECRET="${STALMAIL_SECRET:-dev-insecure-secret}"

# Run the dev server instead of `node /app/server/server.js`. entrypoint.sh launches
# ${APP_CMD} as the app process (word-split intentionally), inheriting STALWART_URL /
# STALWART_RECOVERY_ADMIN / STALMAIL_RUN_DIR so the BFF can reach Stalwart.
#
# --host makes Vite bind 0.0.0.0 instead of its default [::1]-only: Caddy reverse-proxies
# to 127.0.0.1:3000, and a [::1]-only Vite would refuse that (IPv6/loopback mismatch → 502).
export APP_CMD="${APP_CMD:-bun run dev --host}"

# The repo is bind-mounted at /app; install deps into the container's node_modules
# volume (bun-native, shadowing the host's) before handing off to the orchestrator.
echo "[stalmail-dev] bun install (mounted source)..."
bun install

echo "[stalmail-dev] handing off to entrypoint.sh (APP_CMD=${APP_CMD})"
exec /entrypoint.sh
