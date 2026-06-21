import type { MailAddress } from "./mail-types"

// Rejette les caractères de contrôle interdits dans une valeur d'en-tête (B3 anti-CRLF).
export function isCleanHeaderValue(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\r\n\x00]/.test(s)
}

// Validation email volontairement simple et stricte (pas de display-name autorisé ici).
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

// Parse une saisie "Nom <a@b>, c@d" en adresses structurées. Tout segment dont l'email
// est invalide OU dont le name contient un caractère de contrôle est classé "invalid".
export function parseAddressList(raw: string): {
  valid: MailAddress[]
  invalid: string[]
} {
  const valid: MailAddress[] = []
  const invalid: string[] = []
  for (const segment of raw.split(",")) {
    const seg = segment.trim()
    if (seg === "") continue
    // R-B : name sans <>, email sans <>@espace — refuse "X <a@b> <c@d>" plutôt que de l'absorber.
    const m = /^([^<>]*)<([^<>\s]+@[^<>\s]+)>$/.exec(seg)
    const name = m ? m[1].trim() : ""
    const email = (m ? m[2] : seg).trim()
    if (EMAIL_RE.test(email) && isCleanHeaderValue(name)) {
      valid.push({ name, email })
    } else {
      invalid.push(seg)
    }
  }
  return { valid, invalid }
}
