import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { createHash } from "node:crypto"

// --- Mocks --------------------------------------------------------------
// In-memory cookie jar to simulate getCookie/setCookie/deleteCookie.
const jar = new Map<string, string>()
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: vi.fn((name: string) => jar.get(name)),
  setCookie: vi.fn((name: string, value: string) => {
    jar.set(name, value)
  }),
  deleteCookie: vi.fn((name: string) => {
    jar.delete(name)
  }),
  getRequestHeader: vi.fn(),
}))

// session-crypto: a *real-ish* reversible transform that also enforces the AAD,
// so tampering / wrong-aad surfaces as a throw (mirrors AES-GCM auth failure).
vi.mock("./session-crypto", () => ({
  encryptToken: vi.fn(
    (plaintext: string, aad: string) => `enc:${aad}:${plaintext}`
  ),
  decryptToken: vi.fn((payload: string, aad: string) => {
    const prefix = `enc:${aad}:`
    if (!payload.startsWith(prefix)) throw new Error("auth failure")
    return payload.slice(prefix.length)
  }),
}))

vi.mock("./session-cookie", () => ({
  assertSameOriginStrict: vi.fn(),
  clientIp: vi.fn(() => "203.0.113.7"),
}))

vi.mock("./setup-flag", () => ({
  isSetupComplete: vi.fn(() => false),
}))

// eslint-disable-next-line import/first
import { setCookie } from "@tanstack/react-start/server"
// eslint-disable-next-line import/first
import { assertSameOriginStrict, clientIp } from "./session-cookie"
// eslint-disable-next-line import/first
import { isSetupComplete } from "./setup-flag"
// eslint-disable-next-line import/first
import {
  issueSetupCookie,
  isSetupAuthed,
  requireSetupAuth,
  clearSetupCookie,
  unlockSetup,
  __resetSetupRateLimitForTest,
} from "./setup-auth"
// eslint-disable-next-line import/first
import { SetupError } from "./setup-errors"

const COOKIE_NAME = "stalmail_setup" // NODE_ENV is not "production" under vitest

const SECRET_TOKEN = "correct horse battery staple"
const TOKEN_HASH = createHash("sha256").update(SECRET_TOKEN).digest("hex")

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  jar.clear()
  __resetSetupRateLimitForTest()
  vi.clearAllMocks()
  vi.mocked(clientIp).mockReturnValue("203.0.113.7")
  vi.mocked(isSetupComplete).mockReturnValue(false)
  process.env.STALMAIL_SETUP_TOKEN_HASH = TOKEN_HASH
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
  delete process.env.STALMAIL_SETUP_TOKEN_HASH
})

describe("issueSetupCookie / isSetupAuthed", () => {
  it("issues a cookie that authenticates", () => {
    issueSetupCookie()
    expect(isSetupAuthed()).toBe(true)
  })

  it("sets correct cookie attributes (httpOnly, sameSite lax, path /, maxAge 3600)", () => {
    issueSetupCookie()
    const call = vi.mocked(setCookie).mock.calls.at(-1)!
    expect(call[0]).toBe(COOKIE_NAME)
    expect(call[2]).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    })
  })

  it("rejects a cookie older than one hour (forced old timestamp)", () => {
    const old = Date.now() - 3_600_001
    jar.set(COOKIE_NAME, `enc:stalmail-setup:${old}`)
    expect(isSetupAuthed()).toBe(false)
  })

  it("accepts a cookie just under one hour old", () => {
    const recent = Date.now() - 3_599_000
    jar.set(COOKIE_NAME, `enc:stalmail-setup:${recent}`)
    expect(isSetupAuthed()).toBe(true)
  })

  it("returns false when no cookie present", () => {
    expect(isSetupAuthed()).toBe(false)
  })

  it("returns false on garbage / tampered cookie (decrypt throws)", () => {
    jar.set(COOKIE_NAME, "not-a-valid-ciphertext")
    expect(isSetupAuthed()).toBe(false)
  })

  it("returns false on cookie with wrong aad (decrypt throws)", () => {
    jar.set(COOKIE_NAME, `enc:wrong-aad:${Date.now()}`)
    expect(isSetupAuthed()).toBe(false)
  })

  it("returns false on non-numeric timestamp payload", () => {
    jar.set(COOKIE_NAME, `enc:stalmail-setup:not-a-number`)
    expect(isSetupAuthed()).toBe(false)
  })

  it("returns false when issuedAt is in the future (negative age)", () => {
    const future = Date.now() + 60_000 // 1 minute in the future
    jar.set(COOKIE_NAME, `enc:stalmail-setup:${future}`)
    expect(isSetupAuthed()).toBe(false)
  })
})

