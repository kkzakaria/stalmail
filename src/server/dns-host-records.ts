// Construit les A/AAAA attendus à partir de la ZONE publiée par Stalwart (cibles MX/SRV/
// CNAME = serveur mail) + apex + hostname public, étiquetés par rôle. Pur, testé. La valeur
// (l'IP) vient de l'écho, pas de Stalwart (qui ne publie jamais A/AAAA) — d'où ce module.
import type { ZoneRecord } from "./dns-zone"

export type HostRole = "mail" | "apex" | "webmail"
export interface HostRecord {
  name: string
  type: string
  value: string
  role: HostRole
}

const normName = (h: string) => h.trim().toLowerCase().replace(/\.$/, "")

// Hôtes que la zone fait pointer vers le serveur (cibles MX/SRV/CNAME). En pratique
// l'hôte unique du serveur mail. Dédupliqué, normalisé.
export function collectHostTargets(zoneRecords: ZoneRecord[]): string[] {
  const out: string[] = []
  for (const r of zoneRecords) {
    let target = ""
    if (r.type === "MX" || r.type === "SRV") {
      const parts = r.value.trim().split(/\s+/)
      target = parts[parts.length - 1] ?? ""
    } else if (r.type === "CNAME") {
      target = r.value
    } else {
      continue
    }
    const n = normName(target)
    // Valid hostname must contain at least one dot (FQDN)
    if (n && n.includes(".") && !out.includes(n)) out.push(n)
  }
  return out
}

export function buildHostRecords(input: {
  zoneRecords?: ZoneRecord[]
  hostname: string
  domain: string
  ipv4: string | null
  ipv6: string | null
}): HostRecord[] {
  const { ipv4, ipv6 } = input
  const zoneRecords = input.zoneRecords ?? []
  const seen = new Set<string>()
  const named: { name: string; role: HostRole }[] = []
  const add = (raw: string, role: HostRole) => {
    const n = normName(raw)
    if (!n || seen.has(n)) return
    seen.add(n)
    named.push({ name: n, role })
  }

  // 1) Serveur mail : les hôtes que la zone pointe déjà (cible MX, confirmée par SRV/CNAME).
  for (const t of collectHostTargets(zoneRecords)) add(t, "mail")
  // 2) Apex (accès web), s'il n'est pas déjà un hôte mail.
  add(input.domain, "apex")
  // 3) Webmail (hôte de PUBLIC_URL), s'il est distinct.
  add(input.hostname, "webmail")

  const records: HostRecord[] = []
  for (const { name, role } of named) {
    if (ipv4) records.push({ name: name + ".", type: "A", value: ipv4, role })
    if (ipv6)
      records.push({ name: name + ".", type: "AAAA", value: ipv6, role })
  }
  return records
}
