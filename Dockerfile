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
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Caddy (binaire depuis l'image officielle, même pattern que Stalwart)
COPY --from=caddy:2.9.1 /usr/bin/caddy /usr/local/bin/caddy

# Stalwart (binaire depuis l'image officielle)
COPY --from=stalwartlabs/stalwart:v0.16 /usr/local/bin/stalwart /usr/local/bin/stalwart

# App buildée
COPY --from=builder /app/.output /app

# Config
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /etc/stalwart
VOLUME /var/lib/stalwart

EXPOSE 443 80 25 587 465 993 143

ENV NODE_ENV=production
# STALMAIL_SECRET doit être fourni au runtime via -e — le container refuse de démarrer sans lui

ENTRYPOINT ["/entrypoint.sh"]
