// Rendu sûr du corps d'email. L'anti-XSS réel = iframe sandbox="" + CSP (cf. message-item).
// Ici : choix texte/html (pur), blocage des ressources distantes (anti-traceur),
// assainissement des liens (défense en profondeur), assemblage du document srcdoc.

const FRAME_CSP =
  "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'"

export function pickBody(msg: {
  textBody: string | null
  htmlBody: string | null
}): {
  kind: "text" | "html"
  content: string
} {
  if (msg.textBody && msg.textBody.trim() !== "")
    return { kind: "text", content: msg.textBody }
  if (msg.htmlBody && msg.htmlBody.trim() !== "")
    return { kind: "html", content: msg.htmlBody }
  return { kind: "text", content: "" }
}

// IMPORTANT (F1/F2) : la garantie réelle (blocage réseau + non-exécution) vient de l'iframe
// sandbox="" + CSP `default-src 'none'; img-src data: cid:` (cf. buildFrameDoc / message-item).
// Les fonctions ci-dessous sont best-effort / anti-traceur / défense en profondeur — PAS la
// barrière de sécurité primaire. Elles couvrent les cas courants, pas l'exhaustivité du HTML.

// Neutralise src/srcset/background/url() distants (http/https/protocole-relatif), avec ou sans
// guillemets. Préserve data: et cid:.
export function blockRemoteImages(html: string): string {
  return html
    .replace(
      /(<img\b[^>]*?\bsrc\s*=\s*)(["']?)(?:https?:|\/\/)[^\s"'>]*\2/gi,
      "$1$2$2"
    )
    .replace(
      /(<(?:img|source)\b[^>]*?\bsrcset\s*=\s*)(["'])[^"']*\2/gi,
      "$1$2$2"
    )
    .replace(
      /(\bbackground\s*=\s*)(["']?)(?:https?:|\/\/)[^\s"'>]*\2/gi,
      "$1$2$2"
    )
    .replace(/url\(\s*(['"]?)(?:https?:|\/\/)[^)]*\1\s*\)/gi, "url()")
}

// <a> : force rel="noopener noreferrer" et neutralise les schémas dangereux (avec/sans
// guillemets). Best-effort (cf. note ci-dessus) ; l'iframe sandbox bloque déjà l'exécution.
export function sanitizeLinks(html: string): string {
  return html.replace(/<a\b([^>]*?)>/gi, (_full, attrs: string) => {
    let a = attrs.replace(
      /\bhref\s*=\s*(["']?)\s*(?:javascript|data|vbscript):[^\s"'>]*\1/gi,
      'href="#"'
    )
    a = a.replace(/\srel\s*=\s*(["'])[^"']*\1/gi, "")
    return `<a${a} rel="noopener noreferrer">`
  })
}

// Détecte des ressources distantes (img src/srcset, background=, url()) pour afficher le bandeau.
export function hasRemoteImages(html: string): boolean {
  return (
    /<img\b[^>]*\bsrc\s*=\s*["']?(?:https?:|\/\/)/i.test(html) ||
    /\bsrcset\s*=\s*["']?[^>]*(?:https?:|\/\/)/i.test(html) ||
    /\bbackground\s*=\s*["']?(?:https?:|\/\/)/i.test(html) ||
    /url\(\s*["']?(?:https?:|\/\/)/i.test(html)
  )
}

// Assemble le document injecté dans <iframe srcdoc> : CSP + liens assainis + images (selon showImages).
export function buildFrameDoc(
  html: string,
  opts: { showImages: boolean }
): string {
  let body = sanitizeLinks(html)
  if (!opts.showImages) body = blockRemoteImages(body)
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"></head><body>${body}</body></html>`
}
