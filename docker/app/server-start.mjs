/**
 * Thin Node.js HTTP adapter for the TanStack Start SSR server.
 *
 * `dist/server/server.js` exports a Web-standard fetch handler
 * (`default.fetch(request) → Response`). This file wraps it in a
 * `node:http` server that listens on HOST:PORT (defaulting to
 * 0.0.0.0:3000) so the Caddy reverse-proxy can reach it
 * cross-container.
 */

import http from "node:http"
import { Readable } from "node:stream"

const { default: app } = await import("/app/dist/server/server.js")

const host = process.env.HOST ?? "0.0.0.0"
const port = parseInt(process.env.PORT ?? "3000", 10)

const server = http.createServer(async (req, res) => {
  try {
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
