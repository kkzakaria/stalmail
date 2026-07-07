import DOMPurify from "isomorphic-dompurify"

// Allowlist HTML minimale du composer (audit 4c B2). Parseur DOM, pas de regex.
const ALLOWED_TAGS = [
  "b",
  "i",
  "strong",
  "em",
  "a",
  "ul",
  "ol",
  "li",
  "p",
  "br",
  "blockquote",
]
const ALLOWED_ATTR = ["href"]

// Schémas d'URL autorisés sur href après décodage (B2). DOMPurify gère déjà le
// décodage/normalisation et bloque javascript:/data: hors de cette liste.
const ALLOWED_URI_REGEXP = /^(?:https?|mailto):/i

// Retire la query-string des mailto: (anti-injection d'en-têtes : mailto:x?bcc=…).
function stripMailtoQuery(node: Element): void {
  const href = node.getAttribute("href")
  if (href && /^mailto:/i.test(href)) {
    const q = href.indexOf("?")
    if (q !== -1) node.setAttribute("href", href.slice(0, q))
  }
}

let hookInstalled = false
function ensureHook(): void {
  if (hookInstalled) return
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") stripMailtoQuery(node)
  })
  hookInstalled = true
}

// Sanitise le HTML produit/affiché par le RteEditor. Barrière autoritaire côté serveur
// (sendMailFn) et défense en profondeur côté client (injection de citation, B1).
export function sanitizeComposeHtml(html: string): string {
  ensureHook()
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
  })
}

// Alternative text/plain : bloc → saut de ligne, <br> → \n, entités décodées, balises retirées.
// R-A : sert UNIQUEMENT de corps text/plain (bodyValues.plain), jamais de valeur d'en-tête —
// aucun vecteur d'injection (Stalwart encode le corps). Décodage d'entités volontairement partiel.
//
// Note : le remplacement des balises de bloc en \n est appliqué APRÈS sanitisation car DOMPurify
// normalise les balises (ex. ajoute </p> fermant manquant). Balises ouvrantes ET fermantes sont
// converties en \n — chaque <p>contenu</p> produit ainsi \n\n réduit par la règle \n{3,}→\n\n.
export function htmlToPlainText(html: string): string {
  const sanitized = sanitizeComposeHtml(html)
  const withBreaks = sanitized
    .replace(/<(p|div|li|ul|ol)[^>]*>/gi, "\n") // ouverture bloc → \n
    .replace(/<\/(p|div|li|ul|ol)>/gi, "\n") //    fermeture bloc → \n
    .replace(/<br\s*\/?>/gi, "\n")
  const stripped = withBreaks.replace(/<[^>]+>/g, "")
  const decoded = stripped
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
  return decoded.replace(/\n{3,}/g, "\n\n").trim()
}
