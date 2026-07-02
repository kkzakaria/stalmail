# Persistance « Afficher les images » (#70) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persister la décision utilisateur « Afficher les images » d'un mail à image distante, par message (keyword JMAP natif) et par expéditeur (allowlist compte), avec révocation inline.

**Architecture:** Le blocage/rendu reste côté client (iframe sandbox + CSP, inchangés). La *persistance* est côté serveur : (1) par-message via un keyword JMAP custom `stalmail_showimages` posé par `Email/set` et lu par `Email/get` ; (2) par-expéditeur via un petit store fichier `image-prefs-store.ts` calqué sur `session-store.ts`. La décision effective par message est résolue côté serveur dans `readThreadFn` et exposée au client via `AppMessage.imageDecision`.

**Tech Stack:** TanStack Start (server functions BFF), JMAP (`jmapUserCall`), Zod (validation), TanStack Query (cache/optimistic), Vitest, react-i18next.

## Global Constraints

- **Gestionnaire de paquets : Bun** — `bun run lint`, `bun run typecheck`, `bun run test` (jamais npm/yarn/pnpm).
- **Zod** valide toute entrée de server function ; `accountId` toujours issu de `requireSession()`, jamais du client.
- **Pas d'`Email/set` générique** exposé au client ; keyword fermé résolu côté serveur.
- **i18n** : libellés FR via clés `t('...')`, jamais de texte en dur. Ajouter aussi le bloc `en` (les deux existent dans `resources.ts`).
- **CSP** : on n'élargit `img-src` qu'après consentement (défaut `img-src data: cid:`). Durcissement inclus (revue sécu, Task 7) : la variante consentie devient `img-src data: cid: https:` (retrait de `http:`).
- **Fonctions pures extraites et testées** isolément ; composants présentationnels (pas de hooks de route dans le composant testé).
- Commits **conventionnels** (`feat:`, `test:`…). Pre-commit (`lint && typecheck && test`) ne doit pas être contourné.
- Keyword custom : `stalmail_showimages` (lowercase, sans `$`, sans caractère IMAP exclu).

---

## File Structure

- **Créé** `src/server/image-prefs.ts` — fonctions pures : `normalizeSender`, `resolveImageDecision`, `applyImagePrefs`, constante `SHOW_IMAGES_KEYWORD`. Importable côté client (aucune dépendance Node ; fonctions pures + constante — `use-image-actions.ts` importe `normalizeSender` au runtime).
- **Créé** `src/server/image-prefs.test.ts` — tests des fonctions pures.
- **Créé** `src/server/image-prefs-store.ts` — store fichier de l'allowlist expéditeurs (calqué sur `session-store.ts`).
- **Créé** `src/server/image-prefs-store.test.ts` — tests du store (miroir de `session-store.test.ts`).
- **Créé** `src/components/mail/use-image-actions.ts` — hook mutations (showOnce / trustSender / untrustSender) + optimistic.
- **Créé** `src/components/mail/use-image-actions.test.tsx` — tests du hook.
- **Modifié** `src/server/mail-types.ts` — type `ImageDecision` + champ optionnel `AppMessage.imageDecision`.
- **Modifié** `src/server/mail-actions.ts` — `parseThreadDetail` lit le keyword ; `readThreadFn` applique les prefs ; nouvelles server functions `showImagesOnceFn` / `trustSenderFn` / `untrustSenderFn` + builder `buildShowImagesCall`.
- **Modifié** `src/server/mail-actions.test.ts` — tests d'enrichissement + validation Zod.
- **Modifié** `src/components/mail/message-item.tsx` — supprime l'état local, rend les 3 variantes de bandeau, callbacks en props.
- **Modifié** `src/components/mail/message-item.test.tsx` — tests des variantes + callbacks.
- **Modifié** `src/components/mail/reader.tsx` — props callbacks passées à `MessageItem`.
- **Modifié** `src/routes/mail/$folder.tsx` — câble `useImageActions` dans `ReaderPane`.
- **Modifié** `src/i18n/resources.ts` — clés `trustSender`, `imagesFromSenderShown`, `blockSender` (fr + en).
- **Modifié** `src/components/mail/email-body.ts` — durcissement `frameCsp` (retrait de `http:` de la variante consentie).
- **Modifié** `src/components/mail/email-body.test.ts` — assertion CSP mise à jour.

---

## Task 1 : Fonctions pures + types

**Files:**
- Modify: `src/server/mail-types.ts:54-67` (interface `AppMessage`)
- Create: `src/server/image-prefs.ts`
- Test: `src/server/image-prefs.test.ts`

**Interfaces:**
- Produces:
  - `type ImageDecision = "sender-allowed" | "message-allowed" | "blocked"`
  - `AppMessage.imageDecision?: ImageDecision`
  - `SHOW_IMAGES_KEYWORD = "stalmail_showimages"` (const)
  - `normalizeSender(email: string): string`
  - `resolveImageDecision(prefs: { allowedSenders: string[] }, message: { from: MailAddress[]; imageDecision?: ImageDecision }): ImageDecision`
  - `applyImagePrefs(detail: AppThreadDetail, prefs: { allowedSenders: string[] }): AppThreadDetail`

- [ ] **Step 1: Ajouter le type et le champ dans `mail-types.ts`**

Ajouter avant `export interface AppMessage {` :

```ts
export type ImageDecision = "sender-allowed" | "message-allowed" | "blocked"
```

Puis, dans `AppMessage`, après la ligne `attachments: AppAttachment[]` :

```ts
  // Décision d'affichage des images distantes, résolue côté serveur (readThreadFn).
  // Absent (client bundle / factories de test) → traité comme "blocked" (défaut sûr).
  imageDecision?: ImageDecision
```

