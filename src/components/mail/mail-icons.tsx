import type { CSSProperties } from 'react'

const ICON_PATHS: Record<string, string> = {
  inbox: '<path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M3 13h5l1.5 2.5h5L16 13h5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 17.1 6.75 19.7l1-5.86L3.5 9.66l5.9-.86z"/>',
  'star-fill':
    '<path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 17.1 6.75 19.7l1-5.86L3.5 9.66l5.9-.86z" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  send: '<path d="M21 4L3 11l6.5 2.5M21 4l-7 16-3.5-9M21 4L10.5 13.5"/>',
  draft: '<path d="M12 20h7M4 20h2.5l9.4-9.4a1.8 1.8 0 0 0 0-2.5l-1-1a1.8 1.8 0 0 0-2.5 0L3 16.5V20z"/>',
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
  paperclip: '<path d="M18 8.5l-7.6 7.6a3 3 0 0 1-4.2-4.2l8-8a4.2 4.2 0 0 1 6 6l-8 8"/>',
}

export function Icon({
  name,
  size = 18,
  style,
  className,
}: {
  name: keyof typeof ICON_PATHS | string
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
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? '' }}
    />
  )
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
}

const PALETTE = [
  '#2a6fdb',
  '#d6336c',
  '#7048e8',
  '#0c8599',
  '#e8590c',
  '#2b8a3e',
  '#5f3dc4',
  '#c2255c',
]

export function hashColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length] ?? '#2a6fdb'
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
      style={{ width: size, height: size, background: hashColor(email || name) }}
      aria-hidden="true"
    >
      {initialsOf(name || email)}
    </span>
  )
}
