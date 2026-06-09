#!/usr/bin/env bash
# Minimal `curl` shim for the dev image (oven/bun ships no curl). It covers exactly
# what entrypoint.sh needs — `curl -sf <url>` for the Stalwart healthcheck — by using
# bun's built-in fetch. Last positional arg is the URL; exit 0 on a 2xx response, 1
# otherwise. Not a general-purpose curl.
url="${!#}"
exec bun -e 'try { const r = await fetch(process.argv[1]); process.exit(r.ok ? 0 : 1) } catch { process.exit(1) }' "$url"