- [ ] **Step 2: Écrire le test des fonctions pures**

Create `src/server/image-prefs.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import {
  normalizeSender,
  resolveImageDecision,
  applyImagePrefs,
} from "./image-prefs"
import type { AppThreadDetail } from "./mail-types"

describe("normalizeSender", () => {
  it("trim + lowercase", () => {
    expect(normalizeSender("  Bob@X.IO ")).toBe("bob@x.io")
  })
})

describe("resolveImageDecision", () => {
  const from = [{ name: "Bob", email: "Bob@x.io" }]

  it("sender de confiance → sender-allowed (précédence)", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: ["bob@x.io"] },
        { from, imageDecision: "blocked" }
      )
    ).toBe("sender-allowed")
  })

  it("keyword posé mais expéditeur non listé → message-allowed", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: [] },
        { from, imageDecision: "message-allowed" }
      )
    ).toBe("message-allowed")
  })

  it("rien → blocked", () => {
    expect(
      resolveImageDecision({ allowedSenders: [] }, { from })
    ).toBe("blocked")
  })

  it("from vide → jamais sender-allowed, retombe sur le niveau message", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: [""] },
        { from: [], imageDecision: "blocked" }
      )
    ).toBe("blocked")
  })
})

describe("applyImagePrefs", () => {
  it("upgrade chaque message dont l'expéditeur est de confiance", () => {
    const detail: AppThreadDetail = {
      threadId: "t1",
      subject: "s",
      emailIds: ["e1", "e2"],
      starred: false,
      unread: false,
      messages: [
        {
          id: "e1",
          messageId: null,
          from: [{ name: "", email: "bob@x.io" }],
          to: [],
          cc: [],
          subject: "s",
          receivedAt: "2026-06-10T00:00:00Z",
          unread: false,
          hasAttachment: false,
          textBody: null,
          htmlBody: null,
          attachments: [],
          imageDecision: "blocked",
        },
        {
          id: "e2",
          messageId: null,
          from: [{ name: "", email: "eve@y.io" }],
          to: [],
          cc: [],
          subject: "s",
          receivedAt: "2026-06-10T00:00:00Z",
          unread: false,
          hasAttachment: false,
          textBody: null,
          htmlBody: null,
          attachments: [],
          imageDecision: "message-allowed",
        },
      ],
    }
    const out = applyImagePrefs(detail, { allowedSenders: ["bob@x.io"] })
    expect(out.messages[0].imageDecision).toBe("sender-allowed")
    expect(out.messages[1].imageDecision).toBe("message-allowed")
  })
})
```

- [ ] **Step 3: Lancer le test → échec attendu**

Run: `bun run test image-prefs`
Expected: FAIL (module `./image-prefs` introuvable).

- [ ] **Step 4: Implémenter `image-prefs.ts`**

Create `src/server/image-prefs.ts` :

```ts
// Fonctions pures de résolution de la décision d'affichage des images distantes (#70).
// Aucune dépendance Node : ce module est importable côté client au runtime
// (use-image-actions.ts consomme normalizeSender).
import type { AppThreadDetail, ImageDecision, MailAddress } from "./mail-types"

// Keyword JMAP custom (RFC 8621 : « Users may add arbitrary keywords ») marquant les
// emails pour lesquels l'utilisateur a choisi « Afficher les images » (par message).
// lowercase, sans préfixe `$` (réservé), sans caractère IMAP exclu.
export const SHOW_IMAGES_KEYWORD = "stalmail_showimages"

export function normalizeSender(email: string): string {
  return email.trim().toLowerCase()
}

// Upgrade par-expéditeur d'une décision niveau-message déjà calculée (via le keyword).
// Précédence : sender-allowed > (message-allowed | blocked).
export function resolveImageDecision(
  prefs: { allowedSenders: string[] },
  message: { from: MailAddress[]; imageDecision?: ImageDecision }
): ImageDecision {
  const preliminary: ImageDecision = message.imageDecision ?? "blocked"
  const sender = normalizeSender(message.from.at(0)?.email ?? "")
  if (sender && prefs.allowedSenders.includes(sender)) return "sender-allowed"
  return preliminary
}

export function applyImagePrefs(
  detail: AppThreadDetail,
  prefs: { allowedSenders: string[] }
): AppThreadDetail {
  return {
    ...detail,
    messages: detail.messages.map((m) => ({
      ...m,
      imageDecision: resolveImageDecision(prefs, m),
    })),
  }
}
```

- [ ] **Step 5: Lancer le test → succès attendu**

Run: `bun run test image-prefs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/image-prefs.ts src/server/image-prefs.test.ts src/server/mail-types.ts
git commit -m "feat(reader): résolveur pur de décision d'affichage des images (#70)"
```

---

## Task 2 : Store de l'allowlist expéditeurs

**Files:**
- Create: `src/server/image-prefs-store.ts`
- Test: `src/server/image-prefs-store.test.ts`

**Interfaces:**
- Produces:
  - `interface ImagePrefsRecord { accountId: string; allowedSenders: string[] }`
  - `MAX_TRUSTED_SENDERS = 500` (const exportée — cap anti-abus, revue sécu)
  - `getPrefs(accountId: string): { allowedSenders: string[] }` (jamais undefined ; `{ allowedSenders: [] }` si absent)
  - `addSender(accountId: string, sender: string): void` (dédupliqué, plafonné : évince le plus ancien au-delà du cap)
  - `removeSender(accountId: string, sender: string): void`
  - `deleteAllForAccount(accountId: string): void`
  - `__resetCacheForTest(): void`

