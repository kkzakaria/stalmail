# A/AAAA dérivés de la zone + étiquetage par rôle — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que le serveur mail (cible du MX, dérivée de la zone publiée) reçoive toujours un guidage A/AAAA, et présenter les A/AAAA étiquetés par rôle (serveur mail / apex / webmail), IPv4 et IPv6 à égalité.

**Architecture:** `buildHostRecords` (pur) dérive désormais les noms à guider de la **zone Stalwart parsée** (cibles MX/SRV/CNAME) + apex + hostname public, dédupliqués et tagués d'un `role`. Le handler `hostAddressStatusFn` parse `dnsZoneFile` et transmet ces records ; la section UI les regroupe par rôle. La découverte d'IP, la vérification live et la garde same-origin sont inchangées.

**Tech Stack:** TanStack Start (server functions BFF), React 19, Zod, vitest, react-i18next, Node `dns/promises`, Bun.

## Global Constraints

- Gestionnaire de paquets : **Bun** uniquement (`bun install`, `bun run test`, `bunx vitest`). Jamais npm/yarn/pnpm.
- Toute entrée de server function validée par **Zod**.
- **Fonctions pures extraites et testées isolément** ; composants présentationnels à props injectées.
- **i18n** : tout libellé via `t('...')`, valeurs en **français** + miroir anglais dans `resources.ts`.
- IPv4 **et IPv6 à égalité** : pour chaque hôte retenu, produire A (si ipv4) **et** AAAA (si ipv6).
- Rôles : `mail` (cible MX/SRV/CNAME, requis), `apex` (web, optionnel), `webmail` (hôte PUBLIC_URL).
- Pre-commit (`lint && typecheck && test`) ne doit pas être contourné. Commits conventionnels ; pas de bump de version manuel.
- Branche de travail : `feat/dns-a-zone-targets` (déjà créée, la spec y est committée).
- Spec : `docs/superpowers/specs/2026-06-29-dns-a-cibles-zone-design.md`.

---

## File Structure

- `src/server/dns-host-records.ts` (modifier) — ajoute `collectHostTargets` + réécrit `buildHostRecords` (entrée `zoneRecords`, sortie `HostRecord[]` avec `role`). Exporte `HostRole`, `HostRecord`.
- `src/server/dns-host-records.test.ts` (réécrire) — tests des deux fonctions pures.
- `src/server/setup-actions.ts` (modifier) — `hostAddressStatusHandler` parse `dnsZoneFile`, passe `zoneRecords`, renvoie le `role` ; nouveau type `HostAddressRecord`.
- `src/server/setup-actions-host.test.ts` (modifier) — mocks + assertions sur la dérivation depuis la zone.
- `src/i18n/resources.ts` (modifier) — bloc `wizard.dns.hostAddress.role.{mail,apex,webmail}` (fr + en).
- `src/components/setup/steps/HostAddressSection.tsx` (modifier) — prop `records: HostAddressRecord[]`, regroupement par rôle.
- `src/components/setup/steps/HostAddressSection.test.tsx` (modifier) — fixtures avec `role`, assertions sur les libellés.
- `src/components/setup/steps/DnsStep.tsx` + `src/components/setup/SetupWizard.tsx` (modifier) — type du flux `hostAddressStatus` / state `hostRecords` → `HostAddressRecord[]`.

---

## Task 1: Cœur pur — `collectHostTargets` + `buildHostRecords` avec rôle

**Files:**
- Modify: `src/server/dns-host-records.ts`
- Test: `src/server/dns-host-records.test.ts` (réécriture complète)

**Interfaces:**
- Consumes: `ZoneRecord` from `./dns-zone` (`{ name: string; type: string; value: string }`)
- Produces:
  - `type HostRole = "mail" | "apex" | "webmail"`
  - `interface HostRecord { name: string; type: string; value: string; role: HostRole }`
  - `collectHostTargets(zoneRecords: ZoneRecord[]): string[]`
  - `buildHostRecords(input: { zoneRecords: ZoneRecord[]; hostname: string; domain: string; ipv4: string | null; ipv6: string | null }): HostRecord[]`

- [ ] **Step 1: Réécrire le test (échoue)**

Remplacer tout le contenu de `src/server/dns-host-records.test.ts` par :