describe("requireSetupAuth", () => {
  it("throws SETUP-UNAUTHENTICATED without a cookie", () => {
    expect(() => requireSetupAuth()).toThrowError(
      expect.objectContaining({ code: "SETUP-UNAUTHENTICATED" })
    )
  })

  it("does not throw with a valid cookie", () => {
    issueSetupCookie()
    expect(() => requireSetupAuth()).not.toThrow()
  })
})

describe("clearSetupCookie", () => {
  it("clears the cookie so isSetupAuthed is false", () => {
    issueSetupCookie()
    expect(isSetupAuthed()).toBe(true)
    clearSetupCookie()
    expect(isSetupAuthed()).toBe(false)
  })
})

describe("unlockSetup", () => {
  it("issues a cookie on the correct token", () => {
    unlockSetup(SECRET_TOKEN)
    expect(isSetupAuthed()).toBe(true)
    expect(assertSameOriginStrict).toHaveBeenCalled()
  })

  it("rejects a wrong token with the generic SETUP-UNLOCK-FAILED", () => {
    expect(() => unlockSetup("wrong token")).toThrowError(
      expect.objectContaining({ code: "SETUP-UNLOCK-FAILED" })
    )
    expect(isSetupAuthed()).toBe(false)
  })

  it("rejects (generic, no oracle) when setup already complete — even with the correct token", () => {
    vi.mocked(isSetupComplete).mockReturnValue(true)
    expect(() => unlockSetup(SECRET_TOKEN)).toThrowError(
      expect.objectContaining({ code: "SETUP-UNLOCK-FAILED" })
    )
    expect(isSetupAuthed()).toBe(false)
  })

  it("rejects with SETUP-UNLOCK-FAILED when env hash is missing", () => {
    delete process.env.STALMAIL_SETUP_TOKEN_HASH
    expect(() => unlockSetup(SECRET_TOKEN)).toThrowError(
      expect.objectContaining({ code: "SETUP-UNLOCK-FAILED" })
    )
  })

  it("rejects with SETUP-UNLOCK-FAILED when env hash is malformed (not hex / wrong length)", () => {
    process.env.STALMAIL_SETUP_TOKEN_HASH = "zzzz"
    expect(() => unlockSetup(SECRET_TOKEN)).toThrowError(
      expect.objectContaining({ code: "SETUP-UNLOCK-FAILED" })
    )
  })

  it("rejects with SETUP-UNLOCK-FAILED once the per-IP rate-limit is exceeded", () => {
    // Burn through the allowed attempts with wrong tokens.
    for (let i = 0; i < 10; i++) {
      expect(() => unlockSetup("wrong")).toThrow(SetupError)
    }
    // Next attempt — even with the CORRECT token — must be rate-limited (generic).
    expect(() => unlockSetup(SECRET_TOKEN)).toThrowError(
      expect.objectContaining({ code: "SETUP-UNLOCK-FAILED" })
    )
    expect(isSetupAuthed()).toBe(false)
  })

  it("consumes a rate-limit slot before checking isSetupComplete (limit counts attempts)", () => {
    vi.mocked(isSetupComplete).mockReturnValue(true)
    // Each call must consume a slot even though it bails on isSetupComplete.
    for (let i = 0; i < 10; i++) {
      expect(() => unlockSetup(SECRET_TOKEN)).toThrow(SetupError)
    }
    // Now restore; the limiter should already be exhausted.
    vi.mocked(isSetupComplete).mockReturnValue(false)
    expect(() => unlockSetup(SECRET_TOKEN)).toThrowError(
      expect.objectContaining({ code: "SETUP-UNLOCK-FAILED" })
    )
  })

  it("NEVER logs the token value", () => {
    try {
      unlockSetup(SECRET_TOKEN)
    } catch {
      /* ignore */
    }
    try {
      unlockSetup("a-bad-secret-token")
    } catch {
      /* ignore */
    }
    const logged = JSON.stringify(warnSpy.mock.calls)
    expect(logged).not.toContain(SECRET_TOKEN)
    expect(logged).not.toContain("a-bad-secret-token")
    expect(warnSpy).toHaveBeenCalled()
  })
})