- [ ] **Step 1: Écrire le test (miroir de `session-store.test.ts`)**

Create `src/server/image-prefs-store.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as store from "./image-prefs-store"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stalmail-imgprefs-"))
  process.env.STALMAIL_DATA_DIR = dir
  store.__resetCacheForTest()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.STALMAIL_DATA_DIR
})

describe("image-prefs-store", () => {
  it("compte inconnu → allowlist vide", () => {
    expect(store.getPrefs("a").allowedSenders).toEqual([])
  })

  it("ajoute un expéditeur (dédupliqué)", () => {
    store.addSender("a", "bob@x.io")
    store.addSender("a", "bob@x.io")
    expect(store.getPrefs("a").allowedSenders).toEqual(["bob@x.io"])
  })

  it("persiste après reset du cache (relit du disque)", () => {
    store.addSender("a", "bob@x.io")
    store.__resetCacheForTest()
    expect(store.getPrefs("a").allowedSenders).toEqual(["bob@x.io"])
  })

  it("écrit le fichier en 0600", () => {
    store.addSender("a", "bob@x.io")
    const mode = statSync(join(dir, "image-prefs.json")).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("retire un expéditeur", () => {
    store.addSender("a", "bob@x.io")
    store.removeSender("a", "bob@x.io")
    expect(store.getPrefs("a").allowedSenders).toEqual([])
  })

  it("plafonne l'allowlist (évince le plus ancien au-delà du cap)", () => {
    for (let i = 0; i <= store.MAX_TRUSTED_SENDERS; i++)
      store.addSender("a", `s${i}@x.io`)
    const senders = store.getPrefs("a").allowedSenders
    expect(senders).toHaveLength(store.MAX_TRUSTED_SENDERS)
    expect(senders[0]).toBe("s1@x.io") // s0 évincé (FIFO)
    expect(senders.at(-1)).toBe(`s${store.MAX_TRUSTED_SENDERS}@x.io`)
  })

  it("purge un compte sans toucher les autres", () => {
    store.addSender("a", "bob@x.io")
    store.addSender("b", "eve@y.io")
    store.deleteAllForAccount("a")
    expect(store.getPrefs("a").allowedSenders).toEqual([])
    expect(store.getPrefs("b").allowedSenders).toEqual(["eve@y.io"])
  })

  it("tolère un fichier corrompu et démarre vide", () => {
    writeFileSync(join(dir, "image-prefs.json"), "{NOT JSON", { mode: 0o600 })
    store.__resetCacheForTest()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(store.getPrefs("a").allowedSenders).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })
})
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `bun run test image-prefs-store`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `image-prefs-store.ts`**

Create `src/server/image-prefs-store.ts` :

```ts
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
      for (const r of JSON.parse(readFileSync(p, "utf8")) as ImagePrefsRecord[])
        m.set(r.accountId, r)
    } catch (err) {
      console.error("[image-prefs-store] corrupt image-prefs.json, starting empty:", err)
    }
  }
  cache = m
  return m
}

