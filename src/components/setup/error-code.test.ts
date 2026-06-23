import { describe, it, expect } from "vitest"
import { codeFromError, messageKeyForCode } from "./error-code"

describe("error-code", () => {
  describe("codeFromError", () => {
    it("extracts SETUP-* code from error message", () => {
      const error = new Error("SETUP-DNS-REJECTED")
      expect(codeFromError(error)).toBe("SETUP-DNS-REJECTED")
    })

    it("returns SETUP-UNKNOWN for non-SETUP errors", () => {
      const error = new Error("some other error")
      expect(codeFromError(error)).toBe("SETUP-UNKNOWN")
    })

    it("returns SETUP-UNKNOWN for non-Error objects", () => {
      expect(codeFromError("random string")).toBe("SETUP-UNKNOWN")
      expect(codeFromError(null)).toBe("SETUP-UNKNOWN")
    })
  })

  describe("messageKeyForCode", () => {
    const knownCodes = [
      "SETUP-RESTART-TIMEOUT",
      "SETUP-DNS-REJECTED",
      "SETUP-DNS-MANAGEMENT-REJECTED",
      "SETUP-ACCOUNT-WEAK",
      "SETUP-ACCOUNT-REJECTED",
      "SETUP-SSL-REJECTED",
      "SETUP-FORBIDDEN",
      "SETUP-UNKNOWN",
      "SETUP-UNAUTHENTICATED",
      "SETUP-UNLOCK-FAILED",
    ]

    it.each(knownCodes)("maps %s to wizard.error.codes.%s", (code) => {
      expect(messageKeyForCode(code)).toBe(`wizard.error.codes.${code}`)
    })

    it("falls back to wizard.error.generic for unknown codes", () => {
      expect(messageKeyForCode("SETUP-UNKNOWN-CODE")).toBe(
        "wizard.error.generic"
      )
    })
  })
})
