# App service — the Stalmail webmail + setup-wizard BFF (TanStack Start).
# Build with bun, run the built node server. No apt: the node base already has node.
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# The Vite SSR build externalises node_modules (bare imports like "react" remain).
# Copy only production dependencies from the builder stage.
COPY --from=builder /app/node_modules /app/node_modules

# Copy the built artefacts.
COPY --from=builder /app/dist /app/dist

# Thin HTTP wrapper: adapts the Web-fetch handler exported by dist/server/server.js
# to a Node.js http.createServer listener on HOST:PORT.
COPY docker/app/server-start.mjs /app/server-start.mjs

EXPOSE 3000
CMD ["node", "/app/server-start.mjs"]
