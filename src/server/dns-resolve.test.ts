import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveRecordStatus } from "./dns-resolve"

const resolveTxt = vi.fn()
const resolveMx = vi.fn()
const resolveSrv = vi.fn()
const resolveCaa = vi.fn()
const resolveCname = vi.fn()
const resolve4 = vi.fn()
const resolve6 = vi.fn()
vi.mock("node:dns/promises", () => ({
  resolveTxt: (...a: unknown[]) => resolveTxt(...a),
  resolveMx: (...a: unknown[]) => resolveMx(...a),
  resolveSrv: (...a: unknown[]) => resolveSrv(...a),
  resolveCaa: (...a: unknown[]) => resolveCaa(...a),
  resolveCname: (...a: unknown[]) => resolveCname(...a),
  resolve4: (...a: unknown[]) => resolve4(...a),
  resolve6: (...a: unknown[]) => resolve6(...a),
}))

beforeEach(() => vi.clearAllMocks())

describe("resolveRecordStatus", () => {
  it('returns "verified" when a TXT record matches the expected value', async () => {
    resolveTxt.mockResolvedValue([["v=spf1 mx -all"]])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "TXT",
      value: "v=spf1 mx -all",
    })
    expect(s).toBe("verified")
  })

  it('returns "mismatch" when a TXT record exists with a different value', async () => {
    resolveTxt.mockResolvedValue([["v=spf1 -all"]])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "TXT",
      value: "v=spf1 mx -all",
    })
    expect(s).toBe("mismatch")
  })

  it('returns "missing" when resolution finds nothing (NXDOMAIN/ENODATA)', async () => {
    resolveTxt.mockRejectedValue(
      Object.assign(new Error("not found"), { code: "ENOTFOUND" })
    )
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "TXT",
      value: "v=spf1 mx -all",
    })
    expect(s).toBe("missing")
  })

  it("verifies MX records by host and priority", async () => {
    resolveMx.mockResolvedValue([{ exchange: "mail.exemple.fr", priority: 10 }])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "MX",
      value: "10 mail.exemple.fr.",
    })
    expect(s).toBe("verified")
  })

  it("joins multi-chunk TXT before comparing", async () => {
    resolveTxt.mockResolvedValue([["v=spf1", " mx", " -all"]])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "TXT",
      value: "v=spf1 mx -all",
    })
    expect(s).toBe("verified")
  })

  it('returns "missing" when TXT resolves to an empty list', async () => {
    resolveTxt.mockResolvedValue([])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "TXT",
      value: "v=spf1 mx -all",
    })
    expect(s).toBe("missing")
  })

  it('treats ENODATA as "missing"', async () => {
    resolveTxt.mockRejectedValue(
      Object.assign(new Error("no data"), { code: "ENODATA" })
    )
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "TXT",
      value: "x",
    })
    expect(s).toBe("missing")
  })

  it("rethrows unexpected resolver errors (e.g. ETIMEDOUT)", async () => {
    resolveTxt.mockRejectedValue(
      Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
    )
    await expect(
      resolveRecordStatus({ name: "exemple.fr.", type: "TXT", value: "x" })
    ).rejects.toThrow(/timeout/i)
  })

  it('returns "mismatch" for an MX with a different host', async () => {
    resolveMx.mockResolvedValue([
      { exchange: "other.exemple.fr", priority: 10 },
    ])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "MX",
      value: "10 mail.exemple.fr.",
    })
    expect(s).toBe("mismatch")
  })

  it('returns "missing" for an MX with no records', async () => {
    resolveMx.mockResolvedValue([])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "MX",
      value: "10 mail.exemple.fr.",
    })
    expect(s).toBe("missing")
  })

  it('returns "unsupported" for record types other than the handled ones', async () => {
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "NS",
      value: "ns1.exemple.fr.",
    })
    expect(s).toBe("unsupported")
  })

  it("verifies MX even when the expected priority has a leading zero", async () => {
    resolveMx.mockResolvedValue([{ exchange: "mail.exemple.fr", priority: 10 }])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "MX",
      value: "010 mail.exemple.fr.",
    })
    expect(s).toBe("verified")
  })

  it("verifies an SRV record by priority/weight/port/target", async () => {
    resolveSrv.mockResolvedValue([
      { priority: 0, weight: 1, port: 993, name: "mail.exemple.fr" },
    ])
    const s = await resolveRecordStatus({
      name: "_imaps._tcp.exemple.fr.",
      type: "SRV",
      value: "0 1 993 mail.exemple.fr.",
    })
    expect(s).toBe("verified")
  })

  it('returns "mismatch" for an SRV with a different port', async () => {
    resolveSrv.mockResolvedValue([
      { priority: 0, weight: 1, port: 143, name: "mail.exemple.fr" },
    ])
    const s = await resolveRecordStatus({
      name: "_imaps._tcp.exemple.fr.",
      type: "SRV",
      value: "0 1 993 mail.exemple.fr.",
    })
    expect(s).toBe("mismatch")
  })

  it('returns "missing" for an SRV with no records', async () => {
    resolveSrv.mockResolvedValue([])
    const s = await resolveRecordStatus({
      name: "_imaps._tcp.exemple.fr.",
      type: "SRV",
      value: "0 1 993 mail.exemple.fr.",
    })
    expect(s).toBe("missing")
  })

  it("verifies a CAA issue record", async () => {
    resolveCaa.mockResolvedValue([{ critical: 0, issue: "letsencrypt.org" }])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "CAA",
      value: '0 issue "letsencrypt.org"',
    })
    expect(s).toBe("verified")
  })

  it('returns "mismatch" for a CAA with a different issuer', async () => {
    resolveCaa.mockResolvedValue([{ critical: 0, issue: "example-ca.org" }])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "CAA",
      value: '0 issue "letsencrypt.org"',
    })
    expect(s).toBe("mismatch")
  })

  it('returns "missing" for a CAA with no records', async () => {
    resolveCaa.mockResolvedValue([])
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "CAA",
      value: '0 issue "letsencrypt.org"',
    })
    expect(s).toBe("missing")
  })

  it('returns "unsupported" for an unparseable CAA rdata', async () => {
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "CAA",
      value: "garbage",
    })
    expect(s).toBe("unsupported")
  })

  it("verifies a CNAME when the target matches (ignoring trailing dot)", async () => {
    resolveCname.mockResolvedValue(["mail.exemple.fr"])
    const s = await resolveRecordStatus({
      name: "autoconfig.exemple.fr.",
      type: "CNAME",
      value: "mail.exemple.fr.",
    })
    expect(s).toBe("verified")
  })

  it("verifies a CNAME case-insensitively (RFC 4343)", async () => {
    resolveCname.mockResolvedValue(["Mail.Exemple.FR"])
    const s = await resolveRecordStatus({
      name: "autoconfig.exemple.fr.",
      type: "CNAME",
      value: "mail.exemple.fr.",
    })
    expect(s).toBe("verified")
  })

  it('returns "mismatch" for a CNAME pointing elsewhere', async () => {
    resolveCname.mockResolvedValue(["autre.exemple.fr"])
    const s = await resolveRecordStatus({
      name: "autoconfig.exemple.fr.",
      type: "CNAME",
      value: "mail.exemple.fr.",
    })
    expect(s).toBe("mismatch")
  })

  it('returns "missing" for a CNAME with no records', async () => {
    resolveCname.mockResolvedValue([])
    const s = await resolveRecordStatus({
      name: "autoconfig.exemple.fr.",
      type: "CNAME",
      value: "mail.exemple.fr.",
    })
    expect(s).toBe("missing")
  })

  it('returns "missing" when a CNAME lookup is NXDOMAIN/ENODATA', async () => {
    resolveCname.mockRejectedValue(
      Object.assign(new Error("not found"), { code: "ENODATA" })
    )
    const s = await resolveRecordStatus({
      name: "autoconfig.exemple.fr.",
      type: "CNAME",
      value: "mail.exemple.fr.",
    })
    expect(s).toBe("missing")
  })

  it('A: "verified" quand l\'IPv4 résolue correspond', async () => {
    resolve4.mockResolvedValue(["203.0.113.4"])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
    })
    expect(s).toBe("verified")
  })

  it('A: "mismatch" quand l\'IPv4 résolue diffère', async () => {
    resolve4.mockResolvedValue(["198.51.100.9"])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
    })
    expect(s).toBe("mismatch")
  })

  it('A: "missing" quand aucune IPv4 ne résout', async () => {
    resolve4.mockResolvedValue([])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
    })
    expect(s).toBe("missing")
  })

  it('A: "missing" sur ENOTFOUND', async () => {
    resolve4.mockRejectedValue(
      Object.assign(new Error("nf"), { code: "ENOTFOUND" })
    )
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
    })
    expect(s).toBe("missing")
  })

  it('AAAA: "verified" en comparant insensible à la casse', async () => {
    resolve6.mockResolvedValue(["2001:db8::1"])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "AAAA",
      value: "2001:DB8::1",
    })
    expect(s).toBe("verified")
  })

  it('AAAA: "mismatch" quand l\'IPv6 diffère', async () => {
    resolve6.mockResolvedValue(["2001:db8::2"])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "AAAA",
      value: "2001:db8::1",
    })
    expect(s).toBe("mismatch")
  })
})
