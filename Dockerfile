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

# Caddy
RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v2.9.1/caddy_2.9.1_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin caddy \
    && chmod +x /usr/local/bin/caddy

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
ENV STALMAIL_SECRET=""

ENTRYPOINT ["/entrypoint.sh"]
