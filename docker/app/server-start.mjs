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

    // Buffer the request body.
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : Buffer.concat(chunks)

    const webReq = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: body?.length ? body : undefined,
      // @ts-ignore — Node.js 18+ supports this
      duplex: "half",
    })

    const webRes = await app.fetch(webReq)

    res.statusCode = webRes.status
    webRes.headers.forEach((value, key) => res.setHeader(key, value))

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