function persist(m: Map<string, ImagePrefsRecord>): void {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `image-prefs.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify([...m.values()]), { encoding: "utf8", mode: 0o600 })
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
```

- [ ] **Step 4: Lancer le test → succès attendu**

Run: `bun run test image-prefs-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/image-prefs-store.ts src/server/image-prefs-store.test.ts
git commit -m "feat(reader): store de l'allowlist d'expéditeurs de confiance (#70)"
```

---

## Task 3 : `parseThreadDetail` lit le keyword + `readThreadFn` applique les prefs

**Files:**
- Modify: `src/server/mail-actions.ts` (import ; `parseThreadDetail` ~407-427 ; `readThreadFn` ~667-683)
- Test: `src/server/mail-actions.test.ts`

**Interfaces:**
- Consumes: `SHOW_IMAGES_KEYWORD`, `applyImagePrefs` (Task 1) ; `getPrefs` (Task 2)
- Produces: `readThreadFn` renvoie un `AppThreadDetail` dont chaque message a `imageDecision` résolu.

- [ ] **Step 1: Écrire le test d'enrichissement**

Ajouter dans `src/server/mail-actions.test.ts`, à l'intérieur du `describe("parseThreadDetail", …)` existant :

```ts
  // NB : fixtures nommées withKeyword/withoutKeyword (PAS `responses`) — le describe
  // parseThreadDetail existant a déjà un `const responses` à son scope (no-shadow).
  it("imageDecision = message-allowed quand le keyword stalmail_showimages est posé", () => {
    const withKeyword: JmapMethodResponse[] = [
      ["Thread/get", { list: [{ id: "t1", emailIds: ["e1"] }] }, "0"],
      [
        "Email/get",
        {
          list: [
            {
              id: "e1",
              from: [{ name: "Bob", email: "bob@x.io" }],
              keywords: { stalmail_showimages: true },
              htmlBody: [{ partId: "1", type: "text/html" }],
              bodyValues: { "1": { value: "<p>hi</p>" } },
            },
          ],
        },
        "1",
      ],
    ]
    expect(parseThreadDetail(withKeyword).messages[0].imageDecision).toBe(
      "message-allowed"
    )
  })

  it("imageDecision = blocked sans keyword", () => {
    const withoutKeyword: JmapMethodResponse[] = [
      ["Thread/get", { list: [{ id: "t1", emailIds: ["e1"] }] }, "0"],
      [
        "Email/get",
        { list: [{ id: "e1", from: [], keywords: {} }] },
        "1",
      ],
    ]
    expect(parseThreadDetail(withoutKeyword).messages[0].imageDecision).toBe(
      "blocked"
    )
  })
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `bun run test mail-actions`
Expected: FAIL (`imageDecision` vaut `undefined`).

- [ ] **Step 3: Ajouter l'import du keyword et de `applyImagePrefs`**

Dans `src/server/mail-actions.ts`, après le bloc d'import `import type { SendBody } from "./compose-build"` (ligne ~21), ajouter :

```ts
import { SHOW_IMAGES_KEYWORD, applyImagePrefs } from "./image-prefs"
```

- [ ] **Step 4: `parseThreadDetail` pose `imageDecision`**

Dans l'objet `messages` construit dans `parseThreadDetail` (après `unread: (e.keywords ?? {}).$seen !== true,`), ajouter une ligne :

```ts
    imageDecision:
      (e.keywords ?? {})[SHOW_IMAGES_KEYWORD] === true
        ? "message-allowed"
        : "blocked",
```

- [ ] **Step 5: `readThreadFn` applique les prefs**

Dans le handler de `readThreadFn`, remplacer `return parseThreadDetail(responses)` par :

```ts
      const { getPrefs } = await import("./image-prefs-store")
      return applyImagePrefs(parseThreadDetail(responses), getPrefs(accountId))
```

- [ ] **Step 6: Lancer les tests → succès attendu**

Run: `bun run test mail-actions`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(reader): résout imageDecision côté serveur dans readThreadFn (#70)"
```

---

## Task 4 : Server functions (afficher-une-fois / faire-confiance / bloquer)

**Files:**
- Modify: `src/server/mail-actions.ts` (nouveau bloc après `setFlagsFn`, ~485)
- Test: `src/server/mail-actions.test.ts`

**Interfaces:**
- Consumes: `SHOW_IMAGES_KEYWORD`, `normalizeSender` (Task 1) ; `addSender`, `removeSender` (Task 2) ; `emailIdsSchema`, `requireSession`, `jmapUserCall` (existants)
- Produces:
  - `buildShowImagesCall(accountId: string, emailIds: string[]): JmapMethodCall[]`
  - `showImagesSchema`, `senderSchema` (schémas Zod exportés, testés)
  - `showImagesOnceFn({ emailIds: string[] }) → Promise<{ ok: true }>`
  - `trustSenderFn({ sender: string }) → Promise<{ ok: true }>`
  - `untrustSenderFn({ sender: string }) → Promise<{ ok: true }>`

- [ ] **Step 1: Écrire les tests (builder pur + validation Zod)**

Dans `src/server/mail-actions.test.ts` : ajouter `buildShowImagesCall`, `senderSchema` et `showImagesSchema` au **bloc d'import existant** depuis `./mail-actions` en tête de fichier (lignes 2-18 — PAS un import séparé en milieu de fichier : la règle `import/first` est active). Puis ajouter les `describe` suivants :

```ts
describe("buildShowImagesCall (pur)", () => {
  it("pose le keyword stalmail_showimages=true sur chaque email", () => {
    expect(buildShowImagesCall("acc", ["e1", "e2"])).toEqual([
      [
        "Email/set",
        {
          accountId: "acc",
          update: {
            e1: { "keywords/stalmail_showimages": true },
            e2: { "keywords/stalmail_showimages": true },
          },
        },
        "0",
      ],
    ])
  })
})

describe("schémas Zod des actions images (#70)", () => {
  it("senderSchema accepte une adresse valide", () => {
    expect(senderSchema.parse({ sender: "bob@x.io" })).toEqual({
      sender: "bob@x.io",
    })
  })
  it("senderSchema rejette une non-adresse", () => {
    expect(() => senderSchema.parse({ sender: "pas-une-adresse" })).toThrow()
  })
  it("senderSchema rejette une adresse trop longue", () => {
    expect(() =>
      senderSchema.parse({ sender: "a".repeat(320) + "@x.io" })
    ).toThrow()
  })
  it("showImagesSchema rejette un lot d'emailIds vide", () => {
    expect(() => showImagesSchema.parse({ emailIds: [] })).toThrow()
  })
})
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `bun run test mail-actions`
Expected: FAIL (`buildShowImagesCall`, `senderSchema`, `showImagesSchema` non exportés).

- [ ] **Step 3: Implémenter le bloc dans `mail-actions.ts`**

Ajouter après la définition de `setFlagsFn` (avant le commentaire `// Task 5 — moveThreadFn`), en réutilisant `normalizeSender` importé au Task 3 (compléter l'import : `import { SHOW_IMAGES_KEYWORD, applyImagePrefs, normalizeSender } from "./image-prefs"`) :

```ts
// ---------------------------------------------------------------------------
// #70 — Persistance « Afficher les images »
// Par message : keyword JMAP custom. Par expéditeur : store allowlist (côté serveur).
// ---------------------------------------------------------------------------

// Pur : Email/set posant le keyword stalmail_showimages sur plusieurs emails.
export function buildShowImagesCall(
  accountId: string,
  emailIds: string[]
): JmapMethodCall[] {
  const update: Record<string, Record<string, true>> = {}
  for (const id of emailIds)
    update[id] = { [`keywords/${SHOW_IMAGES_KEYWORD}`]: true }
  return [["Email/set", { accountId, update }, "0"]]
}

export const showImagesSchema = z.object({ emailIds: emailIdsSchema })

export const showImagesOnceFn = createServerFn({ method: "POST" })
  .validator((d: { emailIds: string[] }) => showImagesSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    try {
      const { jmapUserCall } = await import("./jmap-user")
      const { sid, accountId } = await requireSession()
      await jmapUserCall(sid, buildShowImagesCall(accountId, data.emailIds))
      return { ok: true }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("mail action failed", e)
      throw new Error("mail action failed")
    }
  })

// Anti-traceur : faire confiance à un expéditeur charge AUTOMATIQUEMENT ses images
// distantes (pixels de tracking inclus) sur tous ses futurs mails. Choix explicite et
// révocable (untrustSenderFn). Jamais de « tout afficher » global. L'allowlist est
// scopée à l'accountId de session — aucune valeur influençable par le client n'y entre
// hors l'adresse normalisée.
export const senderSchema = z.object({ sender: z.string().email().max(320) })

export const trustSenderFn = createServerFn({ method: "POST" })
  .validator((d: { sender: string }) => senderSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    try {
      const { addSender } = await import("./image-prefs-store")
      const { accountId } = await requireSession()
      addSender(accountId, normalizeSender(data.sender))
      return { ok: true }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("mail action failed", e)
      throw new Error("mail action failed")
    }
  })

export const untrustSenderFn = createServerFn({ method: "POST" })
  .validator((d: { sender: string }) => senderSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    try {
      const { removeSender } = await import("./image-prefs-store")
      const { accountId } = await requireSession()
      removeSender(accountId, normalizeSender(data.sender))
      return { ok: true }
    } catch (e) {
      if (isRedirect(e)) throw e
      console.error("mail action failed", e)
      throw new Error("mail action failed")
    }
  })
```

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `bun run test mail-actions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(reader): server functions afficher-images / (dé)confiance expéditeur (#70)"
```

---

## Task 5 : Bandeau `MessageItem` (variantes + callbacks) + i18n

**Files:**
- Modify: `src/components/mail/message-item.tsx`
- Modify: `src/i18n/resources.ts` (blocs `reader` fr ~330 et en ~684)
- Test: `src/components/mail/message-item.test.tsx`

**Interfaces:**
- Consumes: `AppMessage.imageDecision` (Task 1)
- Produces: `MessageItem` accepte `onShowOnce?`, `onTrustSender?`, `onUntrustSender?` et rend 3 variantes de bandeau.

- [ ] **Step 1: Ajouter les clés i18n (fr + en)**

Dans `src/i18n/resources.ts`, bloc `reader` **fr** (après `showImages: "Afficher les images",` ligne ~330) :

```ts
      trustSender: "Toujours afficher pour {{sender}}",
      imagesFromSenderShown: "Images de {{sender}} affichées automatiquement",
      blockSender: "Bloquer",
```

Bloc `reader` **en** (après `showImages: "Show images",` ligne ~684) :

```ts
      trustSender: "Always show for {{sender}}",
      imagesFromSenderShown: "Images from {{sender}} are shown automatically",
      blockSender: "Block",
```

- [ ] **Step 2: Mettre à jour les tests du bandeau**

Dans `src/components/mail/message-item.test.tsx`, **remplacer** le test existant `it("bandeau images : visible puis masqué après 'afficher les images'", …)` par les tests suivants :

```ts
  it("bandeau bloqué : boutons afficher-une-fois + faire-confiance déclenchent les callbacks", () => {
    const onShowOnce = vi.fn()
    const onTrustSender = vi.fn()
    wrap(
      <MessageItem
        message={msg({
          textBody: null,
          htmlBody: '<img src="https://t/x.png">',
          imageDecision: "blocked",
        })}
        defaultOpen
        onShowOnce={onShowOnce}
        onTrustSender={onTrustSender}
      />
    )
    expect(screen.getByText(/images distantes/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /afficher les images/i }))
    expect(onShowOnce).toHaveBeenCalledWith("e1")
    fireEvent.click(screen.getByRole("button", { name: /toujours afficher pour/i }))
    expect(onTrustSender).toHaveBeenCalledWith("bob@x.io")
  })

  it("message-allowed : pas de bandeau, images affichées", () => {
    wrap(
      <MessageItem
        message={msg({
          textBody: null,
          htmlBody: '<img src="https://t/x.png">',
          imageDecision: "message-allowed",
        })}
        defaultOpen
      />
    )
    expect(screen.queryByText(/images distantes/i)).not.toBeInTheDocument()
  })

  it("sender-allowed : note + bouton bloquer déclenche onUntrustSender", () => {
    const onUntrustSender = vi.fn()
    wrap(
      <MessageItem
        message={msg({
          textBody: null,
          htmlBody: '<img src="https://t/x.png">',
          imageDecision: "sender-allowed",
        })}
        defaultOpen
        onUntrustSender={onUntrustSender}
      />
    )
    expect(screen.getByText(/affichées automatiquement/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /bloquer/i }))
    expect(onUntrustSender).toHaveBeenCalledWith("bob@x.io")
  })
```

Et compléter l'import en tête du fichier de test :

```ts
import { describe, expect, it, vi } from "vitest"
```

- [ ] **Step 3: Lancer les tests → échec attendu**

Run: `bun run test message-item`
Expected: FAIL (props inexistantes, bandeaux non rendus).

- [ ] **Step 4: Réécrire `message-item.tsx`**

Remplacer le contenu de `src/components/mail/message-item.tsx` par :

```tsx
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Icon, Avatar } from "./mail-icons"
import { formatThreadDate } from "./format-date"
import { pickBody, buildFrameDoc, hasRemoteImages } from "./email-body"
import type { AppMessage } from "../../server/mail-types"

export function MessageItem({
  message,
  defaultOpen = false,
  onShowOnce,
  onTrustSender,
  onUntrustSender,
}: {
  message: AppMessage
  defaultOpen?: boolean
  onShowOnce?: (emailId: string) => void
  onTrustSender?: (sender: string) => void
  onUntrustSender?: (sender: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)

  // Décision d'affichage résolue côté serveur (readThreadFn). Absent → "blocked" (défaut sûr).
  const decision = message.imageDecision ?? "blocked"
  const showImages = decision !== "blocked"

  const lead = message.from.at(0)
  const leadName = lead?.name || lead?.email || "—"
  const senderEmail = lead?.email ?? ""
  const body = useMemo(() => pickBody(message), [message])
  const remote = body.kind === "html" && hasRemoteImages(body.content)
  const frameDoc = useMemo(
    () =>
      body.kind === "html" ? buildFrameDoc(body.content, { showImages }) : "",
    [body, showImages]
  )

  return (
    <div className={"msg" + (open ? "" : " collapsed")}>
      <div
        className="msg-head"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setOpen((o) => !o)
          }
        }}
      >
        <Avatar name={leadName} email={senderEmail} />
        <div className="who">
          <div className="nm">{leadName}</div>
          {open && message.to.length > 0 && (
            <div className="to">
              {t("mail.reader.to")}{" "}
              {message.to.map((r) => r.name || r.email).join(", ")}
            </div>
          )}
        </div>
        <div className="when">{formatThreadDate(message.receivedAt)}</div>
      </div>

      {open && (
        <div className="msg-body">
          {remote && decision === "blocked" && (
            <div className="img-block-banner">
              <span className="banner-note">
                {t("mail.reader.imagesBlocked")}
              </span>{" "}
              <button
                className="banner-btn"
                onClick={() => onShowOnce?.(message.id)}
              >
                {t("mail.reader.showImages")}
              </button>{" "}
              {senderEmail && (
                <button
                  className="banner-btn"
                  onClick={() => onTrustSender?.(senderEmail)}
                >
                  {t("mail.reader.trustSender", { sender: senderEmail })}
                </button>
              )}
            </div>
          )}
          {remote && decision === "sender-allowed" && senderEmail && (
            <div className="img-block-banner">
              <span className="banner-note">
                {t("mail.reader.imagesFromSenderShown", { sender: senderEmail })}
              </span>{" "}
              <button
                className="banner-btn"
                onClick={() => onUntrustSender?.(senderEmail)}
              >
                {t("mail.reader.blockSender")}
              </button>
            </div>
          )}
          {body.kind === "text" ? (
            <p style={{ whiteSpace: "pre-wrap" }}>{body.content}</p>
          ) : (
            <iframe
              className="msg-html-frame"
              title={message.subject || leadName}
              // sandbox SANS allow-scripts/allow-same-origin/allow-forms : le HTML reste
              // inerte et en origine opaque. allow-popups laisse les liens user-cliqués s'ouvrir
              // dans un nouvel onglet (base target=_blank) au lieu du reader ; -to-escape-sandbox
              // est REQUIS pour que cet onglet soit un contexte NORMAL (sinon le site externe
              // hériterait du sandbox : pas de JS, origine opaque → cassé). Revue sécu : non
              // exploitable (pas de scripts pour auto-ouvrir, rel="noopener noreferrer" coupe opener).
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={frameDoc}
            />
          )}

          {message.attachments.length > 0 && (
            <div className="attach-row">
              {message.attachments.map((a) => (
                <button
                  key={a.blobId}
                  className="attach"
                  disabled
                  aria-label={a.name}
                >
                  <div className="fi">
                    {(a.type.split("/")[1] ?? t("mail.reader.file")).slice(
                      0,
                      4
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="fn">{a.name}</div>
                    <div className="fs">
                      {Math.ceil(a.size / 1024)} {t("mail.reader.sizeKB")}
                    </div>
                  </div>
                  <Icon name="download" size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Lancer les tests → succès attendu**

Run: `bun run test message-item`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/mail/message-item.tsx src/components/mail/message-item.test.tsx src/i18n/resources.ts
git commit -m "feat(reader): bandeau images à 3 variantes + révocation inline (#70)"
```

---

## Task 6 : Hook `useImageActions` + câblage `Reader` / `ReaderPane`

**Files:**
- Create: `src/components/mail/use-image-actions.ts`
- Test: `src/components/mail/use-image-actions.test.tsx`
- Modify: `src/components/mail/index.ts` (barrel : export du hook)
- Modify: `src/components/mail/reader.tsx` (`ReaderProps` ~9-21 ; passage à `MessageItem` ~166-171)
- Modify: `src/routes/mail/$folder.tsx` (`ReaderPane` ~162-211)

**Interfaces:**
- Consumes: `showImagesOnceFn`, `trustSenderFn`, `untrustSenderFn` (Task 4) ; `normalizeSender` (Task 1)
- Produces: `useImageActions(threadId: string): { showOnce; trustSender; untrustSender }`

- [ ] **Step 1: Écrire le test du hook**

Create `src/components/mail/use-image-actions.test.tsx` :

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement } from "react"
import type { ReactNode } from "react"
import { useImageActions } from "./use-image-actions"
import type { AppThreadDetail } from "../../server/mail-types"

