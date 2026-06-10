# App service — the Stalmail webmail + setup-wizard BFF (TanStack Start).
# Build with bun, run the built node server. No apt: the node base already has node.
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Install only production dependencies (drops vite, eslint, typescript, vitest, etc.).
# Re-use the bun package cache from the builder stage so no re-download is needed.
FROM oven/bun:1 AS prod-deps
WORKDIR /app
COPY --from=builder /root/.bun /root/.bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Create a non-root user matching Stalwart's uid/gid (2000:2000) so the app can
# write the restart sentinel to the /shared volume (owned by stalwart at 2000:2000).
RUN groupadd --gid 2000 stalmail \
  && useradd --uid 2000 --gid 2000 --no-create-home --shell /usr/sbin/nologin stalmail \
  && mkdir -p /shared && chown 2000:2000 /shared

# Copy only production node_modules — dev deps (vite, eslint, ts, vitest…) stay out.
COPY --from=prod-deps /app/node_modules /app/node_modules

# Copy the built artefacts.
COPY --from=builder /app/dist /app/dist

# Thin HTTP wrapper: adapts the Web-fetch handler exported by dist/server/server.js
# to a Node.js http.createServer listener on HOST:PORT.
COPY docker/app/server-start.mjs /app/server-start.mjs

USER stalmail
EXPOSE 3000
CMD ["node", "/app/server-start.mjs"]
