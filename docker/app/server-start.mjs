/**
 * Thin Node.js HTTP adapter for the TanStack Start SSR server.
 *
 * `dist/server/server.js` exports a Web-standard fetch handler
 * (`default.fetch(request) → Response`). This file wraps it in a
 * `node:http` server that listens on HOST:PORT (defaulting to
 * 0.0.0.0:3000) so the Caddy reverse-proxy can reach it
 * cross-container.
 *
 * It ALSO serves the built client assets from `dist/client/` (JS, CSS,
 * fonts, favicon…). The SSR handler does NOT serve them, so without this
 * a request for `/assets/foo.js` falls through to the SSR catch-all and
 * comes back as `text/html` — browsers then block the module for a bad
 * MIME type and the page renders unstyled / non-interactive.
 */

import http from "node:http"
import { Readable } from "node:stream"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join, normalize, extname } from "node:path"

const { default: app } = await import("/app/dist/server/server.js")

const host = process.env.HOST ?? "0.0.0.0"
const port = parseInt(process.env.PORT ?? "3000", 10)

// Built client assets live here; served as static files, never via the SSR handler.
const CLIENT_DIR = process.env.STALMAIL_CLIENT_DIR ?? "/app/dist/client"

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
}

// Serve a built client asset if the request maps to an existing file under
// CLIENT_DIR. Returns true if it handled the response, false to fall through
// to the SSR handler.
async function tryServeStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false
  let pathname
  try {
    pathname = decodeURIComponent((req.url ?? "/").split("?")[0])
  } catch {
    return false
  }
  // Directory roots are SSR-rendered (no index.html in dist/client).
  if (pathname === "/" || pathname.endsWith("/")) return false

  // Resolve within CLIENT_DIR and reject any path traversal escape.
  const filePath = normalize(join(CLIENT_DIR, pathname))
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + "/")) return false

  let st
  try {
    st = await stat(filePath)
  } catch {
    return false
  }
  if (!st.isFile()) return false

  const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream"
  res.statusCode = 200
  res.setHeader("content-type", type)
  res.setHeader("content-length", st.size)
  // Content-hashed bundles under /assets/* are immutable; other static files
  // (favicon, robots, manifest) get a short cache.
  res.setHeader(
    "cache-control",
    pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",
  )
  if (req.method === "HEAD") {
    res.end()
    return true
  }
  const stream = createReadStream(filePath)
  stream.on("error", () => res.destroy())
  stream.pipe(res)
  return true
}

const server = http.createServer(async (req, res) => {
  try {
    // 1. Static client assets (JS/CSS/fonts) — must win over the SSR catch-all.
    if (await tryServeStatic(req, res)) return

    // 2. Everything else → the TanStack Start SSR fetch handler.
    const proto = req.headers["x-forwarded-proto"] ?? "http"
    const host_ = req.headers.host ?? `${host}:${port}`
    const url = `${proto}://${host_}${req.url}`

    // Stream the request body through instead of buffering it into memory:
    // Buffer.concat-ing a large upload (e.g. an email attachment) could OOM the
    // container. Readable.toWeb yields a Web ReadableStream; duplex:"half" is required
    // when a Request carries a stream body.
    const hasBody = req.method !== "GET" && req.method !== "HEAD"
    const webReq = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      // @ts-ignore — Node.js 18+ supports duplex on Request
      duplex: "half",
    })

    const webRes = await app.fetch(webReq)

    res.statusCode = webRes.status
    // Headers.forEach collapses multiple Set-Cookie into one comma-joined value, which
    // corrupts cookies (commas inside Expires, several cookies merged). Emit them as an
    // array via getSetCookie() and copy the rest normally.
    const setCookies = webRes.headers.getSetCookie?.() ?? []
    webRes.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value)
    })
    if (setCookies.length) res.setHeader('set-cookie', setCookies)

    if (webRes.body) {
      Readable.fromWeb(webRes.body).pipe(res)
    } else {
      res.end()
    }
  } catch (err) {
    console.error("[server-start] unhandled error:", err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.end("Internal Server Error")
    }
  }
})

server.listen(port, host, () => {
  console.log(`[stalmail] app server listening on ${host}:${port}`)
})
