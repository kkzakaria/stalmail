# ── Stage 1 : build de l'app ──────────────────────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ── Stage 2 : image de production ─────────────────────────────────
FROM debian:bookworm-slim AS runner

# Dépendances système
# libcap2-bin : setcap pour lier les ports < 1024 sans root
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libcap2-bin \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 (binaire depuis l'image officielle — pas de curl|bash)
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node

# Caddy et Stalwart (binaires depuis leurs images officielles)
COPY --from=caddy:2.9.1 /usr/bin/caddy /usr/local/bin/caddy
COPY --from=stalwartlabs/stalwart:v0.16 /usr/local/bin/stalwart /usr/local/bin/stalwart

# App buildée
COPY --from=builder /app/.output /app

# Config
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /entrypoint.sh

# Utilisateur non-root + capabilities réseau pour les ports < 1024
RUN useradd -r -u 1001 -s /sbin/nologin -d /app stalmail \
    && setcap cap_net_bind_service=+ep /usr/local/bin/caddy \
    && setcap cap_net_bind_service=+ep /usr/local/bin/stalwart \
    && mkdir -p /etc/stalwart /var/lib/stalwart \
    && chown -R stalmail:stalmail /etc/stalwart /var/lib/stalwart /app /etc/caddy \
    && chmod +x /entrypoint.sh \
    && chown stalmail:stalmail /entrypoint.sh

VOLUME /etc/stalwart
VOLUME /var/lib/stalwart

EXPOSE 443 80 25 587 465 993 143

ENV NODE_ENV=production
# STALMAIL_SECRET doit être fourni au runtime via -e — le container refuse de démarrer sans lui

USER stalmail
ENTRYPOINT ["/entrypoint.sh"]
