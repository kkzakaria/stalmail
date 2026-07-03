// Extraction pure du verdict DMARC depuis Authentication-Results (RFC 8601) — #126.
// Aucune dépendance Node : importable partout.
import type { AuthVerdict } from "./mail-types"

// Neutralise commentaires parenthésés (imbriqués) ET quoted-strings en un seul
// balayage à états (RFC 8601 s'appuie sur RFC 5322 : une quote dans un commentaire
// est du texte, une parenthèse dans une quoted-string aussi — deux passes regex ne
// peuvent pas être correctes ensemble ; revue #126). Gère les échappements `\x`.
// Structure non refermée (quote ou parenthèse ouverte, parenthèse fermante orpheline)
// → null : l'appelant traite l'instance comme illisible (fail-closed).
function neutralize(value: string): string | null {
  let out = ""
  let depth = 0
  let inQuote = false
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (inQuote) {
      if (c === "\\")
        i++ // quoted-pair : saute le caractère échappé
      else if (c === '"') inQuote = false
      continue
    }
    if (depth > 0) {
      if (c === "\\") i++
      else if (c === "(") depth++
      else if (c === ")") depth--
      continue
    }
    if (c === '"') {
      inQuote = true
      out += " "
      continue
    }
    if (c === "(") {
      depth = 1
      out += " "
      continue
    }
    if (c === ")") return null // fermante orpheline
    out += c
  }
  return inQuote || depth > 0 ? null : out
}

// Verdict DMARC de la PREMIÈRE instance (ordre du message = la nôtre sur le port 25,
// les instances forgées sont en dessous — spec §2/§3.2). `dmarc` est matché en frontière
// de clause (début ou après ';') pour ignorer un `dmarc=` niché dans une valeur de
// propriété. pass → "pass" ; fail/none/temperror/permerror… → "fail" (fail-closed :
// dmarc=none = domaine sans politique, aucune protection anti-usurpation) ; instance
// présente SANS clause dmarc= → "fail" (message tamponné port 25 sans verdict : ne
// JAMAIS ouvrir l'exemption locale — audit #126 F1) ; aucune instance → "none" (seul
// cas éligible à l'exemption locale §3.3) ; structure malformée → "fail" (jamais "none").
export function parseDmarcVerdict(
  headers: string[] | null | undefined
): AuthVerdict {
  const first = headers?.[0]
  if (!first) return "none"
  const cleaned = neutralize(first)
  if (cleaned === null) return "fail"
  const m = /(?:^|;)\s*dmarc\s*=\s*([a-z0-9]+)/i.exec(cleaned)
  if (!m) return "fail"
  return m[1].toLowerCase() === "pass" ? "pass" : "fail"
}
