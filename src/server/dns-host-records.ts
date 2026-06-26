// Construit les A/AAAA attendus (hostname + apex) à partir de l'IP découverte. Pur, testé.
// La valeur de ces enregistrements ne vient PAS de Stalwart (qui ne publie jamais A/AAAA)
// mais de l'écho IP — d'où ce module dédié, parallèle à parseZoneFile.
import type { ZoneRecord } from "./dns-zone"

const normName = (h: string) => h.trim().toLowerCase().replace(/\.$/, "")

export function buildHostRecords(input: {
  hostname: string
  domain: string
  ipv4: string | null
  ipv6: string | null
}): ZoneRecord[] {
  const { ipv4, ipv6 } = input
  const host = normName(input.hostname)
  const base = normName(input.domain)
  const names: string[] = []
  if (host) names.push(host)
  if (base && base !== host) names.push(base)

  const records: ZoneRecord[] = []
  for (const n of names) {
    if (ipv4) records.push({ name: n + ".", type: "A", value: ipv4 })
    if (ipv6) records.push({ name: n + ".", type: "AAAA", value: ipv6 })
  }
  return records
}