```ts
import { describe, it, expect } from "vitest"
import { collectHostTargets, buildHostRecords } from "./dns-host-records"
import type { ZoneRecord } from "./dns-zone"

const zone = (recs: [string, string, string][]): ZoneRecord[] =>
  recs.map(([name, type, value]) => ({ name, type, value }))

describe("collectHostTargets", () => {
  it("extrait la cible du MX (dernier token)", () => {
    expect(
      collectHostTargets(zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]))
    ).toEqual(["mail.exemple.fr"])
  })

  it("déduplique MX + SRV + CNAME pointant le même hôte", () => {
    expect(
      collectHostTargets(
        zone([
          ["exemple.fr.", "MX", "10 mail.exemple.fr."],
          ["_imaps._tcp.exemple.fr.", "SRV", "0 1 993 mail.exemple.fr."],
          ["autoconfig.exemple.fr.", "CNAME", "mail.exemple.fr."],
        ])
      )
    ).toEqual(["mail.exemple.fr"])
  })

  it("ignore les types non pertinents (TXT/CAA/DKIM)", () => {
    expect(
      collectHostTargets(
        zone([
          ["exemple.fr.", "TXT", "v=spf1 mx -all"],
          ["exemple.fr.", "CAA", '0 issue "letsencrypt.org"'],
        ])
      )
    ).toEqual([])
  })

  it("ignore une valeur MX malformée (cible vide)", () => {
    expect(collectHostTargets(zone([["exemple.fr.", "MX", "10"]]))).toEqual([])
  })
})

describe("buildHostRecords", () => {
  const base = {
    hostname: "mail.exemple.fr",
    domain: "exemple.fr",
    ipv4: "203.0.113.4",
    ipv6: null as string | null,
  }

  it("rôle mail = cible du MX ; apex ajouté en plus", () => {
    expect(
      buildHostRecords({
        ...base,
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([
      { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4", role: "mail" },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
    ])
  })

  it("produit A ET AAAA pour chaque hôte quand ipv6 fourni", () => {
    expect(
      buildHostRecords({
        ...base,
        ipv6: "2001:db8::1",
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([
      { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4", role: "mail" },
      { name: "mail.exemple.fr.", type: "AAAA", value: "2001:db8::1", role: "mail" },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      { name: "exemple.fr.", type: "AAAA", value: "2001:db8::1", role: "apex" },
    ])
  })

  it("hostname public distinct → rôle webmail", () => {
    const recs = buildHostRecords({
      ...base,
      hostname: "webmail.exemple.fr",
      zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
    })
    expect(recs).toEqual([
      { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4", role: "mail" },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      { name: "webmail.exemple.fr.", type: "A", value: "203.0.113.4", role: "webmail" },
    ])
  })

  it("ne reduplique pas un nom déjà couvert (hostname == cible mail)", () => {
    const recs = buildHostRecords({
      ...base,
      zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
    })
    // hostname mail.exemple.fr == cible MX → pas de doublon webmail
    expect(recs.filter((r) => r.name === "mail.exemple.fr.")).toHaveLength(1)
  })

  it("cible MX = apex → un seul nom (rôle mail), pas de doublon apex", () => {
    expect(
      buildHostRecords({
        ...base,
        hostname: "exemple.fr",
        zoneRecords: zone([["exemple.fr.", "MX", "10 exemple.fr."]]),
      })
    ).toEqual([
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "mail" },
    ])
  })

  it("zone vide → repli apex + webmail (hostname)", () => {
    expect(
      buildHostRecords({ ...base, zoneRecords: [] })
    ).toEqual([
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4", role: "webmail" },
    ])
  })

  it("aucune IP → tableau vide", () => {
    expect(
      buildHostRecords({
        ...base,
        ipv4: null,
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Lancer le test (échec attendu)**

Run: `bunx vitest run src/server/dns-host-records.test.ts`
Expected: FAIL — `collectHostTargets` n'existe pas / signature `buildHostRecords` différente.

- [ ] **Step 3: Réécrire `src/server/dns-host-records.ts`**

```ts
// Construit les A/AAAA attendus à partir de la ZONE publiée par Stalwart (cibles MX/SRV/
// CNAME = serveur mail) + apex + hostname public, étiquetés par rôle. Pur, testé. La valeur
// (l'IP) vient de l'écho, pas de Stalwart (qui ne publie jamais A/AAAA) — d'où ce module.
import type { ZoneRecord } from "./dns-zone"

