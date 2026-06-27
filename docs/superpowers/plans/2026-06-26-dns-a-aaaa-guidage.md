# Guidage A/AAAA dans l'étape DNS — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guider l'opérateur à créer les enregistrements A/AAAA (hostname + apex → IP du serveur) à l'étape DNS du wizard, pré-remplis via un écho IP côté BFF et vérifiés en live, sans jamais écrire chez un fournisseur.

**Architecture:** Stalwart ne publie jamais A/AAAA → leur valeur attendue est une source Stalmail (écho IP), distincte du `dnsZoneFile`. Un flux parallèle (`discoverServerIpFn` + `hostAddressStatusFn`) alimente une section « Adresse du serveur » affichée dans les deux modes (Manuel et Automatique). Le cœur logique vit dans des fonctions pures testées (`isIpv4/isIpv6`, `parseEchoResponse`, `buildHostRecords`, résolution A/AAAA).

**Tech Stack:** TanStack Start (server functions BFF), React 19, Zod, vitest, react-i18next, Node `dns/promises`, Bun.

## Global Constraints

- Gestionnaire de paquets : **Bun** uniquement (`bun install`, `bun run test`, `bunx vitest`). Jamais npm/yarn/pnpm.
- Toute entrée de server function validée par **Zod**.
- Aucun secret côté client ; pas d'opération JMAP générique exposée.
- **i18n** : tout libellé via clés `t('...')`, valeurs en **français** (et miroir anglais dans `resources.ts`). Jamais de texte en dur.
- **Fonctions pures extraites et testées isolément** ; composants présentationnels à props injectées.
- Pre-commit (`lint && typecheck && test`) ne doit pas être contourné. Commits conventionnels (`feat:`, `test:`, etc.), jamais de bump de version manuel.
- Branche de travail : `feat/dns-a-aaaa-guidage` (déjà créée, la spec y est committée).
- Service d'écho : un seul par famille (pas de cascade — choix de cadrage), surchargeable par env `STALMAIL_IP_ECHO_URL` (IPv4) et `STALMAIL_IP_ECHO_URL_V6` (IPv6). Fallback = saisie manuelle.

---

## File Structure

- `src/lib/ip.ts` (créer) — `isIpv4`, `isIpv6` purs, partagés client + serveur.
- `src/server/server-ip.ts` (créer) — `parseEchoResponse` (pur), `discoverServerIp` (écho sortant).
- `src/server/dns-host-records.ts` (créer) — `buildHostRecords` (pur).
- `src/server/dns-resolve.ts` (modifier) — support A/AAAA.
- `src/server/setup-actions.ts` (modifier) — `discoverServerIpFn`, `hostAddressStatusFn`.
- `src/routes/setup/index.tsx` + `src/components/setup/SetupWizard.tsx` (modifier) — câblage des deux server functions.
- `src/i18n/resources.ts` (modifier) — bloc `wizard.dns.hostAddress.*` (fr + en).
- `src/components/setup/steps/HostAddressSection.tsx` (créer) — composant présentationnel.
- `src/components/setup/steps/DnsStep.tsx` (modifier) — intégration (découverte IP + section + polling).

---

## Task 1: Validateurs IP partagés (`src/lib/ip.ts`)

**Files:**
- Create: `src/lib/ip.ts`
- Test: `src/lib/ip.test.ts`

**Interfaces:**
- Produces: `isIpv4(s: string): boolean`, `isIpv6(s: string): boolean`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/lib/ip.test.ts
import { describe, it, expect } from "vitest"
import { isIpv4, isIpv6 } from "./ip"

describe("isIpv4", () => {
  it("accepte une IPv4 valide", () => expect(isIpv4("203.0.113.4")).toBe(true))
  it("rejette un octet > 255", () => expect(isIpv4("256.0.0.1")).toBe(false))
  it("rejette une chaîne non IPv4", () => expect(isIpv4("hello")).toBe(false))
  it("rejette une IPv6 comme IPv4", () =>
    expect(isIpv4("2001:db8::1")).toBe(false))
})

