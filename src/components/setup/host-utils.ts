// Pure host/zone helpers shared by the wizard steps (DomainStep, DnsStep).
// Extracted so the logic lives in one tested place rather than duplicated
// across components (project convention: pure functions tested in isolation).

/** Normalize a hostname/domain: trim whitespace, lowercase, strip trailing FQDN root dot. */
function normalizeHost(h: string): string {
  return h.trim().toLowerCase().replace(/\.$/, "")
}

/** Is the hostname outside the default domain's zone? (e.g. mail.autre.fr vs dupont.fr) */
export function isExternalHost(hostname: string, domain: string): boolean {
  const host = normalizeHost(hostname)
  const base = normalizeHost(domain)
  if (!host || !base) return false
  return host !== base && !host.endsWith("." + base)
}

/** The DNS zone owning the hostname (strips the leftmost label for sub-domains). */
export function hostZone(hostname: string): string {
  const normalized = normalizeHost(hostname)
  const parts = normalized.split(".")
  return parts.length > 2 ? parts.slice(1).join(".") : normalized
}
