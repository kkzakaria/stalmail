// Fonctions pures de résolution de la décision d'affichage des images distantes (#70).
// Aucune dépendance Node : ce module est importable côté client au runtime
// (use-image-actions.ts consomme normalizeSender).
import type { AppThreadDetail, ImageDecision, MailAddress } from "./mail-types"

// Keyword JMAP custom (RFC 8621 : « Users may add arbitrary keywords ») marquant les
// emails pour lesquels l'utilisateur a choisi « Afficher les images » (par message).
// lowercase, sans préfixe `$` (réservé), sans caractère IMAP exclu.
export const SHOW_IMAGES_KEYWORD = "stalmail_showimages"

export interface ImagePrefs {
  allowedSenders: string[]
}

export function normalizeSender(email: string): string {
  return email.trim().toLowerCase()
}

// Upgrade par-expéditeur d'une décision niveau-message déjà calculée (via le keyword).
// Précédence : sender-allowed > (message-allowed | blocked).
export function resolveImageDecision(
  prefs: ImagePrefs,
  message: { from: MailAddress[]; imageDecision?: ImageDecision }
): ImageDecision {
  const preliminary: ImageDecision = message.imageDecision ?? "blocked"
  const sender = normalizeSender(message.from.at(0)?.email ?? "")
  if (sender && prefs.allowedSenders.includes(sender)) return "sender-allowed"
  return preliminary
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
