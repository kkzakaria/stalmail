import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs"
import { join } from "node:path"

// Allowlist d'expéditeurs de confiance par compte (#70). App-only state sur le volume
// app (NON le répertoire partagé cross-conteneur). Défaut aligné sur STALMAIL_DATA_DIR.
export interface ImagePrefsRecord {
  accountId: string
  allowedSenders: string[]
}

function dataDir(): string {
  return process.env.STALMAIL_DATA_DIR ?? "/var/lib/stalmail"
}
function storePath(): string {
  return join(dataDir(), "image-prefs.json")
}

let cache: Map<string, ImagePrefsRecord> | null = null

function load(): Map<string, ImagePrefsRecord> {
  if (cache) return cache
  const m = new Map<string, ImagePrefsRecord>()
  const p = storePath()
  if (existsSync(p)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(p, "utf8"))
      if (Array.isArray(parsed)) {
        for (const r of parsed as (Partial<ImagePrefsRecord> | null)[]) {
          // Valide la forme ET les éléments : un JSON valide mais altéré (ex.
          // allowedSenders: [42]) serait sinon re-persisté typé string[] (CodeRabbit #125).
          if (
            r &&
            typeof r.accountId === "string" &&
            Array.isArray(r.allowedSenders) &&
            r.allowedSenders.every((s) => typeof s === "string")
          )
            m.set(r.accountId, r as ImagePrefsRecord)
        }
      }
    } catch (err) {
      console.error(
        "[image-prefs-store] corrupt image-prefs.json, starting empty:",
        err
      )
    }
  }
  cache = m
  return m
}

function persist(m: Map<string, ImagePrefsRecord>): void {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `image-prefs.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify([...m.values()]), {
    encoding: "utf8",
    mode: 0o600,
  })
  renameSync(tmp, storePath()) // remplacement atomique
}

export function getPrefs(accountId: string): { allowedSenders: string[] } {
  const r = load().get(accountId)
  return { allowedSenders: r ? [...r.allowedSenders] : [] }
}

// Cap anti-abus (revue sécu) : sans borne, un client authentifié pourrait faire croître
// image-prefs.json sans limite (chaque mutation réécrit le fichier entier).
export const MAX_TRUSTED_SENDERS = 500

export function addSender(accountId: string, sender: string): void {
  const m = load()
  const cur = m.get(accountId) ?? { accountId, allowedSenders: [] }
  if (cur.allowedSenders.includes(sender)) return
  // Au-delà du cap : éviction FIFO du plus ancien (l'action utilisateur aboutit toujours,
  // cohérent avec le patch optimiste côté client).
  const next = [...cur.allowedSenders, sender].slice(-MAX_TRUSTED_SENDERS)
  m.set(accountId, { ...cur, allowedSenders: next })
  persist(m)
}

export function removeSender(accountId: string, sender: string): void {
  const m = load()
  const cur = m.get(accountId)
  if (!cur || !cur.allowedSenders.includes(sender)) return
  m.set(accountId, {
    ...cur,
    allowedSenders: cur.allowedSenders.filter((s) => s !== sender),
  })
  persist(m)
}

export function deleteAllForAccount(accountId: string): void {
  const m = load()
  if (m.delete(accountId)) persist(m)
}

// test-only: vide le cache mémoire pour forcer une relecture disque au prochain appel.
export function __resetCacheForTest(): void {
  cache = null
}
