// Extraction pure du verdict DMARC depuis Authentication-Results (RFC 8601) — #126.
// Aucune dépendance Node : importable partout.
import type { AuthVerdict } from "./mail-types"

// Retire les commentaires parenthésés (CFWS) AVANT tout match : leur contenu est
// influençable par l'expéditeur (ex. `spf=pass (dmarc=pass)`) même dans NOTRE en-tête.
// Boucle jusqu'à stabilité pour gérer l'imbrication.
function stripComments(value: string): string {
  let out = value
  for (;;) {
    const next = out.replace(/\([^()]*\)/g, " ")
    if (next === out) return out
    out = next
  }
}

// Verdict DMARC de la PREMIÈRE instance (ordre du message = la nôtre sur le port 25,
// les instances forgées sont en dessous — spec §2/§3.2). `dmarc` est matché en frontière
// de clause (début ou après ';') pour ignorer un `dmarc=` niché dans une valeur de
// propriété. pass → "pass" ; fail/none/temperror/permerror… → "fail" (fail-closed :
// dmarc=none = domaine sans politique, aucune protection anti-usurpation) ; clause ou
// instance absente → "none".
export function parseDmarcVerdict(
  headers: string[] | null | undefined
): AuthVerdict {
  const first = headers?.[0]
  if (!first) return "none"
  const cleaned = stripComments(first)
  const m = /(?:^|;)\s*dmarc\s*=\s*([a-z0-9]+)/i.exec(cleaned)
  if (!m) return "none"
  return m[1].toLowerCase() === "pass" ? "pass" : "fail"
}