export type HostRole = "mail" | "apex" | "webmail"
export interface HostRecord {
  name: string
  type: string
  value: string
  role: HostRole
}

const normName = (h: string) => h.trim().toLowerCase().replace(/\.$/, "")

// Hôtes que la zone fait pointer vers le serveur (cibles MX/SRV/CNAME). En pratique
// l'hôte unique du serveur mail. Dédupliqué, normalisé.
export function collectHostTargets(zoneRecords: ZoneRecord[]): string[] {
  const out: string[] = []
  for (const r of zoneRecords) {
    let target = ""
    if (r.type === "MX" || r.type === "SRV") {
      const parts = r.value.trim().split(/\s+/)
      target = parts[parts.length - 1] ?? ""
    } else if (r.type === "CNAME") {
      target = r.value
    } else {
      continue
    }
    const n = normName(target)
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}

export function buildHostRecords(input: {
  zoneRecords: ZoneRecord[]
  hostname: string
  domain: string
  ipv4: string | null
  ipv6: string | null
}): HostRecord[] {
  const { ipv4, ipv6 } = input
  const seen = new Set<string>()
  const named: { name: string; role: HostRole }[] = []
  const add = (raw: string, role: HostRole) => {
    const n = normName(raw)
    if (!n || seen.has(n)) return
    seen.add(n)
    named.push({ name: n, role })
  }

  // 1) Serveur mail : les hôtes que la zone pointe déjà (cible MX, confirmée par SRV/CNAME).
  for (const t of collectHostTargets(input.zoneRecords)) add(t, "mail")
  // 2) Apex (accès web), s'il n'est pas déjà un hôte mail.
  add(input.domain, "apex")
  // 3) Webmail (hôte de PUBLIC_URL), s'il est distinct.
  add(input.hostname, "webmail")

  const records: HostRecord[] = []
  for (const { name, role } of named) {
    if (ipv4) records.push({ name: name + ".", type: "A", value: ipv4, role })
    if (ipv6) records.push({ name: name + ".", type: "AAAA", value: ipv6, role })
  }
  return records
}
```

- [ ] **Step 4: Lancer le test (succès)**

Run: `bunx vitest run src/server/dns-host-records.test.ts`
Expected: PASS (4 + 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/dns-host-records.ts src/server/dns-host-records.test.ts
git commit -m "feat(setup): dériver les A/AAAA des cibles de la zone, étiquetés par rôle (#61)"
```

---

## Task 2: Handler serveur — parser la zone + exposer le rôle

**Files:**
- Modify: `src/server/setup-actions.ts` (`hostAddressStatusHandler` ~L249-286 ; ajout type `HostAddressRecord`)
- Test: `src/server/setup-actions-host.test.ts`

**Interfaces:**
- Consumes: `collectHostTargets`/`buildHostRecords`/`HostRole` (Task 1) ; `parseZoneFile` from `./dns-zone` ; `resolveRecordStatus` ; `getPrimaryDomain` ; `resolveServerHostname` ; `isIpv4`/`isIpv6`.
- Produces: `export interface HostAddressRecord { name: string; type: string; value: string; role: HostRole; status: "verified" | "pending" | "error" }` ; `hostAddressStatusHandler(...) : Promise<{ records: HostAddressRecord[] }>`.

- [ ] **Step 1: Mettre à jour le test (échoue)**

Remplacer le contenu de `src/server/setup-actions-host.test.ts` par :

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("./session-cookie", () => ({ assertSameOriginStrict: vi.fn() }))
vi.mock("./stalwart-domain", () => ({
  getPrimaryDomain: vi.fn(async () => ({
    id: "d1",
    name: "exemple.fr",
    dnsZoneFile: "exemple.fr. IN MX 10 mail.exemple.fr.\n",
  })),
}))
vi.mock("./dns-resolve", () => ({
  resolveRecordStatus: vi.fn(async () => "missing"),
}))

import { hostAddressStatusHandler } from "./setup-actions"

beforeEach(() => vi.clearAllMocks())

describe("hostAddressStatusHandler", () => {
  it("dérive le serveur mail (cible MX) depuis la zone, avec rôle", async () => {
    const res = await hostAddressStatusHandler({ data: { ipv4: "203.0.113.4" } })
    expect(res.records).toContainEqual({
      name: "mail.exemple.fr.",
      type: "A",
      value: "203.0.113.4",
      role: "mail",
      status: "pending",
    })
    // l'apex est aussi proposé (rôle apex)
    expect(res.records.some((r) => r.role === "apex")).toBe(true)
  })

  it("ignore une IP invalide → aucun record", async () => {
    const res = await hostAddressStatusHandler({ data: { ipv4: "not-an-ip" } })
    expect(res.records).toEqual([])
  })
})
```

- [ ] **Step 2: Lancer le test (échec)**

Run: `bunx vitest run src/server/setup-actions-host.test.ts`
Expected: FAIL — `role` absent des records / zone non parsée.

- [ ] **Step 3: Modifier le handler + ajouter le type**

Dans `src/server/setup-actions.ts`, ajouter l'import de type en tête de fichier (près des autres imports) :

```ts
import type { HostRole } from "./dns-host-records"
```

Ajouter le type exporté juste avant `export async function hostAddressStatusHandler` :

```ts
export interface HostAddressRecord {
  name: string
  type: string
  value: string
  role: HostRole
  status: "verified" | "pending" | "error"
}
```

Remplacer le corps de `hostAddressStatusHandler` (L249-286) par :

```ts
export async function hostAddressStatusHandler({
  data,
}: {
  data: { ipv4?: string; ipv6?: string }
}): Promise<{ records: HostAddressRecord[] }> {
  const { assertSameOriginStrict } = await import("./session-cookie")
  assertSameOriginStrict()
  const { getPrimaryDomain } = await import("./stalwart-domain")
  const { parseZoneFile } = await import("./dns-zone")
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
  const zoneRecords = domain.dnsZoneFile ? parseZoneFile(domain.dnsZoneFile) : []
  const expected = buildHostRecords({
    zoneRecords,
    hostname,
    domain: domain.name,
    ipv4,
    ipv6,
  })
  const records = await Promise.all(
    expected.map(async (r) => {
      const raw = await resolveRecordStatus(r)
      const status: HostAddressRecord["status"] =
        raw === "verified"
          ? "verified"
          : raw === "mismatch"
            ? "error"
            : "pending"
      return { name: r.name, type: r.type, value: r.value, role: r.role, status }
    })
  )
  return { records }
}
```

- [ ] **Step 4: Lancer le test + gate**

Run: `bunx vitest run src/server/setup-actions-host.test.ts && bun run lint && bun run typecheck && bun run test`
Expected: tout vert (2 tests du fichier + suite complète). Le typecheck reste vert : `HostAddressRecord` (name/type/value/status + `role`) est un **sous-type** de `DnsGridRecord`, donc le flux encore typé `DnsGridRecord[]` (DnsStep/SetupWizard) accepte le retour par covariance ; le `role` est simplement ignoré jusqu'à ce que Task 4 élargisse les types pour l'exploiter.

- [ ] **Step 5: Commit**

```bash
git add src/server/setup-actions.ts src/server/setup-actions-host.test.ts
git commit -m "feat(setup): hostAddressStatus parse la zone et expose le rôle (#61)"
```

---

## Task 3: i18n — libellés de rôle

**Files:**
- Modify: `src/i18n/resources.ts` (bloc `wizard.dns.hostAddress`, fr ~L131 et en ~L466)

**Interfaces:**
- Produces: clés `wizard.dns.hostAddress.role.{mail,apex,webmail}` (fr + en).

- [ ] **Step 1: Ajouter le sous-bloc `role` (français)**

Dans le bloc `hostAddress` **français**, après la clé `apexNote` (avant la `}` fermante du bloc) :

```ts
        role: {
          mail: "Serveur mail (requis)",
          apex: "Apex — accès web (optionnel)",
          webmail: "Webmail",
        },
