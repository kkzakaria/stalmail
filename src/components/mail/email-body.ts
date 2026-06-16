// Rendu sûr du corps d'email. L'anti-XSS réel = iframe sandbox="" + CSP (cf. message-item).
// Ici : choix texte/html (pur), blocage des ressources distantes (anti-traceur),
// assainissement des liens (défense en profondeur), assemblage du document srcdoc.

// CSP de l'iframe. Par défaut : aucune ressource distante (anti-traceur). Quand l'utilisateur
// demande explicitement « Afficher les images », on élargit `img-src` aux schémas distants —
// sinon le navigateur bloquerait les images malgré la levée du filtrage regex (le bouton
// « Afficher les images » restait alors sans effet). Toujours pas de scripts ni same-origin.
function frameCsp(showImages: boolean): string {
  const imgSrc = showImages ? "data: cid: https: http:" : "data: cid:"
  return `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'`
}

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
    // Retire rel ET target fournis par l'email (quotés ou non), puis force des valeurs sûres.
    // Sans le strip de `target`, un <a target="_self"> outrepasserait notre <base target="_blank">
    // et rouvrirait le lien DANS l'iframe du reader. Le préfixe `\s` épargne data-rel/data-target.
    a = a
      .replace(/\srel\s*=\s*(?:(["'])[^"']*\1|[^\s"'>]+)/gi, "")
      .replace(/\starget\s*=\s*(?:(["'])[^"']*\1|[^\s"'>]+)/gi, "")
    return `<a${a} target="_blank" rel="noopener noreferrer">`
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
// `<base target="_blank">` (placé AVANT le body, donc prioritaire sur tout <base> de l'email) :
// les liens cliqués ouvrent un nouvel onglet au lieu de naviguer DANS le reader. Nécessite que
// l'iframe autorise les popups (sandbox allow-popups allow-popups-to-escape-sandbox, cf. message-item).
export function buildFrameDoc(
  html: string,
  opts: { showImages: boolean }
): string {
  let body = sanitizeLinks(html)
  if (!opts.showImages) body = blockRemoteImages(body)
  // Revue sécu F-1 : retire tout <base> de l'email. Notre <base target="_blank"> ne fixe que
  // la *cible* ; un <base href="https://evil/"> injecté détournerait la résolution des liens
  // relatifs (phishing). On le supprime → seul notre <base> subsiste (URL relatives → about:srcdoc, inerte).
  body = body.replace(/<base\b[^>]*>/gi, "")
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${frameCsp(opts.showImages)}"><base target="_blank"></head><body>${body}</body></html>`
}
