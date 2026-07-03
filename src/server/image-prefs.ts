// Fonctions pures de résolution de la décision d'affichage des images distantes (#70).
// Aucune dépendance Node : ce module est importable côté client au runtime
// (use-image-actions.ts consomme normalizeSender).
import type {
  AppThreadDetail,
  AuthVerdict,
  ImageDecision,
  MailAddress,
} from "./mail-types"

// Keyword JMAP custom (RFC 8621 : « Users may add arbitrary keywords ») marquant les
// emails pour lesquels l'utilisateur a choisi « Afficher les images » (par message).
// lowercase, sans préfixe `$` (réservé), sans caractère IMAP exclu.
export const SHOW_IMAGES_KEYWORD = "stalmail_showimages"

export interface ImagePrefs {
  allowedSenders: string[]
  // Domaine du compte de session (exemption locale #126). "" si indérivable
  // (accountName sans @) → exemption simplement inopérante (fail-closed).
  // Assemblé par readThreadFn — JAMAIS persisté dans image-prefs.json.
  localDomain: string
}

export function normalizeSender(email: string): string {
  return email.trim().toLowerCase()
}

// Domaine d'une adresse, lowercase/trim. "" si pas de @ (ou @ final) — les appelants
// doivent traiter "" comme « pas de domaine », jamais le comparer à un autre "".
export function senderDomain(email: string): string {
  const at = email.lastIndexOf("@")
  if (at === -1) return ""
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase()
}

// Upgrade par-expéditeur d'une décision niveau-message déjà calculée (via le keyword).
// Précédence : sender-allowed > (message-allowed | blocked).
// Gating anti-usurpation (#126) : l'upgrade exige un message AUTHENTIFIÉ (dmarc=pass),
// ou — exemption locale — aucun verdict (courrier interne via soumission, sans
// Authentication-Results) ET expéditeur du même domaine que le compte, domaines non
// vides des deux côtés (anti-fail-open : "" === "" ne doit jamais accorder l'upgrade).
export function resolveImageDecision(
  prefs: ImagePrefs,
  message: {
    from: MailAddress[]
    imageDecision?: ImageDecision
    authVerdict?: AuthVerdict
  }
): ImageDecision {
  const preliminary: ImageDecision = message.imageDecision ?? "blocked"
  const email = message.from.at(0)?.email ?? ""
  const sender = normalizeSender(email)
  if (!sender || !prefs.allowedSenders.includes(sender)) return preliminary
  const verdict: AuthVerdict = message.authVerdict ?? "none"
  if (verdict === "pass") return "sender-allowed"
  if (verdict === "none") {
    const fromDomain = senderDomain(email)
    if (
      fromDomain !== "" &&
      prefs.localDomain !== "" &&
      fromDomain === prefs.localDomain
    )
      return "sender-allowed"
  }
  return preliminary // "fail" ou exemption non applicable → fail-closed
}

export function applyImagePrefs(
  detail: AppThreadDetail,
  prefs: ImagePrefs
): AppThreadDetail {
  return {
    ...detail,
    messages: detail.messages.map((m) => ({
      ...m,
      imageDecision: resolveImageDecision(prefs, m),
    })),
  }
}
