import { describe, it, expect } from "vitest"
import { isExternalHost, hostZone } from "./host-utils"

describe("isExternalHost", () => {
  it("returns false when hostname or domain is empty", () => {
    expect(isExternalHost("", "exemple.fr")).toBe(false)
    expect(isExternalHost("mail.exemple.fr", "")).toBe(false)
  })

  it("returns false when the host equals the domain", () => {
    expect(isExternalHost("exemple.fr", "exemple.fr")).toBe(false)
  })

  it("returns false when the host is a sub-domain of the domain", () => {
    expect(isExternalHost("mail.exemple.fr", "exemple.fr")).toBe(false)
  })

  it("returns true when the host is outside the domain's zone", () => {
    expect(isExternalHost("mail.autre.fr", "exemple.fr")).toBe(true)
  })

  it("is case-insensitive", () => {
    expect(isExternalHost("MAIL.Exemple.FR", "exemple.fr")).toBe(false)
  })

  it("handles trailing dots (FQDN root) in hostname", () => {
    expect(isExternalHost("mail.exemple.fr.", "exemple.fr")).toBe(false)
  })

  it("handles trailing dots in domain", () => {
    expect(isExternalHost("mail.exemple.fr", "exemple.fr.")).toBe(false)
  })

  it("handles whitespace-padded input", () => {
    expect(isExternalHost(" mail.exemple.fr ", "exemple.fr")).toBe(false)
    expect(isExternalHost("mail.exemple.fr", " exemple.fr ")).toBe(false)
  })
})

describe("hostZone", () => {
  it("strips the leftmost label for a 3+ label sub-domain", () => {
    expect(hostZone("mail.exemple.fr")).toBe("exemple.fr")
  })

  it("returns the hostname unchanged for a 2-label apex", () => {
    expect(hostZone("exemple.fr")).toBe("exemple.fr")
  })

  it("returns the input unchanged when empty", () => {
    expect(hostZone("")).toBe("")
  })

  it("strips trailing dot (FQDN root)", () => {
    expect(hostZone("mail.exemple.fr.")).toBe("exemple.fr")
  })

  it("handles whitespace-padded input", () => {
    expect(hostZone(" mail.exemple.fr ")).toBe("exemple.fr")
  })

  it("handles mixed case and spaces", () => {
    expect(hostZone(" SUB.exemple.fr ")).toBe("exemple.fr")
  })
})