```

- [ ] **Step 2: Ajouter le sous-bloc `role` (anglais)**

Dans le bloc `hostAddress` **anglais**, à la même position :

```ts
        role: {
          mail: "Mail server (required)",
          apex: "Apex — web access (optional)",
          webmail: "Webmail",
        },
```

- [ ] **Step 3: Typecheck (parité fr/en)**

Run: `bun run typecheck`
Expected: pas de nouvelle erreur i18n (la parité de clés fr/en est satisfaite ; les erreurs de type UI restent jusqu'au Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/resources.ts
git commit -m "feat(i18n): libellés de rôle pour la section adresse du serveur (#61)"
```

---

## Task 4: UI — regroupement par rôle + câblage des types

**Files:**
- Modify: `src/components/setup/steps/HostAddressSection.tsx`
- Test: `src/components/setup/steps/HostAddressSection.test.tsx`
- Modify: `src/components/setup/steps/DnsStep.tsx` (type du state `hostRecords` + prop `hostAddressStatus`)
- Modify: `src/components/setup/SetupWizard.tsx` (type de la prop `hostAddressStatus`)

**Interfaces:**
- Consumes: `HostAddressRecord` from `@/server/setup-actions` (Task 2).
- Produces: `HostAddressSection` rendu groupé par rôle ; flux `hostAddressStatus` typé `Promise<{ records: HostAddressRecord[] }>` de bout en bout.

