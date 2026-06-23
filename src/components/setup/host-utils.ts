// Pure host/zone helpers shared by the wizard steps (DomainStep, DnsStep).
// Extracted so the logic lives in one tested place rather than duplicated
// across components (project convention: pure functions tested in isolation).

/** Is the hostname outside the default domain's zone? (e.g. mail.autre.fr vs dupont.fr) */
export function isExternalHost(hostname: string, domain: string): boolean {
  if (!hostname || !domain) return false
  // Hostnames are case-insensitive — compare in lower case.
  const host = hostname.toLowerCase()
  const base = domain.toLowerCase()
  return host !== base && !host.endsWith("." + base)
}

/** The DNS zone owning the hostname (strips the leftmost label for sub-domains). */
export function hostZone(hostname: string): string {
  const parts = (hostname || "").split(".")
  return parts.length > 2 ? parts.slice(1).join(".") : hostname
}