const showImages = vi.fn().mockResolvedValue({ ok: true })
const trust = vi.fn().mockResolvedValue({ ok: true })
const untrust = vi.fn().mockResolvedValue({ ok: true })
vi.mock("../../server/mail-actions", () => ({
  showImagesOnceFn: (a: unknown) => showImages(a),
  trustSenderFn: (a: unknown) => trust(a),
  untrustSenderFn: (a: unknown) => untrust(a),
}))
vi.mock("./toast", () => ({ useToast: () => vi.fn() }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

afterEach(() => vi.clearAllMocks())

const detail: AppThreadDetail = {
  threadId: "t1",
  subject: "s",
  emailIds: ["e1"],
  starred: false,
  unread: false,
  messages: [
    {
      id: "e1",
      messageId: null,
      from: [{ name: "Bob", email: "bob@x.io" }],
      to: [],
      cc: [],
      subject: "s",
      receivedAt: "2026-06-10T00:00:00Z",
      unread: false,
      hasAttachment: false,
      textBody: null,
      htmlBody: null,
      attachments: [],
      imageDecision: "blocked",
    },
  ],
}

function setup() {
  const qc = new QueryClient()
  qc.setQueryData(["thread", "t1"], detail)
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(() => useImageActions("t1"), { wrapper })
  return { qc, result }
}

describe("useImageActions", () => {
  it("showOnce : patch optimiste message-allowed + appelle le serveur", async () => {
    const { qc, result } = setup()
    await result.current.showOnce("e1")
    expect(showImages).toHaveBeenCalledWith({ data: { emailIds: ["e1"] } })
    const d = qc.getQueryData<AppThreadDetail>(["thread", "t1"])
    expect(d?.messages[0].imageDecision).toBe("message-allowed")
  })

  it("trustSender : patch optimiste sender-allowed sur les messages de l'expéditeur", async () => {
    const { qc, result } = setup()
    await result.current.trustSender("Bob@x.io")
    expect(trust).toHaveBeenCalledWith({ data: { sender: "Bob@x.io" } })
    const d = qc.getQueryData<AppThreadDetail>(["thread", "t1"])
    expect(d?.messages[0].imageDecision).toBe("sender-allowed")
  })

  it("untrustSender : invalide le détail (re-résolution serveur)", async () => {
    const { qc, result } = setup()
    const spy = vi.spyOn(qc, "invalidateQueries")
    await result.current.untrustSender("bob@x.io")
    expect(untrust).toHaveBeenCalledWith({ data: { sender: "bob@x.io" } })
    expect(spy).toHaveBeenCalledWith({ queryKey: ["thread", "t1"] })
  })
})
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `bun run test use-image-actions`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `use-image-actions.ts`**

Create `src/components/mail/use-image-actions.ts` :

```ts
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  showImagesOnceFn,
  trustSenderFn,
  untrustSenderFn,
} from "../../server/mail-actions"
import { normalizeSender } from "../../server/image-prefs"
import type { AppThreadDetail, ImageDecision } from "../../server/mail-types"
import { useToast } from "./toast"

export interface ImageActions {
  showOnce: (emailId: string) => Promise<void>
  trustSender: (sender: string) => Promise<void>
  untrustSender: (sender: string) => Promise<void>
}

// Mutations de persistance des images (#70), scopées au fil ouvert (detailKey).
// showOnce/trustSender : patch optimiste (relâchent toujours → le serveur confirmera).
// untrustSender : invalidation (re-résolution serveur autoritaire — un message peut aussi
// porter le keyword, donc le nouvel état n'est pas devinable sans refetch).
export function useImageActions(threadId: string): ImageActions {
  const qc = useQueryClient()
  const notify = useToast()
  const { t } = useTranslation()
  const detailKey = ["thread", threadId] as const

  function patch(pred: (m: AppThreadDetail["messages"][number]) => boolean, to: ImageDecision) {
    qc.setQueryData<AppThreadDetail>(detailKey, (d) =>
      d
        ? {
            ...d,
            messages: d.messages.map((m) =>
              pred(m) ? { ...m, imageDecision: to } : m
            ),
          }
        : d
    )
  }

  return {
    showOnce: async (emailId) => {
      await qc.cancelQueries({ queryKey: detailKey })
      patch((m) => m.id === emailId, "message-allowed")
      try {
        await showImagesOnceFn({ data: { emailIds: [emailId] } })
      } catch {
        await qc.invalidateQueries({ queryKey: detailKey })
        notify(t("mail.actions.error"), "error")
      }
    },
    trustSender: async (sender) => {
      const norm = normalizeSender(sender)
      await qc.cancelQueries({ queryKey: detailKey })
      patch((m) => normalizeSender(m.from.at(0)?.email ?? "") === norm, "sender-allowed")
      try {
        await trustSenderFn({ data: { sender } })
      } catch {
        await qc.invalidateQueries({ queryKey: detailKey })
        notify(t("mail.actions.error"), "error")
      }
    },
    untrustSender: async (sender) => {
      try {
        await untrustSenderFn({ data: { sender } })
        await qc.invalidateQueries({ queryKey: detailKey })
      } catch {
        await qc.invalidateQueries({ queryKey: detailKey })
        notify(t("mail.actions.error"), "error")
      }
    },
  }
}
```

- [ ] **Step 4: Lancer le test → succès attendu**

Run: `bun run test use-image-actions`
Expected: PASS.

- [ ] **Step 5: Ajouter les props à `Reader` et les passer à `MessageItem`**

Dans `src/components/mail/reader.tsx`, ajouter à l'interface `ReaderProps` (après `selfEmail?: string`) :

```ts
  onShowOnce?: (emailId: string) => void
  onTrustSender?: (sender: string) => void
  onUntrustSender?: (sender: string) => void
```

Ajouter ces trois noms à la déstructuration des props de `Reader({ … })`.

Puis, dans le `.map` de rendu des messages, passer les callbacks :

```tsx
              {detail.messages.map((m, i) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  defaultOpen={i === detail.messages.length - 1}
                  onShowOnce={onShowOnce}
                  onTrustSender={onTrustSender}
                  onUntrustSender={onUntrustSender}
                />
              ))}
```

- [ ] **Step 6: Câbler `useImageActions` dans `ReaderPane`**

D'abord, exporter le hook depuis le barrel `src/components/mail/index.ts` (après `export { useThreadActions } from "./use-thread-actions"`) :

```ts
export { useImageActions } from "./use-image-actions"
```

Dans `src/routes/mail/$folder.tsx`, ajouter `useImageActions` au bloc d'import existant depuis `@/components/mail` (à côté de `useThreadActions`) :

```ts
import {
  MailLayout,
  AppSidebar,
  ThreadList,
  Reader,
  ToastProvider,
  ToastViewport,
  useThreadActions,
  useImageActions,
  Composer,
  useComposer,
} from "@/components/mail"
```

Dans `ReaderPane`, après `const actions = useThreadActions(folder, threadId, detail?.emailIds ?? [])` :

```ts
  const imageActions = useImageActions(threadId)
```

Dans le JSX `<Reader … />`, ajouter après `selfEmail={accountName}` :

```tsx
      onShowOnce={(id) => void imageActions.showOnce(id)}
      onTrustSender={(s) => void imageActions.trustSender(s)}
      onUntrustSender={(s) => void imageActions.untrustSender(s)}
```

- [ ] **Step 7: Lancer toute la suite → succès attendu**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS (lint + typecheck + tous les tests).

- [ ] **Step 8: Commit**

```bash
git add src/components/mail/use-image-actions.ts src/components/mail/use-image-actions.test.tsx src/components/mail/index.ts src/components/mail/reader.tsx src/routes/mail/$folder.tsx
git commit -m "feat(reader): câble les mutations de persistance des images au lecteur (#70)"
```

---

## Task 7 : Durcissement CSP — retrait de `http:` de la variante consentie

**Files:**
- Modify: `src/components/mail/email-body.ts:9-12` (`frameCsp`)
- Test: `src/components/mail/email-body.test.ts:126-131`

**Interfaces:**
- Consumes: rien (indépendante des tasks 1-6 ; peut s'exécuter à tout moment)
- Produces: `frameCsp(true)` renvoie `img-src data: cid: https:` (plus de `http:`)

Contexte (revue sécu, spec §8) : un traceur chargé en `http:` clair expose l'ouverture du mail (et l'URL cible) à tout intermédiaire réseau, en plus du mixed content. Les rares images http-only ne se chargeront plus — défaut sûr, aligné sur les clients mail modernes.

- [ ] **Step 1: Mettre à jour le test existant**

Dans `src/components/mail/email-body.test.ts`, remplacer le test `it("élargit la CSP img-src aux schémas distants quand showImages=true", …)` (ligne ~126) : l'assertion `expect(on).toContain("img-src data: cid: https: http:;")` devient :

```ts
    expect(on).toContain("img-src data: cid: https:;")
    expect(on).not.toContain("http:;") // jamais de traceur en clair, même consenti
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `bun run test email-body`
Expected: FAIL (la CSP contient encore `http:`).

- [ ] **Step 3: Durcir `frameCsp`**

Dans `src/components/mail/email-body.ts`, remplacer :

```ts
  const imgSrc = showImages ? "data: cid: https: http:" : "data: cid:"
```

par :

```ts
  // https: seulement (pas http:) : un traceur en clair exposerait l'ouverture du mail
  // à tout intermédiaire réseau (revue sécu #70). Les images http-only ne se chargent pas.
  const imgSrc = showImages ? "data: cid: https:" : "data: cid:"
```

- [ ] **Step 4: Lancer le test → succès attendu**

Run: `bun run test email-body`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/email-body.ts src/components/mail/email-body.test.ts
git commit -m "fix(reader): retire http: de la CSP images consentie (traceurs en clair) (#70)"
```

---

## Vérification finale

- [ ] **Test manuel de non-régression (#70) :**
  1. Ouvrir un mail HTML à image distante → bandeau « Images distantes bloquées · Afficher les images · Toujours afficher pour {expéditeur} ».
  2. Cliquer « Afficher les images » → images affichées.
  3. **Recharger la page** → les images restent affichées (keyword `stalmail_showimages` persistant). ✅ (bug #70 corrigé)
  4. Sur un autre mail du même expéditeur, cliquer « Toujours afficher pour {expéditeur} » → bandeau « Images de {expéditeur} affichées automatiquement · Bloquer ».
  5. Recharger → images de cet expéditeur affichées d'office.
  6. Cliquer « Bloquer » → l'expéditeur repasse bloqué au prochain chargement.
- [ ] Confirmer que la CSP par défaut reste `img-src data: cid:` tant qu'aucun consentement (inspecter le `srcDoc` de l'iframe d'un mail non consenti).
- [ ] Confirmer que la CSP consentie est `img-src data: cid: https:` (sans `http:`) sur un mail affiché (Task 7).

---

## Notes de couverture (auto-revue plan ↔ spec)

- Spec §3.2 (keyword) → Tasks 3, 4. §3.3 (store + cap) → Task 2. §3.4 (résolution serveur) → Task 3. §3.5 (révocation inline) → Tasks 5, 6. §3.6 (présentationnel) → Task 5. §4 (fonctions pures) → Task 1. §5 (types) → Task 1. §6 (server functions + schémas Zod testés) → Tasks 3, 4. §7 (UI) → Tasks 5, 6. §8 (sécurité, dont durcissement CSP) → commentaires Tasks 4, 5 + Task 7 + vérif finale. §9 (tests) → chaque task. §10 (i18n) → Task 5.
- Risque résiduel « From usurpé » (spec §8) : accepté et documenté ici ; le gating DMARC est hors périmètre → **issue de suivi à ouvrir** au moment de la PR.
- Hors périmètre (spec §11) : page settings, allowlist par domaine, réglage global — non traités, conforme.
- `deleteAllForAccount` (Task 2) est fourni + testé mais non câblé (purge future à la suppression de compte) — volontaire.
