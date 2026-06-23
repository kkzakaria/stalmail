import { describe, it, expect } from "vitest"
import { SetupError, toSetupErrorCode } from "./setup-errors"

describe("toSetupErrorCode", () => {
  it("returns the code of a SetupError directly", () => {
    const err = new SetupError("SETUP-DNS-REJECTED")
    expect(toSetupErrorCode(err, "SETUP-UNKNOWN")).toBe("SETUP-DNS-REJECTED")
  })

  it("maps WeakPasswordError by name to SETUP-ACCOUNT-WEAK", () => {
    const err = Object.assign(new Error("too weak"), {
      name: "WeakPasswordError",
    })
    expect(toSetupErrorCode(err, "SETUP-UNKNOWN")).toBe("SETUP-ACCOUNT-WEAK")
  })

  it('maps message "dns server creation rejected" to SETUP-DNS-REJECTED', () => {
    const err = new Error("dns server creation rejected")
    expect(toSetupErrorCode(err, "SETUP-UNKNOWN")).toBe("SETUP-DNS-REJECTED")
  })

  it("maps message matching dnsManagement.*rejected to SETUP-DNS-MANAGEMENT-REJECTED", () => {
    const err = new Error("dnsManagement operation rejected")
    expect(toSetupErrorCode(err, "SETUP-UNKNOWN")).toBe(
      "SETUP-DNS-MANAGEMENT-REJECTED"
    )
  })

  it("returns the fallback for unknown errors", () => {
    const err = new Error("some random error")
    expect(toSetupErrorCode(err, "SETUP-ACCOUNT-REJECTED")).toBe(
      "SETUP-ACCOUNT-REJECTED"
    )
  })

  it("returns the fallback for null/undefined", () => {
    expect(toSetupErrorCode(null, "SETUP-UNKNOWN")).toBe("SETUP-UNKNOWN")
    expect(toSetupErrorCode(undefined, "SETUP-UNKNOWN")).toBe("SETUP-UNKNOWN")
  })

  it("SetupError has correct name and message", () => {
    const err = new SetupError("SETUP-SSL-REJECTED")
    expect(err.name).toBe("SetupError")
    expect(err.message).toBe("SETUP-SSL-REJECTED")
    expect(err.code).toBe("SETUP-SSL-REJECTED")
  })
})

describe("SETUP_CODES bootstrap-auth codes", () => {
  it("SETUP-UNAUTHENTICATED is a valid SetupError code", () => {
    const err = new SetupError("SETUP-UNAUTHENTICATED")
    expect(err.code).toBe("SETUP-UNAUTHENTICATED")
  })

  it("SETUP-UNLOCK-FAILED is a valid SetupError code", () => {
    const err = new SetupError("SETUP-UNLOCK-FAILED")
    expect(err.code).toBe("SETUP-UNLOCK-FAILED")
  })
})
