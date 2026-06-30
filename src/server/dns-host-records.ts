// Construit les A/AAAA attendus à partir de la ZONE publiée par Stalwart (cibles MX/SRV
// = serveur mail) + apex + hostname public, étiquetés par rôle. Pur, testé. La valeur
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

// Hôtes que la zone désigne comme serveur mail (cibles MX/SRV). En pratique
// l'hôte unique du serveur mail. Dédupliqué, normalisé.
// Les CNAMEs sont des alias pointant vers ce même hôte — ils ne sont pas une source
// authoritative de l'hôte mail et sont donc ignorés.
export function collectHostTargets(zoneRecords: ZoneRecord[]): string[] {
  const seen = new Set<string>()
  for (const r of zoneRecords) {
    let target = ""
    if (r.type === "MX" || r.type === "SRV") {
      const parts = r.value.trim().split(/\s+/)
      target = parts[parts.length - 1] ?? ""
    } else {
      continue
    }
    const n = normName(target)
    // Valid hostname must contain at least one dot (FQDN)
    if (n && n.includes(".")) seen.add(n)
  }
  return Array.from(seen)
}

export function buildHostRecords(input: {
  zoneRecords: ZoneRecord[]
  hostname: string
  domain: string
  ipv4: string | null
  ipv6: string | null
}): HostRecord[] {
  const { ipv4, ipv6, zoneRecords } = input
  const mailTargets = collectHostTargets(zoneRecords)
  // Cible du CNAME webmail : l'hôte mail (1ʳᵉ cible MX/SRV). Null si zone non générée.
  const mailHost = mailTargets[0] ?? null
  const seen = new Set<string>()
  const named: { name: string; role: HostRole }[] = []
  const add = (raw: string, role: HostRole) => {
    const n = normName(raw)
    if (!n || seen.has(n)) return
    seen.add(n)
    named.push({ name: n, role })
  }

  // La zone Stalwart est générée : MX/SRV pointent l'hôte du serveur mail ; les CNAMEs
  // sont des alias et ne constituent pas une source authoritative.
  // 1) Serveur mail : les hôtes que la zone désigne via MX/SRV.
  for (const t of mailTargets) add(t, "mail")
  // Repli (zone non encore générée) : pas de cible MX → apex + hostname public uniquement.
  // 2) Apex (accès web), s'il n'est pas déjà un hôte mail.
  add(input.domain, "apex")
  // 3) Webmail (hôte de PUBLIC_URL), s'il est distinct.
  add(input.hostname, "webmail")

  const records: HostRecord[] = []
  for (const { name, role } of named) {
    // Webmail = sous-domaine distinct → CNAME vers l'hôte mail : une seule IP à
    // maintenir (celle de la cible). Agnostique de l'IP → émis même sans écho IP.
    if (role === "webmail" && mailHost && name !== mailHost) {
      records.push({
        name: name + ".",
        type: "CNAME",
        value: mailHost + ".",
        role,
      })
      continue
    }
    if (ipv4) records.push({ name: name + ".", type: "A", value: ipv4, role })
    if (ipv6)
      records.push({ name: name + ".", type: "AAAA", value: ipv6, role })
  }
  return records
}
