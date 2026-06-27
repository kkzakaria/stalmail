// Découverte de l'IP publique du serveur via un service d'écho (appel sortant).
// Stalwart ne publiant jamais les A/AAAA, c'est la seule source pour pré-remplir le
// guidage A/AAAA du wizard. Aucun secret, lecture seule. Échec → null (fallback saisie
// manuelle côté UI). Un seul service par famille (pas de cascade), surchargeable par env.
import { isIpv4, isIpv6 } from "@/lib/ip"

/** Extrait l'IP de la famille demandée d'une réponse d'écho (IP nue ou ligne 'clé=valeur'). */
export function parseEchoResponse(text: string, family: 4 | 6): string | null {
  const valid = family === 4 ? isIpv4 : isIpv6
  for (const raw of text.split(/\s+/)) {
    const token = raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : raw
    if (valid(token))
      return family === 6 ? token.trim().toLowerCase() : token.trim()
  }
  return null
}

async function fetchEcho(url: string, family: 4 | 6): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    return parseEchoResponse(await res.text(), family)
  } catch {
    return null
  }
}

export async function discoverServerIp(): Promise<{
  ipv4: string | null
  ipv6: string | null
}> {
  const v4 = process.env.STALMAIL_IP_ECHO_URL ?? "https://api.ipify.org"
  const v6 = process.env.STALMAIL_IP_ECHO_URL_V6 ?? "https://api6.ipify.org"
  const [ipv4, ipv6] = await Promise.all([fetchEcho(v4, 4), fetchEcho(v6, 6)])
  return { ipv4, ipv6 }
}
