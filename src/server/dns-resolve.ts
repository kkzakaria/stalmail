import {
  resolveTxt,
  resolveMx,
  resolveSrv,
  resolveCaa,
  resolveCname,
  resolve4,
  resolve6,
} from "node:dns/promises"
import type { ZoneRecord } from "./dns-zone"

export type RecordStatus = "verified" | "mismatch" | "missing" | "unsupported"

// Normalise un nom DNS pour comparaison : retire le point final ET replie la casse.
// Les noms DNS sont insensibles à la casse (RFC 4343) ; un resolver peut renvoyer une
// casse différente de la zone. Les deux côtés des comparaisons MX/SRV/CNAME passent par
// ici, donc la normalisation reste cohérente.
const stripDot = (s: string) => s.replace(/\.$/, "").toLowerCase()
const norm = (s: string) => s.trim().replace(/\s+/g, " ")

export async function resolveRecordStatus(
  record: ZoneRecord
): Promise<RecordStatus> {
  const host = stripDot(record.name)
  try {
    if (record.type === "TXT") {
      const chunks = await resolveTxt(host)
      const values = chunks.map((parts) => parts.join(""))
      if (values.some((v) => norm(v) === norm(record.value))) return "verified"
      return values.length ? "mismatch" : "missing"
    }
    if (record.type === "MX") {
      const [prio, exchange] = record.value.split(/\s+/)
      const mx = await resolveMx(host)
      const found = mx.some(
        (r) =>
          stripDot(r.exchange) === stripDot(exchange) &&
          Number(r.priority) === Number(prio)
      )
      return found ? "verified" : mx.length ? "mismatch" : "missing"
    }
    if (record.type === "SRV") {
      // zone rdata: "<priority> <weight> <port> <target>"
      const [prio, weight, port, target] = record.value.split(/\s+/)
      const srv = await resolveSrv(host)
      const found = srv.some(
        (r) =>
          Number(r.priority) === Number(prio) &&
          Number(r.weight) === Number(weight) &&
          Number(r.port) === Number(port) &&
          stripDot(r.name) === stripDot(target)
      )
      return found ? "verified" : srv.length ? "mismatch" : "missing"
    }
    if (record.type === "CNAME") {
      // zone rdata: the canonical target, e.g. "mail.exemple.fr.". resolveCname
      // returns the canonical names; compare ignoring the trailing dot.
      const target = stripDot(record.value)
      const cnames = await resolveCname(host)
      const found = cnames.some((c) => stripDot(c) === target)
      return found ? "verified" : cnames.length ? "mismatch" : "missing"
    }
    if (record.type === "CAA") {
      // zone rdata: '<flags> <tag> "<value>"' e.g. '0 issue "letsencrypt.org"'
      const m = record.value.match(/^\d+\s+(\w+)\s+"?([^"]*)"?\s*$/)
      if (!m) return "unsupported"
      const [, tag, value] = m
      const caa = await resolveCaa(host)
      const found = caa.some(
        (r) => (r as unknown as Record<string, unknown>)[tag] === value
      )
      return found ? "verified" : caa.length ? "mismatch" : "missing"
    }
    if (record.type === "A" || record.type === "AAAA") {
      // Valeur attendue = l'IP fournie par l'écho (pas issue du dnsZoneFile).
      const want = record.value.trim().toLowerCase()
      const addrs =
        record.type === "A" ? await resolve4(host) : await resolve6(host)
      const resolved = addrs.map((a) => a.trim().toLowerCase())
      if (resolved.includes(want)) return "verified"
      return resolved.length ? "mismatch" : "missing"
    }
    return "unsupported"
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === "ENOTFOUND" || code === "ENODATA") return "missing"
    throw e
  }
}