- [ ] **Step 1: Mettre à jour le test du composant (échoue)**

Remplacer le contenu de `src/components/setup/steps/HostAddressSection.test.tsx` par :

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@/i18n/i18n"
import type { HostAddressRecord } from "@/server/setup-actions"
import { HostAddressSection } from "./HostAddressSection"

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n("fr")}>{ui}</I18nextProvider>)

const recs: HostAddressRecord[] = [
  { name: "mail.exemple.fr.", type: "A", value: "203.0.113.4", role: "mail", status: "pending" },
  { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex", status: "verified" },
]

describe("HostAddressSection", () => {
  it("affiche le titre et les enregistrements en mode ready", () => {
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

  it("regroupe par rôle avec les libellés (serveur mail requis, apex optionnel)", () => {
    wrap(
      <HostAddressSection
        records={recs}
        status="ready"
        domain="exemple.fr"
        onManualIp={vi.fn()}
      />
    )
    expect(screen.getByText("Serveur mail (requis)")).toBeInTheDocument()
    expect(screen.getByText("Apex — accès web (optionnel)")).toBeInTheDocument()
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
    expect(screen.getByText(/Détection de l'adresse IP/)).toBeInTheDocument()
  })

  it("en échec : IP valide → onManualIp ; IP invalide → erreur", () => {
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

    fireEvent.change(screen.getByLabelText("Adresse IP du serveur"), {
      target: { value: "nope" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Valider" }))
    expect(screen.getByText("Adresse IP invalide.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Lancer le test (échec)**

Run: `bunx vitest run src/components/setup/steps/HostAddressSection.test.tsx`
Expected: FAIL — libellés de rôle absents / type `HostAddressRecord` non importé.

- [ ] **Step 3: Modifier `HostAddressSection.tsx`**

3a. Remplacer l'import de type (L8) :

```ts
import type { HostAddressRecord } from "@/server/setup-actions"
```

3b. Mettre à jour la prop (L13-18) :

```ts
interface HostAddressSectionProps {
  records: HostAddressRecord[]
  status: "loading" | "ready" | "failed"
  domain: string
  onManualIp: (ip: string) => void
}
```

3c. Remplacer le corps du `<tbody>` (L104-144) par un rendu groupé par rôle. Définir, juste avant le `return` du composant, l'ordre des rôles et leurs libellés :

```ts
  const ROLES = ["mail", "apex", "webmail"] as const
  const roleLabel = {
    mail: t("wizard.dns.hostAddress.role.mail"),
    apex: t("wizard.dns.hostAddress.role.apex"),
    webmail: t("wizard.dns.hostAddress.role.webmail"),
  }
```

Puis remplacer le `<tbody>…</tbody>` existant par :

```tsx
            <tbody>
              {ROLES.map((role) => {
                const group = records.filter((r) => r.role === role)
                if (group.length === 0) return null
                return (
                  <Fragment key={role}>
                    <tr className="dns-sect">
                      <td colSpan={4}>
                        <span className="dns-sect-line">
                          <span className="dns-sect-title">
                            {roleLabel[role]}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {group.map((r, i) => (
                      <tr
                        key={role + "-" + i}
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
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
```

3d. Ajouter l'import `Fragment` en tête (L5) :

```ts
import { Fragment, useState } from "react"
```

(Le bloc `apexNote` / `isExternalHost` en bas reste inchangé.)

- [ ] **Step 4: Mettre à jour les types du flux (`DnsStep.tsx`, `SetupWizard.tsx`)**

4a. `src/components/setup/steps/DnsStep.tsx` — remplacer l'usage de `DnsGridRecord` pour le flux host. En tête, ajouter l'import de type :

```ts
import type { HostAddressRecord } from "@/server/setup-actions"
```

Dans le type `Props`, changer la signature de `hostAddressStatus` :

```ts
  hostAddressStatus: (ip: {
    ipv4?: string
    ipv6?: string
  }) => Promise<{ records: HostAddressRecord[] }>
```

Changer le type du state `hostRecords` :

```ts
  const [hostRecords, setHostRecords] = useState<HostAddressRecord[]>([])
```

(Le badge global `statuses` lit `.status` sur `hostRecords` — compatible, inchangé.)

4b. `src/components/setup/SetupWizard.tsx` — dans le type `Props`, aligner la signature de `hostAddressStatus` :

```ts
  hostAddressStatus: (ip: {
    ipv4?: string
    ipv6?: string
  }) => Promise<{ records: HostAddressRecord[] }>
```

Ajouter l'import de type en tête de `SetupWizard.tsx` :

```ts
import type { HostAddressRecord } from "@/server/setup-actions"
```

(La route `src/routes/setup/index.tsx` passe `(ip) => hostAddressStatusFn({ data: ip })` ; le type de retour est inféré depuis `hostAddressStatusFn` → `HostAddressRecord[]`, aucun changement requis.)

- [ ] **Step 5: Lancer les tests + gate complet**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: tout vert (HostAddressSection 4 tests, DnsStep/SetupWizard inchangés au comportement, suite complète verte).

- [ ] **Step 6: Commit**

```bash
git add src/components/setup/steps/HostAddressSection.tsx src/components/setup/steps/HostAddressSection.test.tsx src/components/setup/steps/DnsStep.tsx src/components/setup/SetupWizard.tsx
git commit -m "feat(setup): regrouper les A/AAAA par rôle dans la section adresse du serveur (#61)"
```

---

## Task 5: Revue & vérification finale

**Files:** aucun (vérification).

- [ ] **Step 1: Revue de conventions** — dispatcher `code-reviewer` sur le diff de la branche (focus : fonctions pures testées, dédup/rôles corrects, i18n FR+EN, type `HostAddressRecord` cohérent de bout en bout, IPv6 à égalité).

- [ ] **Step 2: Revue sécurité** — dispatcher `security-reviewer` sur le diff (focus : parsing zone côté serveur, pas de nouvelle entrée client non validée — `zoneRecords` vient de Stalwart, pas du client ; garde same-origin inchangée).

- [ ] **Step 3: Vérification finale**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: tout vert ; nombre de tests en hausse vs base.

- [ ] **Step 4: Revue + PR** — documenter dans `docs/superpowers/reviews/2026-06-29-dns-a-cibles-zone-review.md`, ouvrir la PR vers `main` (réf #61).

---

## Self-Review

**Couverture de la spec :**
- Dériver de la zone (cibles MX/SRV/CNAME) → Task 1 (`collectHostTargets`) + Task 2 (handler parse zone). ✓
- Étiquetage par rôle (mail/apex/webmail) → Task 1 (`role`), Task 3 (i18n), Task 4 (UI groupée). ✓
- IPv6 à égalité (A + AAAA par hôte) → Task 1 (boucle ipv4+ipv6) + test dédié. ✓
- Repli zone vide → Task 1 (apex + webmail) + test. ✓
- Dédup / cible=apex / hostname==mail → Task 1 tests. ✓
- Cible hors zone annotée → comportement `apexNote`/`isExternalHost` conservé (HostAddressSection inchangé sur ce point). ✓
- Garde same-origin / Zod / revalidation IP inchangées → Task 2 conserve. ✓
- Non-régression dns-resolve/portal/layout → non touchés. ✓

**Cohérence des types :** `HostRole`/`HostRecord` (dns-host-records) → `HostAddressRecord` (setup-actions, ajoute `status`) → prop `records` de `HostAddressSection` + state `hostRecords` (DnsStep) + signature `hostAddressStatus` (DnsStep & SetupWizard). Toutes alignées sur `HostAddressRecord[]`. ✓

**Placeholders :** aucun ; code complet à chaque étape.

**Commits verts à chaque tâche :** `HostAddressRecord` étant un sous-type de `DnsGridRecord`, le retour élargi du handler (Task 2) reste assignable au flux encore typé `DnsGridRecord[]` (covariance) → pre-commit vert à chaque tâche. Task 4 élargit ensuite les types pour exploiter `role`. Aucune tâche ne laisse le dépôt rouge.