describe("isIpv6", () => {
  it("accepte une IPv6 compressée", () =>
    expect(isIpv6("2001:db8::1")).toBe(true))
  it("accepte une IPv6 pleine", () =>
    expect(isIpv6("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(true))
  it("rejette une IPv4 comme IPv6", () => expect(isIpv6("203.0.113.4")).toBe(false))
  it("rejette du bruit", () => expect(isIpv6("nope")).toBe(false))
})
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `bunx vitest run src/lib/ip.test.ts`
Expected: FAIL — `isIpv4`/`isIpv6` introuvables.

- [ ] **Step 3: Implémenter**

```ts
// src/lib/ip.ts
// Validateurs IP purs partagés (wizard client + BFF). Volontairement pragmatiques :
// la vérification DNS live confirme de toute façon la valeur réelle.

/** IPv4 stricte : 4 octets 0–255. */
export function isIpv4(s: string): boolean {
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  return m.slice(1).every((o) => {
    const n = Number(o)
    return n >= 0 && n <= 255 && String(n) === String(Number(o))
  })
}

/** IPv6 : hex groups séparés par ':', avec compression '::' tolérée. Pas une validation
 * RFC complète — exclut simplement l'IPv4 et le bruit évident. */
export function isIpv6(s: string): boolean {
  const v = s.trim()
  if (!v.includes(":")) return false
  if (!/^[0-9a-fA-F:]+$/.test(v)) return false
  // au plus une compression '::'
  if ((v.match(/::/g) ?? []).length > 1) return false
  return true
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `bunx vitest run src/lib/ip.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ip.ts src/lib/ip.test.ts
git commit -m "feat(setup): validateurs IP partagés isIpv4/isIpv6 (#61)"
```

---

## Task 2: Découverte de l'IP publique (`src/server/server-ip.ts`)

**Files:**
- Create: `src/server/server-ip.ts`
- Test: `src/server/server-ip.test.ts`

**Interfaces:**
- Consumes: `isIpv4`, `isIpv6` from `@/lib/ip`
- Produces:
  - `parseEchoResponse(text: string, family: 4 | 6): string | null`
  - `discoverServerIp(): Promise<{ ipv4: string | null; ipv6: string | null }>`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/server/server-ip.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { parseEchoResponse, discoverServerIp } from "./server-ip"

describe("parseEchoResponse", () => {
  it("extrait une IPv4 nue (ipify)", () =>
    expect(parseEchoResponse("203.0.113.4", 4)).toBe("203.0.113.4"))
  it("extrait une IPv4 d'une ligne trace 'ip=' (Cloudflare)", () =>
    expect(parseEchoResponse("fl=1\nip=203.0.113.4\nts=…", 4)).toBe(
      "203.0.113.4"
    ))
  it("extrait et minuscule une IPv6", () =>
    expect(parseEchoResponse("2001:DB8::1", 6)).toBe("2001:db8::1"))
  it("renvoie null si aucune IP de la famille demandée", () =>
    expect(parseEchoResponse("203.0.113.4", 6)).toBeNull())
  it("renvoie null sur du bruit", () =>
    expect(parseEchoResponse("error: blocked", 4)).toBeNull())
})

describe("discoverServerIp", () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it("renvoie ipv4 et ipv6 quand les deux échos répondent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(url.includes("api6") ? "2001:db8::1" : "203.0.113.4")
      )
    )
    expect(await discoverServerIp()).toEqual({
      ipv4: "203.0.113.4",
      ipv6: "2001:db8::1",
    })
  })

  it("renvoie {null,null} quand l'écho échoue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down")
      })
    )
    expect(await discoverServerIp()).toEqual({ ipv4: null, ipv6: null })
  })

  it("renvoie null pour une réponse HTTP non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    )
    expect(await discoverServerIp()).toEqual({ ipv4: null, ipv6: null })
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `bunx vitest run src/server/server-ip.test.ts`
Expected: FAIL — module/fonctions introuvables.

- [ ] **Step 3: Implémenter**

```ts
// src/server/server-ip.ts
// Découverte de l'IP publique du serveur via un service d'écho (appel sortant).
// Stalwart ne publiant jamais les A/AAAA, c'est la seule source pour pré-remplir le
// guidage A/AAAA du wizard. Aucun secret, lecture seule. Échec → null (fallback saisie
// manuelle côté UI). Un seul service par famille (pas de cascade), surchargeable par env.
import { isIpv4, isIpv6 } from "@/lib/ip"

/** Extrait l'IP de la famille demandée d'une réponse d'écho (IP nue ou ligne 'clé=valeur'). */
export function parseEchoResponse(text: string, family: 4 | 6): string | null {
  const valid = family === 4 ? isIpv4 : isIpv6
  for (const raw of text.split(/\s+/)) {
    const token = raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : raw
    if (valid(token)) return family === 6 ? token.trim().toLowerCase() : token.trim()
  }
  return null
}

async function fetchEcho(url: string, family: 4 | 6): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    return parseEchoResponse(await res.text(), family)
  } catch {
    return null
  }
}

export async function discoverServerIp(): Promise<{
  ipv4: string | null
  ipv6: string | null
}> {
  const v4 = process.env.STALMAIL_IP_ECHO_URL ?? "https://api.ipify.org"
  const v6 = process.env.STALMAIL_IP_ECHO_URL_V6 ?? "https://api6.ipify.org"
  const [ipv4, ipv6] = await Promise.all([fetchEcho(v4, 4), fetchEcho(v6, 6)])
  return { ipv4, ipv6 }
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `bunx vitest run src/server/server-ip.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/server-ip.ts src/server/server-ip.test.ts
git commit -m "feat(setup): découverte de l'IP publique via écho (#61)"
```

---

## Task 3: Construction des enregistrements attendus (`src/server/dns-host-records.ts`)

**Files:**
- Create: `src/server/dns-host-records.ts`
- Test: `src/server/dns-host-records.test.ts`

**Interfaces:**
- Consumes: `ZoneRecord` from `./dns-zone` (`{ name: string; type: string; value: string }`)
- Produces: `buildHostRecords(input: { hostname: string; domain: string; ipv4: string | null; ipv6: string | null }): ZoneRecord[]`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/server/dns-host-records.test.ts
import { describe, it, expect } from "vitest"
import { buildHostRecords } from "./dns-host-records"

describe("buildHostRecords", () => {
  it("produit A pour le hostname et l'apex quand ils diffèrent", () => {
    expect(
      buildHostRecords({
        hostname: "mail.exemple.fr",
        domain: "exemple.fr",
        ipv4: "203.0.113.4",
        ipv6: null,
      })
    ).toEqual([
      { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4" },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4" },
    ])
  })

  it("ajoute AAAA seulement si une IPv6 est fournie", () => {
    const recs = buildHostRecords({
      hostname: "mail.exemple.fr",
      domain: "exemple.fr",
      ipv4: "203.0.113.4",
      ipv6: "2001:db8::1",
    })
    expect(recs).toEqual([
      { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4" },
      { name: "mail.exemple.fr.", type: "AAAA", value: "2001:db8::1" },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4" },
      { name: "exemple.fr.", type: "AAAA", value: "2001:db8::1" },
    ])
  })

  it("ne produit qu'une cible quand hostname === domain (apex)", () => {
    expect(
      buildHostRecords({
        hostname: "exemple.fr",
        domain: "exemple.fr",
        ipv4: "203.0.113.4",
        ipv6: null,
      })
    ).toEqual([{ name: "exemple.fr.", type: "A", value: "203.0.113.4" }])
  })

  it("renvoie un tableau vide si aucune IP", () => {
    expect(
      buildHostRecords({
        hostname: "mail.exemple.fr",
        domain: "exemple.fr",
        ipv4: null,
        ipv6: null,
      })
    ).toEqual([])
  })

  it("ignore un hostname vide et garde l'apex", () => {
    expect(
      buildHostRecords({
        hostname: "",
        domain: "exemple.fr",
        ipv4: "203.0.113.4",
        ipv6: null,
      })
    ).toEqual([{ name: "exemple.fr.", type: "A", value: "203.0.113.4" }])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `bunx vitest run src/server/dns-host-records.test.ts`
Expected: FAIL — `buildHostRecords` introuvable.

- [ ] **Step 3: Implémenter**

```ts
// src/server/dns-host-records.ts
// Construit les A/AAAA attendus (hostname + apex) à partir de l'IP découverte. Pur, testé.
// La valeur de ces enregistrements ne vient PAS de Stalwart (qui ne publie jamais A/AAAA)
// mais de l'écho IP — d'où ce module dédié, parallèle à parseZoneFile.
import type { ZoneRecord } from "./dns-zone"

const normName = (h: string) => h.trim().toLowerCase().replace(/\.$/, "")

export function buildHostRecords(input: {
  hostname: string
  domain: string
  ipv4: string | null
  ipv6: string | null
}): ZoneRecord[] {
  const { ipv4, ipv6 } = input
  const host = normName(input.hostname)
  const base = normName(input.domain)
  const names: string[] = []
  if (host) names.push(host)
  if (base && base !== host) names.push(base)

  const records: ZoneRecord[] = []
  for (const n of names) {
    if (ipv4) records.push({ name: n + ".", type: "A", value: ipv4 })
    if (ipv6) records.push({ name: n + ".", type: "AAAA", value: ipv6 })
  }
  return records
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `bunx vitest run src/server/dns-host-records.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/dns-host-records.ts src/server/dns-host-records.test.ts
git commit -m "feat(setup): builder pur des A/AAAA attendus (#61)"
```

---

## Task 4: Résolution A/AAAA dans `dns-resolve.ts`

**Files:**
- Modify: `src/server/dns-resolve.ts:1-10` (imports) et `:53-72` (branche A/AAAA avant le `return "unsupported"`)
- Test: `src/server/dns-resolve.test.ts` (ajouts + correction du cas « unsupported »)

**Interfaces:**
- Consumes: `ZoneRecord` (inchangé). `resolveRecordStatus` garde sa signature `(record: ZoneRecord) => Promise<RecordStatus>`.
- Produces: `resolveRecordStatus` gère désormais `type === "A"` et `type === "AAAA"`.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/server/dns-resolve.test.ts`, ajouter `resolve4`/`resolve6` aux mocks (haut du fichier) :

```ts
const resolve4 = vi.fn()
const resolve6 = vi.fn()
```

et dans l'objet `vi.mock("node:dns/promises", () => ({ ... }))` ajouter :

```ts
  resolve4: (...a: unknown[]) => resolve4(...a),
  resolve6: (...a: unknown[]) => resolve6(...a),
```

Remplacer le test existant « returns "unsupported" for record types other than TXT/MX » (il utilise `type: "A"`, désormais supporté) par un type réellement non géré :

```ts
  it('returns "unsupported" for record types other than the handled ones', async () => {
    const s = await resolveRecordStatus({
      name: "exemple.fr.",
      type: "NS",
      value: "ns1.exemple.fr.",
    })
    expect(s).toBe("unsupported")
  })
```

Ajouter les cas A/AAAA à la fin du `describe` :

```ts
  it('A: "verified" quand l\'IPv4 résolue correspond', async () => {
    resolve4.mockResolvedValue(["203.0.113.4"])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
    })
    expect(s).toBe("verified")
  })

  it('A: "mismatch" quand l\'IPv4 résolue diffère', async () => {
    resolve4.mockResolvedValue(["198.51.100.9"])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
    })
    expect(s).toBe("mismatch")
  })

  it('A: "missing" quand aucune IPv4 ne résout', async () => {
    resolve4.mockResolvedValue([])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
    })
    expect(s).toBe("missing")
  })

  it('A: "missing" sur ENOTFOUND', async () => {
    resolve4.mockRejectedValue(
      Object.assign(new Error("nf"), { code: "ENOTFOUND" })
    )
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
    })
    expect(s).toBe("missing")
  })

  it('AAAA: "verified" en comparant insensible à la casse', async () => {
    resolve6.mockResolvedValue(["2001:db8::1"])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "AAAA",
      value: "2001:DB8::1",
    })
    expect(s).toBe("verified")
  })

  it('AAAA: "mismatch" quand l\'IPv6 diffère', async () => {
    resolve6.mockResolvedValue(["2001:db8::2"])
    const s = await resolveRecordStatus({
      name: "mail.exemple.fr.",
      type: "AAAA",
      value: "2001:db8::1",
    })
    expect(s).toBe("mismatch")
  })
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `bunx vitest run src/server/dns-resolve.test.ts`
Expected: FAIL — A renvoie encore `"unsupported"` (les nouveaux cas échouent).

- [ ] **Step 3: Implémenter**

Dans `src/server/dns-resolve.ts`, ajouter `resolve4, resolve6` à l'import :

```ts
import {
  resolveTxt,
  resolveMx,
  resolveSrv,
  resolveCaa,
  resolveCname,
  resolve4,
  resolve6,
} from "node:dns/promises"
```

Juste avant `return "unsupported"` (actuellement ligne 72), insérer la branche A/AAAA :

```ts
    if (record.type === "A" || record.type === "AAAA") {
      // Valeur attendue = l'IP fournie par l'écho (pas issue du dnsZoneFile).
      const want = record.value.trim().toLowerCase()
      const addrs =
        record.type === "A" ? await resolve4(host) : await resolve6(host)
      const norm = addrs.map((a) => a.trim().toLowerCase())
      if (norm.includes(want)) return "verified"
      return norm.length ? "mismatch" : "missing"
    }
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `bunx vitest run src/server/dns-resolve.test.ts`
Expected: PASS (tous, incluant les 6 nouveaux et le cas « unsupported » corrigé).

- [ ] **Step 5: Commit**

```bash
git add src/server/dns-resolve.ts src/server/dns-resolve.test.ts
git commit -m "feat(setup): vérification DNS live des A/AAAA (#61)"
```

---

## Task 5: Server functions `discoverServerIpFn` + `hostAddressStatusFn`

**Files:**
- Modify: `src/server/setup-actions.ts` (ajouts ; static import `@/lib/ip` ; nouvelles fns près de `dnsGridStatusFn`)

**Interfaces:**
- Consumes: `buildHostRecords` (Task 3), `resolveRecordStatus` (Task 4), `discoverServerIp` (Task 2), `isIpv4`/`isIpv6` (Task 1), `resolveServerHostname` (existant, exporté), `getPrimaryDomain` (existant), `DnsGridRecord` (existant).
- Produces:
  - `discoverServerIpFn(): Promise<{ ipv4: string | null; ipv6: string | null }>`
  - `hostAddressStatusFn(input: { data: { ipv4?: string; ipv6?: string } }): Promise<{ records: DnsGridRecord[] }>`

> Note threading (Task 8 en dépend) : ces deux server functions sont câblées route → SetupWizard → DnsStep.
> `hostAddressStatusFn` résout `hostname`/`domain` **côté serveur** (autoritatif) ; le client ne fournit que l'IP (issue de l'écho ou de la saisie), re-validée par `isIpv4`/`isIpv6`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/server/setup-actions-host.test.ts` (teste le handler isolément, en mockant les imports dynamiques) :

```ts
// src/server/setup-actions-host.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./stalwart-domain", () => ({
  getPrimaryDomain: vi.fn(async () => ({ id: "d1", name: "exemple.fr" })),
}))
vi.mock("./dns-resolve", () => ({
  resolveRecordStatus: vi.fn(async () => "verified"),
}))

import { hostAddressStatusHandler } from "./setup-actions"

beforeEach(() => vi.clearAllMocks())

describe("hostAddressStatusHandler", () => {
  it("construit les A attendus et renvoie leur statut", async () => {
    const res = await hostAddressStatusHandler({
      data: { ipv4: "203.0.113.4" },
    })
    expect(res.records).toContainEqual({
      name: "exemple.fr.",
      type: "A",
      value: "203.0.113.4",
      status: "verified",
    })
  })

  it("ignore une IP syntaxiquement invalide → aucun record", async () => {
    const res = await hostAddressStatusHandler({
      data: { ipv4: "not-an-ip" },
    })
    expect(res.records).toEqual([])
  })
})
```

(Le test n'appelle pas `discoverServerIpFn` — l'écho sortant est couvert au Task 2.)

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `bunx vitest run src/server/setup-actions-host.test.ts`
Expected: FAIL — `hostAddressStatusHandler` introuvable.

- [ ] **Step 3: Implémenter**

En haut de `src/server/setup-actions.ts`, ajouter l'import pur (sûr pour le bundle client) :

```ts
import { isIpv4, isIpv6 } from "@/lib/ip"
```

Après `dnsGridStatusFn` (≈ ligne 232), ajouter handlers + server functions :

```ts
export async function discoverServerIpHandler(): Promise<{
  ipv4: string | null
  ipv6: string | null
}> {
  const { discoverServerIp } = await import("./server-ip")
  try {
    return await discoverServerIp()
  } catch {
    return { ipv4: null, ipv6: null }
  }
}

export async function hostAddressStatusHandler({
  data,
}: {
  data: { ipv4?: string; ipv6?: string }
}): Promise<{ records: DnsGridRecord[] }> {
  const { getPrimaryDomain } = await import("./stalwart-domain")
  const { buildHostRecords } = await import("./dns-host-records")
  const { resolveRecordStatus } = await import("./dns-resolve")
  const domain = await getPrimaryDomain()
  if (!domain) return { records: [] }
  const ipv4 = data.ipv4 && isIpv4(data.ipv4) ? data.ipv4 : null
  const ipv6 = data.ipv6 && isIpv6(data.ipv6) ? data.ipv6 : null
  const hostname = resolveServerHostname(
    process.env.STALMAIL_PUBLIC_URL,
    domain.name
  )
  const expected = buildHostRecords({
    hostname,
    domain: domain.name,
    ipv4,
    ipv6,
  })
  const records = await Promise.all(
    expected.map(async (r) => {
      const raw = await resolveRecordStatus(r)
      const status: DnsGridRecord["status"] =
        raw === "verified" ? "verified" : raw === "mismatch" ? "error" : "pending"
      return { name: r.name, type: r.type, value: r.value, status }
    })
  )
  return { records }
}

export const hostAddressInputSchema = z.object({
  ipv4: z.string().max(45).optional(),
  ipv6: z.string().max(45).optional(),
})

export const discoverServerIpFn = createServerFn({ method: "GET" }).handler(
  discoverServerIpHandler
)
export const hostAddressStatusFn = createServerFn({ method: "POST" })
  .validator((d: { ipv4?: string; ipv6?: string }) =>
    hostAddressInputSchema.parse(d)
  )
  .handler(hostAddressStatusHandler)
```

- [ ] **Step 4: Lancer les tests + typecheck**

Run: `bunx vitest run src/server/setup-actions-host.test.ts && bun run typecheck`
Expected: PASS (2 tests) ; typecheck OK.

- [ ] **Step 5: Commit**

```bash
git add src/server/setup-actions.ts src/server/setup-actions-host.test.ts
git commit -m "feat(setup): server functions discoverServerIp + hostAddressStatus (#61)"
```

---

## Task 6: Libellés i18n `wizard.dns.hostAddress.*` (fr + en)

**Files:**
- Modify: `src/i18n/resources.ts` (bloc `dns.records` français ≈ ligne 137, et son miroir anglais ≈ ligne 444)

**Interfaces:**
- Produces: clés `wizard.dns.hostAddress.{title,hint,discovering,echoFailed,manualLabel,manualHelp,manualInvalid,apexNote}` en fr et en.

- [ ] **Step 1: Ajouter le bloc français**

Dans l'objet `dns:` français, juste après la clé `records: { … }` (après sa `}` fermante, ligne ≈ 137), ajouter une clé sœur :

```ts
      hostAddress: {
        title: "Adresse du serveur",
        hint: "Ces enregistrements font pointer votre domaine vers l'IP du serveur. Stalwart ne peut pas les publier — créez-les chez votre fournisseur DNS.",
        discovering: "Détection de l'adresse IP du serveur…",
        echoFailed:
          "Impossible de détecter automatiquement l'IP du serveur. Saisissez-la ci-dessous.",
        manualLabel: "Adresse IP du serveur",
        manualHelp: "IPv4 ou IPv6 publique de ce serveur.",
        manualInvalid: "Adresse IP invalide.",
        manualSubmit: "Valider",
        apexNote:
          "{{name}} est hors de la zone {{domain}} — créez cet enregistrement chez le gestionnaire de cette zone.",
      },
```

- [ ] **Step 2: Ajouter le miroir anglais**

Dans l'objet `dns:` anglais, après son `records: { … }` (ligne ≈ 444), ajouter :

```ts
      hostAddress: {
        title: "Server address",
        hint: "These records point your domain at the server's IP. Stalwart cannot publish them — create them at your DNS provider.",
        discovering: "Detecting the server's IP address…",
        echoFailed:
          "Could not detect the server IP automatically. Enter it below.",
        manualLabel: "Server IP address",
        manualHelp: "Public IPv4 or IPv6 of this server.",
        manualInvalid: "Invalid IP address.",
        manualSubmit: "Confirm",
        apexNote:
          "{{name}} is outside the {{domain}} zone — create this record at that zone's manager.",
      },
```

- [ ] **Step 3: Vérifier typecheck (parité des clés fr/en)**

Run: `bun run typecheck`
Expected: OK (le type des ressources exige la même forme fr/en).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/resources.ts
git commit -m "feat(i18n): libellés section adresse du serveur (#61)"
```

---

## Task 7: Composant présentationnel `HostAddressSection`

**Files:**
- Create: `src/components/setup/steps/HostAddressSection.tsx`
- Test: `src/components/setup/steps/HostAddressSection.test.tsx`

**Interfaces:**
- Consumes: `DnsGridRecord` from `@/server/setup-actions`, `isIpv4`/`isIpv6` from `@/lib/ip`, `isExternalHost` from `../host-utils`, primitives existantes (`StatusBadge`, `CopyIconBtn` de `../ui/monitor-primitives` ; `Alert`, `Spinner`, `Field`, `TextInput` de `../ui/primitives`).
- Produces:
  ```ts
  interface HostAddressSectionProps {
    records: DnsGridRecord[]
    status: "loading" | "ready" | "failed"
    domain: string
    onManualIp: (ip: string) => void
  }
  export function HostAddressSection(props: HostAddressSectionProps): JSX.Element
  ```

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// src/components/setup/steps/HostAddressSection.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import type { DnsGridRecord } from "@/server/setup-actions"
import { HostAddressSection } from "./HostAddressSection"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

const recs: DnsGridRecord[] = [
  { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4", status: "pending" },
  { name: "exemple.fr.", type: "A", value: "203.0.113.4", status: "verified" },
]

describe("HostAddressSection", () => {
  it("affiche le titre et les enregistrements A en mode ready", () => {
    wrap(
      <HostAddressSection
        records={recs}
        status="ready"
        domain="exemple.fr"
        onManualIp={vi.fn()}
      />
    )
    expect(screen.getByText("Adresse du serveur")).toBeInTheDocument()
    expect(screen.getAllByText("203.0.113.4").length).toBeGreaterThan(0)
  })

  it("affiche un spinner pendant la détection (loading)", () => {
    wrap(
      <HostAddressSection
        records={[]}
        status="loading"
        domain="exemple.fr"
        onManualIp={vi.fn()}
      />
    )
    expect(
      screen.getByText(/Détection de l'adresse IP/)
    ).toBeInTheDocument()
  })

  it("en échec : saisir une IP valide appelle onManualIp", () => {
    const onManualIp = vi.fn()
    wrap(
      <HostAddressSection
        records={[]}
        status="failed"
        domain="exemple.fr"
        onManualIp={onManualIp}
      />
    )
    fireEvent.change(screen.getByLabelText("Adresse IP du serveur"), {
      target: { value: "203.0.113.4" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Valider" }))
    expect(onManualIp).toHaveBeenCalledWith("203.0.113.4")
  })

  it("en échec : une IP invalide affiche une erreur et n'appelle pas onManualIp", () => {
    const onManualIp = vi.fn()
    wrap(
      <HostAddressSection
        records={[]}
        status="failed"
        domain="exemple.fr"
        onManualIp={onManualIp}
      />
    )
    fireEvent.change(screen.getByLabelText("Adresse IP du serveur"), {
      target: { value: "nope" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Valider" }))
    expect(onManualIp).not.toHaveBeenCalled()
    expect(screen.getByText("Adresse IP invalide.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `bunx vitest run src/components/setup/steps/HostAddressSection.test.tsx`
Expected: FAIL — composant introuvable.

- [ ] **Step 3: Implémenter**

```tsx
// src/components/setup/steps/HostAddressSection.tsx
// Section "Adresse du serveur" du wizard DNS : guide la création des A/AAAA (hostname +
// apex → IP du serveur), que Stalwart ne publie jamais. Présentationnel, props injectées.
// Affichée dans les deux modes (manuel/auto). En échec de l'écho IP : champ de saisie.
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { isIpv4, isIpv6 } from "@/lib/ip"
import type { DnsGridRecord } from "@/server/setup-actions"
import { isExternalHost } from "../host-utils"
import { Alert, Field, Spinner, TextInput } from "../ui/primitives"
import { StatusBadge, CopyIconBtn } from "../ui/monitor-primitives"

interface HostAddressSectionProps {
  records: DnsGridRecord[]
  status: "loading" | "ready" | "failed"
  domain: string
  onManualIp: (ip: string) => void
}

export function HostAddressSection({
  records,
  status,
  domain,
  onManualIp,
}: HostAddressSectionProps) {
  const { t } = useTranslation()
  const [ip, setIp] = useState("")
  const [invalid, setInvalid] = useState(false)

  const statusLabels = {
    verified: t("wizard.recordStatus.verified"),
    pending: t("wizard.recordStatus.pending"),
    error: t("wizard.recordStatus.error"),
  }
  const copyLabel = t("wizard.common.copy")
  const copiedLabel = t("wizard.common.copied")

  const submit = () => {
    const v = ip.trim()
    if (isIpv4(v) || isIpv6(v)) {
      setInvalid(false)
      onManualIp(v)
    } else {
      setInvalid(true)
    }
  }

  return (
    <section className="host-address">
      <div className="dns-sect-line">
        <span className="dns-sect-title">{t("wizard.dns.hostAddress.title")}</span>
        <span className="dns-sect-desc">{t("wizard.dns.hostAddress.hint")}</span>
      </div>

      {status === "loading" ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t("wizard.dns.hostAddress.discovering")}
        </p>
      ) : null}

      {status === "failed" ? (
        <>
          <Alert variant="warning">
            {t("wizard.dns.hostAddress.echoFailed")}
          </Alert>
          <Field
            label={t("wizard.dns.hostAddress.manualLabel")}
            htmlFor="host-ip"
            help={t("wizard.dns.hostAddress.manualHelp")}
            error={invalid ? t("wizard.dns.hostAddress.manualInvalid") : undefined}
          >
            <TextInput
              id="host-ip"
              mono
              value={ip}
              invalid={invalid}
              onChange={(v) => setIp(v)}
            />
          </Field>
          <button type="button" className="btn" onClick={submit}>
            {t("wizard.dns.hostAddress.manualSubmit")}
          </button>
        </>
      ) : null}

      {records.length > 0 ? (
        <div className="dns-table-wrap">
          <table className="dns-table">
            <tbody>
              {records.map((r, i) => {
                const ext = isExternalHost(r.name.replace(/\.$/, ""), domain)
                return (
                  <tr
                    key={r.type + "-" + i}
                    className={r.status === "error" ? "row-error" : ""}
                  >
                    <td>
                      <span className="rec-type mono">{r.type}</span>
                    </td>
                    <td className="rec-name-cell">
                      <span className="cell-copy">
                        <CopyIconBtn
                          text={r.name}
                          copyLabel={copyLabel}
                          copiedLabel={copiedLabel}
                        />
                        <span className="mono cell-text" title={r.name}>
                          {r.name}
                        </span>
                      </span>
                    </td>
                    <td className="rec-value-cell">
                      <span className="cell-copy">
                        <CopyIconBtn
                          text={r.value}
                          copyLabel={copyLabel}
                          copiedLabel={copiedLabel}
                        />
                        <span className="mono cell-text" title={r.value}>
                          {r.value}
                        </span>
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <StatusBadge status={r.status} labels={statusLabels} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {records.some((r) =>
            isExternalHost(r.name.replace(/\.$/, ""), domain)
          ) ? (
            <Alert variant="info">
              {t("wizard.dns.hostAddress.apexNote", {
                name: records.find((r) =>
                  isExternalHost(r.name.replace(/\.$/, ""), domain)
                )?.name,
                domain,
              })}
            </Alert>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
```

> Note : le bouton utilise `wizard.dns.hostAddress.manualSubmit` (ajouté au Task 6 : « Valider » / « Confirm »). Le test attend donc le bouton « Valider ».

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `bunx vitest run src/components/setup/steps/HostAddressSection.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/steps/HostAddressSection.tsx src/components/setup/steps/HostAddressSection.test.tsx
git commit -m "feat(setup): composant section adresse du serveur (#61)"
```

---

## Task 8: Intégration dans `DnsStep` + câblage (route, SetupWizard)

**Files:**
- Modify: `src/components/setup/steps/DnsStep.tsx`
- Modify: `src/components/setup/SetupWizard.tsx` (Props + passage)
- Modify: `src/routes/setup/index.tsx` (imports + passage des server functions)
- Modify: `src/components/setup/steps/DnsStep.test.tsx` (mocks des nouvelles props)
- Modify: `src/components/setup/SetupWizard.test.tsx` (mocks des nouvelles props)

**Interfaces:**
- Consumes: `discoverServerIpFn`, `hostAddressStatusFn` (Task 5) ; `HostAddressSection` (Task 7) ; `isIpv4`/`isIpv6` (Task 1).
- Produces: `DnsStep` rend la section « Adresse du serveur » dans les deux modes, découvre l'IP une fois, poll `hostAddressStatus` toutes les 5 s, et intègre les A/AAAA dans le badge de tâche global.

- [ ] **Step 1: Étendre le test `DnsStep.test.tsx` (échoue)**

Dans `baseProps()` (ligne 21), ajouter les deux mocks :

```ts
  discoverServerIp: vi.fn(() =>
    Promise.resolve({ ipv4: "203.0.113.4", ipv6: null })
  ),
  hostAddressStatus: vi.fn(() =>
    Promise.resolve({
      records: [
        {
          name: "mail.exemple.fr.",
          type: "A",
          value: "203.0.113.4",
          status: "pending",
        },
      ] as DnsGridRecord[],
    })
  ),
```

Ajouter un test ciblé :

```ts
  it("affiche la section Adresse du serveur en mode auto via l'écho IP", async () => {
    const props = baseProps()
    wrap(<DnsStep {...props} />)
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    fireEvent.click(screen.getByText("Cloudflare"))
    fireEvent.change(await screen.findByLabelText("Clé API"), {
      target: { value: "tok" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

    expect(await screen.findByText("Adresse du serveur")).toBeInTheDocument()
    expect(props.discoverServerIp).toHaveBeenCalled()
    expect(props.hostAddressStatus).toHaveBeenCalledWith({
      ipv4: "203.0.113.4",
      ipv6: undefined,
    })
  })
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `bunx vitest run src/components/setup/steps/DnsStep.test.tsx`
Expected: FAIL — props inconnues / section absente.

- [ ] **Step 3: Implémenter `DnsStep.tsx`**

3a. Imports (après ligne 33) :

```ts
import { isIpv4, isIpv6 } from "@/lib/ip"
import { HostAddressSection } from "./HostAddressSection"
```

3b. Étendre `Props` (après `gridStatus`, ligne 64) :

```ts
  discoverServerIp: () => Promise<{ ipv4: string | null; ipv6: string | null }>
  hostAddressStatus: (ip: {
    ipv4?: string
    ipv6?: string
  }) => Promise<{ records: DnsGridRecord[] }>
```

3c. Déstructurer ces props (dans la signature de `DnsStep`, après `gridStatus,`).

3d. États (après ligne 81) :

```ts
  const [serverIp, setServerIp] = useState<{
    ipv4: string | null
    ipv6: string | null
  } | null>(null)
  const [ipDiscovery, setIpDiscovery] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle")
  const [hostRecords, setHostRecords] = useState<DnsGridRecord[]>([])
```

3e. Découverte IP à l'entrée en phase grid (après le `useEffect` de polling, ligne 176) :

```ts
  // À l'entrée de la grille : découvrir l'IP du serveur une fois (écho sortant).
  useEffect(() => {
    if (phase !== "grid") return
    setIpDiscovery("loading")
    discoverServerIp()
      .then((ip) => {
        if (!mountedRef.current) return
        if (ip.ipv4 || ip.ipv6) {
          setServerIp(ip)
          setIpDiscovery("ready")
        } else {
          setIpDiscovery("failed")
        }
      })
      .catch(() => {
        if (mountedRef.current) setIpDiscovery("failed")
      })
  }, [phase])

  // Poll du statut des A/AAAA dès qu'une IP est connue (écho ou saisie manuelle).
  useEffect(() => {
    if (phase !== "grid" || !serverIp) return
    const ip = {
      ipv4: serverIp.ipv4 ?? undefined,
      ipv6: serverIp.ipv6 ?? undefined,
    }
    const fetchHost = () => {
      hostAddressStatus(ip)
        .then((res) => {
          if (mountedRef.current) setHostRecords(res.records)
        })
        .catch(() => {})
    }
    fetchHost()
    const id = setInterval(fetchHost, 5000)
    return () => clearInterval(id)
  }, [phase, serverIp])

  const onManualIp = (value: string) => {
    setServerIp({
      ipv4: isIpv4(value) ? value : null,
      ipv6: isIpv6(value) ? value : null,
    })
    setIpDiscovery("ready")
  }
```

3f. Intégrer les A/AAAA au badge de tâche global (remplacer ligne 187) :

```ts
  const statuses = [...records, ...hostRecords].map((r) => r.status)
```

3g. Retirer le groupe « A » de la grille (il vivait dans le zone file, désormais vide ; la section dédiée le remplace). Modifier `DNS_GROUP_DEFS` (ligne 43) en enlevant la première entrée :

```ts
const DNS_GROUP_DEFS = [
  { type: "MX", key: "mx" },
  { type: "TXT", key: "txt" },
  { type: "SRV", key: "srv" },
  { type: "CNAME", key: "cname" },
] as const
```

3h. Rendre la section dans la phase grid, juste après `<StepHeader …/>` du bloc grid (insérer avant le `{isManual ? (` de la ligne 338, à l'intérieur du `{phase === "grid" ? (` ) :

```tsx
          <HostAddressSection
            records={hostRecords}
            status={
              ipDiscovery === "failed"
                ? "failed"
                : ipDiscovery === "ready"
                  ? "ready"
                  : "loading"
            }
            domain={domain}
            onManualIp={onManualIp}
          />
```

3i. Supprimer l'ancien bloc `hasExternalA` / `extNote` (lignes 207-209 et 505-513) — la note d'apex/zone externe est désormais portée par `HostAddressSection`. Retirer aussi l'import devenu inutile `hostZone` (ligne 12) si plus référencé (garder `isExternalHost` s'il sert encore ailleurs ; sinon le retirer aussi). Vérifier via typecheck.

- [ ] **Step 4: Câbler `SetupWizard.tsx`**

4a. Ajouter au type `Props` (après `gridStatus`, ligne 57) :

```ts
  discoverServerIp: () => Promise<{ ipv4: string | null; ipv6: string | null }>
  hostAddressStatus: (ip: {
    ipv4?: string
    ipv6?: string
  }) => Promise<{ records: DnsGridRecord[] }>
```

4b. Déstructurer dans la signature (après `gridStatus,`, ligne 89).

4c. Passer au `<DnsStep>` (après `gridStatus={gridStatus}`, ligne 486) :

```tsx
        discoverServerIp={discoverServerIp}
        hostAddressStatus={hostAddressStatus}
```

- [ ] **Step 5: Câbler la route `src/routes/setup/index.tsx`**

5a. Ajouter aux imports depuis `@/server/setup-actions` (ligne 10) :

```ts
  discoverServerIpFn,
  hostAddressStatusFn,
```

5b. Passer à `<SetupWizard>` (après `gridStatus={() => dnsGridStatusFn()}`, ligne 58) :

```tsx
      discoverServerIp={() => discoverServerIpFn()}
      hostAddressStatus={(ip) => hostAddressStatusFn({ data: ip })}
```

- [ ] **Step 6: Mettre à jour les mocks de `SetupWizard.test.tsx`**

Dans l'objet de props par défaut du test (≈ ligne 27, à côté de `gridStatus`), ajouter :

```ts
  discoverServerIp: vi.fn().mockResolvedValue({ ipv4: null, ipv6: null }),
  hostAddressStatus: vi.fn().mockResolvedValue({ records: [] }),
```

- [ ] **Step 7: Lancer la suite complète + lint + typecheck**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS (toute la suite verte, y compris DnsStep, SetupWizard, HostAddressSection).

- [ ] **Step 8: Commit**

```bash
git add src/components/setup/steps/DnsStep.tsx src/components/setup/SetupWizard.tsx src/routes/setup/index.tsx src/components/setup/steps/DnsStep.test.tsx src/components/setup/SetupWizard.test.tsx
git commit -m "feat(setup): intégrer le guidage A/AAAA dans l'étape DNS (#61)"
```

---

## Task 9: Revue & vérification finale

**Files:** aucun (vérification).

- [ ] **Step 1: Revue de sécurité ciblée**

Dispatcher l'agent `security-reviewer` sur le diff de la branche (focus : appel sortant de `discoverServerIp`, validation Zod/IP de `hostAddressStatusFn`, absence de réutilisation du token DNS, pas de SSRF — l'URL d'écho est fixée côté serveur et non contrôlée par le client).

- [ ] **Step 2: Revue de conventions**

Dispatcher l'agent `code-reviewer` sur le diff (focus : fonctions pures testées, i18n FR sans texte en dur, composant présentationnel, pas de secret côté client).

- [ ] **Step 3: Vérification finale**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: tout vert. Confirmer le nombre de tests en hausse (≥ 700 + nouveaux).

- [ ] **Step 4: Écrire la revue**

Documenter dans `docs/superpowers/reviews/2026-06-26-dns-a-aaaa-guidage-review.md` (constats des deux revues + statut), puis ouvrir la PR vers `main` en référant `#61`.

---

## Self-Review

**Couverture de la spec :**
- Écho IP BFF → Task 2 + 5. ✓
- Fallback saisie manuelle → Task 7 (champ) + Task 8 (`onManualIp`). ✓
- Section dans les deux modes → Task 8 (3h, hors du `isManual ?`). ✓
- Hostname + apex → Task 3 (`buildHostRecords`). ✓
- AAAA si IPv6 détectée → Task 2 (écho v6 → null si absent) + Task 3 (AAAA conditionnel). ✓
- Vérif live A/AAAA → Task 4. ✓
- États (loading/ready/failed, mismatch) → Task 7 + Task 4/5. ✓
- i18n FR + miroir EN → Task 6. ✓
- `install.sh` non touché → aucune tâche ne le modifie. ✓
- Pas de réutilisation token / pas d'écriture DNS → aucune fonction ne touche le token ni `createDnsServer`. ✓
- Tests des fonctions pures → Tasks 1-4, 7. ✓

**Cohérence des types :** `discoverServerIp(): {ipv4: string|null; ipv6: string|null}` et `hostAddressStatus(ip:{ipv4?;ipv6?}): {records: DnsGridRecord[]}` identiques entre Task 5 (serveur), Task 8 (props DnsStep + SetupWizard) et la route. `buildHostRecords` renvoie `ZoneRecord[]` consommé tel quel par `resolveRecordStatus`. ✓

**Points de vigilance signalés inline :** retrait conditionnel de l'import `hostZone`/`isExternalHost` au Task 8 (3i) selon usage résiduel (vérifié par typecheck).
