import { describe, it, expect } from "vitest"
import { isIpv4, isIpv6 } from "./ip"

describe("isIpv4", () => {
  it("accepte une IPv4 valide", () => expect(isIpv4("203.0.113.4")).toBe(true))
  it("rejette un octet > 255", () => expect(isIpv4("256.0.0.1")).toBe(false))
  it("rejette une chaîne non IPv4", () => expect(isIpv4("hello")).toBe(false))
  it("rejette une IPv6 comme IPv4", () =>
    expect(isIpv4("2001:db8::1")).toBe(false))
})

describe("isIpv6", () => {
  it("accepte une IPv6 compressée", () =>
    expect(isIpv6("2001:db8::1")).toBe(true))
  it("accepte une IPv6 pleine", () =>
    expect(isIpv6("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(true))
  it("rejette une IPv4 comme IPv6", () =>
    expect(isIpv6("203.0.113.4")).toBe(false))
  it("rejette du bruit", () => expect(isIpv6("nope")).toBe(false))
})
