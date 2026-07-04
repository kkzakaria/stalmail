import type { CSSProperties } from "react"

// `satisfies` (pas d'annotation Record) : les clés restent littérales → IconName
// donne la complétion et attrape les typos à la compilation (CodeRabbit #134).
const ICON_PATHS = {
  inbox:
    '<path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M3 13h5l1.5 2.5h5L16 13h5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 17.1 6.75 19.7l1-5.86L3.5 9.66l5.9-.86z"/>',
  "star-fill":
    '<path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 17.1 6.75 19.7l1-5.86L3.5 9.66l5.9-.86z" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  send: '<path d="M21 4L3 11l6.5 2.5M21 4l-7 16-3.5-9M21 4L10.5 13.5"/>',
  draft:
    '<path d="M12 20h7M4 20h2.5l9.4-9.4a1.8 1.8 0 0 0 0-2.5l-1-1a1.8 1.8 0 0 0-2.5 0L3 16.5V20z"/>',
  archive:
    '<rect x="3.5" y="5" width="17" height="4" rx="1"/><path d="M5 9v8.5A1.5 1.5 0 0 0 6.5 19h11A1.5 1.5 0 0 0 19 17.5V9M9.5 13h5"/>',
  spam: '<path d="M12 3.5l8.5 4.5v4c0 4.7-3.4 7.7-8.5 9-5.1-1.3-8.5-4.3-8.5-9V8z"/><path d="M12 8.5v4M12 15.5v.01"/>',
  trash:
    '<path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 19L18 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.8-3.8"/>',
  compose:
    '<path d="M4 20h7M13.5 6.5l3 3M5 16.5l9.5-9.5a1.9 1.9 0 0 1 2.7 0l.8.8a1.9 1.9 0 0 1 0 2.7L8.5 20H5z"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3.5v3.5M16 3.5v3.5"/>',
  tag: '<path d="M3.5 12.5l8-8H19a1.5 1.5 0 0 1 1.5 1.5v7.5l-8 8a1.5 1.5 0 0 1-2.1 0l-6.9-6.9a1.5 1.5 0 0 1 0-2.1z"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/>',
  paperclip:
    '<path d="M18 8.5l-7.6 7.6a3 3 0 0 1-4.2-4.2l8-8a4.2 4.2 0 0 1 6 6l-8 8"/>',
  trash2:
    '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/>',
  "mail-open":
    '<path d="M3 9l9-6 9 6v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9l9 6 9-6"/>',
  // Enveloppe FERMÉE (= non lu), distincte de mail-open (ouverte = lu).
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  "more-v":
    '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  "chev-left": '<path d="M15 6l-6 6 6 6"/>',
  "chev-down": '<path d="M6 9l6 6 6-6"/>',
  reply: '<path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 5 5v1"/>',
  "reply-all":
    '<path d="M7 7l-5 5 5 5"/><path d="M12 7l-5 5 5 5"/><path d="M7 12h9a4 4 0 0 1 4 4v1"/>',
  replyAll:
    '<path d="M7 7l-5 5 5 5"/><path d="M12 7l-5 5 5 5"/><path d="M7 12h9a4 4 0 0 1 4 4v1"/>',
  forward: '<path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 0 0-5 5v1"/>',
  download: '<path d="M12 3v12"/><path d="M7 11l5 4 5-4"/><path d="M5 19h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pin: '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14v7"/>',
  // Icônes Composer — modes min/normal/max (ajoutées en Task 12)
  minimize: '<path d="M6 15h12"/>',
  expand: '<path d="M4 10V4h6M20 14v6h-6M14 4h6v6M10 20H4v-6"/>',
  shrink: '<path d="M10 4v6H4M14 20v-6h6M20 10h-6V4M4 14h6v6"/>',
  // Icônes RTE (toolbar du Composer — ajoutées en Task 10)
  bold: '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4.5 4.5 0 0 1 0 9H6z"/>',
  italic:
    '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  listOrdered:
    '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  // Bandeau images distantes : même silhouette de bouclier que `spam` (famille cohérente),
  // coche = protection active ; `image` = contenu distant chargé.
  "shield-check":
    '<path d="M12 3.5l8.5 4.5v4c0 4.7-3.4 7.7-8.5 9-5.1-1.3-8.5-4.3-8.5-9V8z"/><path d="M9.2 12l2 2 3.6-4"/>',
  image:
    '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none"/><path d="M5 16.5l4-4 3 3 2.5-2.5 4.5 4.5"/>',
} satisfies Record<string, string>

export type IconName = keyof typeof ICON_PATHS

export function Icon({
  name,
  size = 18,
  style,
  className,
}: {
  name: IconName | string
  size?: number
  style?: CSSProperties
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: (ICON_PATHS as Record<string, string>)[name] ?? "",
      }}
    />
  )
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("")
}

const PALETTE = [
  "#2a6fdb",
  "#d6336c",
  "#7048e8",
  "#0c8599",
  "#e8590c",
  "#2b8a3e",
  "#5f3dc4",
  "#c2255c",
]

export function hashColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length] ?? "#2a6fdb"
}

export function Avatar({
  name,
  email,
  size = 36,
}: {
  name: string
  email: string
  size?: number
}) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: hashColor(email || name),
      }}
      aria-hidden="true"
    >
      {initialsOf(name || email)}
    </span>
  )
}
