import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { parseEchoResponse, discoverServerIp } from "./server-ip"

describe("parseEchoResponse", () => {
  it("extrait une IPv4 nue (ipify)", () =>
    expect(parseEchoResponse("203.0.113.4", 4)).toBe("203.0.113.4"))
  it("extrait une IPv4 d'une ligne trace 'ip=' (Cloudflare)", () =>
    expect(parseEchoResponse("fl=1\nip=203.0.113.4\nts=…", 4)).toBe(
      "203.0.113.4"
    ))
  it("extrait et minuscule une IPv6", () =>
    expect(parseEchoResponse("2001:DB8::1", 6)).toBe("2001:db8::1"))
  it("renvoie null si aucune IP de la famille demandée", () =>
    expect(parseEchoResponse("203.0.113.4", 6)).toBeNull())
  it("renvoie null sur du bruit", () =>
    expect(parseEchoResponse("error: blocked", 4)).toBeNull())
})

describe("discoverServerIp", () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it("renvoie ipv4 et ipv6 quand les deux échos répondent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(url.includes("api6") ? "2001:db8::1" : "203.0.113.4")
      )
    )
    expect(await discoverServerIp()).toEqual({
      ipv4: "203.0.113.4",
      ipv6: "2001:db8::1",
    })
  })

  it("renvoie {null,null} quand l'écho échoue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down")
      })
    )
    expect(await discoverServerIp()).toEqual({ ipv4: null, ipv6: null })
  })

  it("renvoie null pour une réponse HTTP non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    )
    expect(await discoverServerIp()).toEqual({ ipv4: null, ipv6: null })
  })
})
