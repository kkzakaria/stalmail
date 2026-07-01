# Surfaçage de l'échec de publication `DnsManagement` (#62) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de la tâche `DnsManagement` de Stalwart la source de vérité du succès de publication DNS dans le wizard, pour qu'un token API invalide ne passe plus inaperçu.

**Architecture:** Calque exact du correctif ACME #59. Côté serveur : un helper pur `classifyDnsManagement` + une lecture `getDnsManagementStatus` + une server-fn GET. Côté client : `DnsStep` gagne une phase `verifying` bloquante qui sonde cette server-fn (poll 5s, deadline 180s) entre `setDnsManagement` et la grille ; `failed` → erreur explicite + ressaisie du token, `published` → grille, `pending` au-delà de la deadline → état `timeout` (message + bouton « Continuer quand même », le poll continue — jamais de bascule grille silencieuse).

**Tech Stack:** TypeScript, TanStack Start (server functions), React 19, react-i18next, Vitest, Testing Library. Gestionnaire de paquets **Bun**.

## Global Constraints

- Gestionnaire de paquets **Bun** uniquement (`bun run test`, `bun run lint`, `bun run typecheck`). Jamais npm/yarn/pnpm.
- **TDD strict** : test qui échoue d'abord, puis implémentation minimale.
- **i18n** : aucun texte en dur ; toujours via clés `t('...')`. Libellés FR **et** EN dans `src/i18n/resources.ts` (les deux blocs existent).
- **Fonctions pures extraites et testées isolément** (parsers/résolveurs/classifieurs).
- **Validation** : entrées de server-fn via Zod ; pas d'opération JMAP générique exposée au client.
- **Sécurité** : aucun secret/token côté client ; la nouvelle server-fn est une lecture admin.
- Commits **conventionnels** (`feat:`/`test:`/`fix:`). Ne jamais bumper la version. Pre-commit (`lint && typecheck && test`) ne doit pas être contourné.
- Branche de travail : `fix/62-dns-management-statut` (déjà créée).
- Schéma vérifié par probe (cf. spec) : `status` est une enveloppe `{"@type": "Pending"|"Failed"|"Retry"}` ; **succès = tâche absente** ; latence worker ~60-90s.

---

## File Structure

- `src/server/stalwart-dns.ts` — **modifié** : ajoute `DnsManagementStatus`, `DnsManagementTask`, `classifyDnsManagement`, `getDnsManagementStatus`. (Imports `jmapCall`, `resolveAccountId`, `expectResult` déjà présents.)
- `src/server/stalwart-dns.test.ts` — **modifié** : describe `classifyDnsManagement` + `getDnsManagementStatus`.
- `src/server/setup-actions.ts` — **modifié** : `dnsManagementStatusHandler` + `dnsManagementStatusFn`.
- `src/server/setup-actions.test.ts` — **modifié** : test du handler.
- `src/components/setup/error-code.ts` — **modifié** : `"SETUP-DNS-PUBLISH-FAILED"` dans `KNOWN_CODES`.
- `src/i18n/resources.ts` — **modifié** : clés `wizard.dns.records.verifying` + `wizard.error.codes.SETUP-DNS-PUBLISH-FAILED` (fr + en).
- `src/components/setup/steps/DnsStep.tsx` — **modifié** : prop `dnsManagementStatus`, type `Phase` étendu, helper pur exporté `nextVerifyPhase`, effet de poll `verifying`, bloc UI `verifying`.
- `src/components/setup/steps/DnsStep.test.tsx` — **modifié** : `nextVerifyPhase` (purs) + cas composant (failed/published/pending).
- `src/components/setup/SetupWizard.tsx` — **modifié** : prop `dnsManagementStatus` (interface + pass-through à `DnsStep`).
- `src/components/setup/SetupWizard.test.tsx` — **modifié** : fournit `dnsManagementStatus` dans les props de test.
- `src/routes/setup/index.tsx` — **modifié** : importe `dnsManagementStatusFn`, le passe à `SetupWizard`.

---

## Task 1 : Helper pur + lecture du statut (serveur)

**Files:**
- Modify: `src/server/stalwart-dns.ts` (append en fin de fichier)
- Test: `src/server/stalwart-dns.test.ts`

**Interfaces:**
- Consumes: `jmapCall`, `resolveAccountId`, `expectResult` (déjà importés depuis `./jmap`).
- Produces:
  - `type DnsManagementStatus = "pending" | "failed" | "published"`
  - `interface DnsManagementTask { "@type"?: string; status?: { "@type"?: string }; due?: string }`
  - `function classifyDnsManagement(task: DnsManagementTask | undefined): DnsManagementStatus`
  - `function getDnsManagementStatus(): Promise<DnsManagementStatus>`

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `src/server/stalwart-dns.test.ts`, ajouter `classifyDnsManagement` et `getDnsManagementStatus` à l'import existant :

```ts
import {
  createDnsServer,
  findDnsServerId,
  DNS_PROVIDERS,
  classifyDnsManagement,
  getDnsManagementStatus,
} from "./stalwart-dns"
```

Puis ajouter à la fin du fichier :

```ts
describe("classifyDnsManagement", () => {
  it("returns 'published' when there is no task (completed and cleared)", () => {
    expect(classifyDnsManagement(undefined)).toBe("published")
  })
  it("returns 'failed' when the task status is Failed", () => {
    expect(classifyDnsManagement({ status: { "@type": "Failed" } })).toBe(
      "failed"
    )
  })
  it("returns 'pending' when the task status is Pending", () => {
    expect(classifyDnsManagement({ status: { "@type": "Pending" } })).toBe(
      "pending"
    )
  })
  it("returns 'pending' when the task status is Retry", () => {
    expect(classifyDnsManagement({ status: { "@type": "Retry" } })).toBe(
      "pending"
    )
  })
  it("returns 'pending' when the status envelope is missing", () => {
    expect(classifyDnsManagement({})).toBe("pending")
  })
})

describe("getDnsManagementStatus", () => {
  it("returns 'failed' for a DnsManagement task in Failed", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1"] }, "0"],
      [
        "x:Task/get",
        { list: [{ "@type": "DnsManagement", status: { "@type": "Failed" } }] },
        "1",
      ],
    ])
    await expect(getDnsManagementStatus()).resolves.toBe("failed")
  })
  it("returns 'pending' for a DnsManagement task in Pending", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1"] }, "0"],
      [
        "x:Task/get",
        {
          list: [{ "@type": "DnsManagement", status: { "@type": "Pending" } }],
        },
        "1",
      ],
    ])
    await expect(getDnsManagementStatus()).resolves.toBe("pending")
  })
  it("returns 'published' when no DnsManagement task is present", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1"] }, "0"],
      [
        "x:Task/get",
        { list: [{ "@type": "AcmeRenewal", status: { "@type": "Pending" } }] },
        "1",
      ],
    ])
    await expect(getDnsManagementStatus()).resolves.toBe("published")
  })
  it("ignores non-DnsManagement tasks and classifies the DnsManagement one", async () => {
    mj.mockResolvedValueOnce([
      ["x:Task/query", { ids: ["t1", "t2"] }, "0"],
      [
        "x:Task/get",
        {
          list: [
            { "@type": "AcmeRenewal", status: { "@type": "Failed" } },
            { "@type": "DnsManagement", status: { "@type": "Pending" } },
          ],
        },
        "1",
      ],
    ])
    await expect(getDnsManagementStatus()).resolves.toBe("pending")
  })
})
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `bun run test -- src/server/stalwart-dns.test.ts`
Expected: FAIL — `classifyDnsManagement is not a function` / `getDnsManagementStatus is not a function`.

- [ ] **Step 3 : Implémenter (append à `src/server/stalwart-dns.ts`)**

```ts
export type DnsManagementStatus = "pending" | "failed" | "published"

export interface DnsManagementTask {
  "@type"?: string
  status?: { "@type"?: string }
  due?: string
}

/**
 * Décide le statut de publication à partir de la tâche DnsManagement.
 * Pure. Probe live (#62) : succès → la tâche disparaît ; échec → la tâche
 * persiste en `Failed`. Pas de fenêtre temporelle (publication one-shot, pas
 * de cycle de renouvellement comme AcmeRenewal).
 *
 *  - aucune tâche → published (publiée puis nettoyée)
 *  - statut Failed → failed
 *  - Pending / Retry / statut absent → pending (en cours)
 */
export function classifyDnsManagement(
  task: DnsManagementTask | undefined
): DnsManagementStatus {
  if (!task) return "published"
  if (task.status?.["@type"] === "Failed") return "failed"
  return "pending"
}

/** Sonde la tâche DnsManagement. Voir classifyDnsManagement pour le mapping. */
export async function getDnsManagementStatus(): Promise<DnsManagementStatus> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ["x:Task/query", { accountId }, "0"],
    [
      "x:Task/get",
      {
        accountId,
        "#ids": { resultOf: "0", name: "x:Task/query", path: "/ids" },
      },
      "1",
    ],
  ])
  const list =
    (expectResult(responses, 1) as { list?: DnsManagementTask[] }).list ?? []
  const task = list.find((t) => t["@type"] === "DnsManagement")
  return classifyDnsManagement(task)
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `bun run test -- src/server/stalwart-dns.test.ts`
Expected: PASS (tous les `classifyDnsManagement` + `getDnsManagementStatus`).

- [ ] **Step 5 : Commit**

```bash
git add src/server/stalwart-dns.ts src/server/stalwart-dns.test.ts
git commit -m "feat(setup): classifyDnsManagement + getDnsManagementStatus (#62)"
```

---

## Task 2 : Server-fn `dnsManagementStatus`

**Files:**
- Modify: `src/server/setup-actions.ts` (à côté de `acmeStatusHandler` / `acmeStatusFn`)
- Test: `src/server/setup-actions.test.ts`

**Interfaces:**
- Consumes: `getDnsManagementStatus` (Task 1), `DnsManagementStatus` (Task 1).
- Produces:
  - `function dnsManagementStatusHandler(): Promise<{ status: DnsManagementStatus }>`
  - `const dnsManagementStatusFn` (server-fn GET)

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `src/server/setup-actions.test.ts`, trois éditions ciblées (le mock `./stalwart-dns` existe déjà et spread `importActual` — on **ajoute** l'override, pas un second `vi.mock`).

(a) Dans le bloc `vi.mock("./stalwart-dns", …)` existant, ajouter l'override (après `createDnsServer: vi.fn(async () => "srv-1"),`) :

```ts
  getDnsManagementStatus: vi.fn(async () => "failed"),
```

(b) Ajouter `dnsManagementStatusHandler` à l'import depuis `./setup-actions` (à côté de `acmeStatusHandler,`) et `getDnsManagementStatus` à l'import depuis `./stalwart-dns` (la ligne `import { createDnsServer } from "./stalwart-dns"` devient) :

```ts
import { createDnsServer, getDnsManagementStatus } from "./stalwart-dns"
```

(c) Ajouter le describe, calqué sur `acmeStatusHandler` (read-only, no auth guard) :

```ts
describe("dnsManagementStatusHandler", () => {
  it("returns {status} from getDnsManagementStatus", async () => {
    vi.mocked(getDnsManagementStatus).mockResolvedValueOnce("failed")
    const result = await dnsManagementStatusHandler()
    expect(result).toEqual({ status: "failed" })
  })
})
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `bun run test -- src/server/setup-actions.test.ts -t "dnsManagementStatusHandler"`
Expected: FAIL — `dnsManagementStatusHandler` n'est pas exporté.

- [ ] **Step 3 : Implémenter (dans `src/server/setup-actions.ts`)**

Juste après `acmeStatusHandler` (lecture non gardée, même profil) :

```ts
export async function dnsManagementStatusHandler(): Promise<{
  status: DnsManagementStatus
}> {
  const { getDnsManagementStatus } = await import("./stalwart-dns")
  return { status: await getDnsManagementStatus() }
}
```

Ajouter le type à l'import de types serveur en tête de fichier. Repérer la ligne qui importe `AcmeStatus` (ex. `import type { AcmeStatus } from "./stalwart-acme"`) et ajouter à côté :

```ts
import type { DnsManagementStatus } from "./stalwart-dns"
```

Puis, à côté de `acmeStatusFn` :

```ts
export const dnsManagementStatusFn = createServerFn({ method: "GET" }).handler(
  dnsManagementStatusHandler
)
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `bun run test -- src/server/setup-actions.test.ts -t "dnsManagementStatusHandler"`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/server/setup-actions.ts src/server/setup-actions.test.ts
git commit -m "feat(setup): server-fn dnsManagementStatus (#62)"
```

---

## Task 3 : Code d'erreur + libellés i18n

**Files:**
- Modify: `src/components/setup/error-code.ts`
- Modify: `src/i18n/resources.ts` (blocs `fr` et `en`)

**Interfaces:**
- Produces: code `"SETUP-DNS-PUBLISH-FAILED"` reconnu par `messageKeyForCode` ; clés `wizard.error.codes.SETUP-DNS-PUBLISH-FAILED` et `wizard.dns.records.verifying`.

- [ ] **Step 1 : Ajouter le code à `KNOWN_CODES`**

Dans `src/components/setup/error-code.ts`, dans le `Set` `KNOWN_CODES`, ajouter après `"SETUP-DNS-MANAGEMENT-REJECTED",` :

```ts
  "SETUP-DNS-PUBLISH-FAILED",
```

- [ ] **Step 2 : Ajouter les libellés FR**

Dans `src/i18n/resources.ts`, bloc **fr** :

Sous `wizard.error.codes` (après `"SETUP-DNS-MANAGEMENT-REJECTED": "La gestion DNS automatique a été refusée.",`) ajouter :

```ts
        "SETUP-DNS-PUBLISH-FAILED":
          "La publication DNS a échoué — vérifiez votre token API et réessayez.",
```

Sous `wizard.dns.records` (après `publishing: "Publication des enregistrements…",`) ajouter :

```ts
        verifying: "Publication des enregistrements en cours… (jusqu'à 3 min)",
```

- [ ] **Step 3 : Ajouter les libellés EN**

Dans `src/i18n/resources.ts`, bloc **en** :

Sous `wizard.error.codes` (après `"SETUP-DNS-MANAGEMENT-REJECTED": "Automatic DNS management was rejected.",`) ajouter :

```ts
        "SETUP-DNS-PUBLISH-FAILED":
          "DNS publication failed — check your API token and try again.",
```

Sous `wizard.dns.records` (après `publishing: "Publishing records…",`) ajouter :

```ts
        verifying: "Publishing records… (up to 3 min)",
```

- [ ] **Step 4 : Vérifier typecheck + tests i18n**

Run: `bun run typecheck && bun run test -- src/i18n`
Expected: PASS (les deux locales restent structurellement symétriques).

- [ ] **Step 5 : Commit**

```bash
git add src/components/setup/error-code.ts src/i18n/resources.ts
git commit -m "feat(setup): code SETUP-DNS-PUBLISH-FAILED + libellé verifying (#62)"
```

---

## Task 4 : Phase `verifying` dans `DnsStep`

**Files:**
- Modify: `src/components/setup/steps/DnsStep.tsx`
- Test: `src/components/setup/steps/DnsStep.test.tsx`

**Interfaces:**
- Consumes: `DnsManagementStatus` (Task 1), code `"SETUP-DNS-PUBLISH-FAILED"` + clé `verifying` (Task 3).
- Produces:
  - prop `dnsManagementStatus: () => Promise<{ status: DnsManagementStatus }>` sur `DnsStep`.
  - `function nextVerifyPhase(status: DnsManagementStatus, elapsedMs: number, deadlineMs: number): "error" | "grid" | "wait"` (pure, exportée).

- [ ] **Step 1 : Écrire les tests purs qui échouent (`nextVerifyPhase`)**

Dans `src/components/setup/steps/DnsStep.test.tsx`, ajouter `nextVerifyPhase` à l'import depuis `./DnsStep` :

```ts
import { DnsStep, nextVerifyPhase } from "./DnsStep"
```

Et un describe :

```ts
describe("nextVerifyPhase", () => {
  const D = 120000
  it("failed → error, quel que soit le temps écoulé", () => {
    expect(nextVerifyPhase("failed", 0, D)).toBe("error")
    expect(nextVerifyPhase("failed", D + 1, D)).toBe("error")
  })
  it("published → grid", () => {
    expect(nextVerifyPhase("published", 0, D)).toBe("grid")
  })
  it("pending avant la deadline → wait", () => {
    expect(nextVerifyPhase("pending", D - 1, D)).toBe("wait")
  })
  it("pending à/au-delà de la deadline → grid (non bloquant)", () => {
    expect(nextVerifyPhase("pending", D, D)).toBe("grid")
    expect(nextVerifyPhase("pending", D + 5000, D)).toBe("grid")
  })
})
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `bun run test -- src/components/setup/steps/DnsStep.test.tsx -t "nextVerifyPhase"`
Expected: FAIL — `nextVerifyPhase is not a function`.

- [ ] **Step 3 : Implémenter `nextVerifyPhase` + la prop + la phase + l'effet + l'UI**

Dans `src/components/setup/steps/DnsStep.tsx` :

(a) Importer le type (type-only, erasé au build — pas de pull serveur dans le bundle, comme `SslStep` avec `AcmeStatus`) :

```ts
import type { DnsManagementStatus } from "@/server/stalwart-dns"
```

(b) Exporter le helper pur (haut du fichier, près de `zoneFileText`) :

```ts
// Décision de transition de la phase 'verifying' à partir du statut sondé et du
// temps écoulé. Pure → testée isolément. La tâche DnsManagement met ~60-90s à
// s'exécuter (probe #62) ; au-delà de la deadline on passe à la grille sans
// bloquer (Stalwart continue de réessayer en tâche de fond).
export function nextVerifyPhase(
  status: DnsManagementStatus,
  elapsedMs: number,
  deadlineMs: number
): "error" | "grid" | "wait" {
  if (status === "failed") return "error"
  if (status === "published") return "grid"
  return elapsedMs >= deadlineMs ? "grid" : "wait"
}

const VERIFY_DEADLINE_MS = 180_000
```

(c) Étendre le type `Phase` :

```ts
type Phase = "form" | "connecting" | "publishing" | "verifying" | "grid" | "error"
```

(d) Ajouter la prop à l'interface `Props` (après `gridStatus`) :

```ts
  dnsManagementStatus: () => Promise<{ status: DnsManagementStatus }>
```

(e) Déstructurer la prop dans la signature du composant (après `gridStatus,`) :

```ts
  dnsManagementStatus,
```

(f) Dans `runAuto`, remplacer la transition vers la grille par la phase `verifying`. Remplacer :

```ts
      .then((res) => {
        if (!mountedRef.current || res === null) return
        setPhase("grid")
      })
```

par :

```ts
      .then((res) => {
        if (!mountedRef.current || res === null) return
        setPhase("verifying")
      })
```

(g) Ajouter une ref pour garder la dernière callback (sous les autres refs, après `pollRef`) et l'effet de poll. Placer juste après l'effet `useEffect` qui poll `gridStatus` :

```ts
  const dnsManagementStatusRef = useRef(dnsManagementStatus)
  dnsManagementStatusRef.current = dnsManagementStatus

  // Phase 'verifying' : la tâche DnsManagement est la SOURCE DE VÉRITÉ du succès
  // de publication (un token invalide passait inaperçu via le cache DNS — #62).
  // Poll 5s jusqu'à la deadline ; failed → erreur (ressaisie token), published →
  // grille, pending au timeout → grille (non bloquant).
  useEffect(() => {
    if (phase !== "verifying") return
    const startedAt = Date.now()
    const tick = () => {
      dnsManagementStatusRef
        .current()
        .then(({ status }) => {
          if (!mountedRef.current) return
          const next = nextVerifyPhase(
            status,
            Date.now() - startedAt,
            VERIFY_DEADLINE_MS
          )
          if (next === "error") {
            setErrorCode("SETUP-DNS-PUBLISH-FAILED")
            setPhase("error")
          } else if (next === "grid") {
            setPhase("grid")
          }
        })
        .catch(() => {
          // Erreurs transitoires ignorées ; le tick suivant réessaie. Au-delà de
          // la deadline, on avance quand même vers la grille.
          if (mountedRef.current && Date.now() - startedAt >= VERIFY_DEADLINE_MS) {
            setPhase("grid")
          }
        })
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [phase])
```

(h) Ajouter le bloc UI `verifying` juste après le bloc `phase === "publishing"` :

```tsx
      {phase === "verifying" ? (
        <p className="inline-status">
          <Spinner size={14} />
          {t("wizard.dns.records.verifying")}
        </p>
      ) : null}
```

- [ ] **Step 4 : Lancer les tests purs**

Run: `bun run test -- src/components/setup/steps/DnsStep.test.tsx -t "nextVerifyPhase"`
Expected: PASS.

- [ ] **Step 5 : Mettre à jour `baseProps` + ajouter les cas composant**

Dans `src/components/setup/steps/DnsStep.test.tsx`, ajouter à `baseProps()` (après `gridStatus`) la nouvelle prop pour que les tests auto existants traversent `verifying → grid` :

```ts
  dnsManagementStatus: vi.fn(() =>
    Promise.resolve({ status: "published" as const })
  ),
```

Puis ajouter ces cas (le test « auto path … → grid » existant continue de passer grâce au `published` ci-dessus) :

```ts
it("auto path: DnsManagement Failed → error box + retry vide le token", async () => {
  const props = {
    ...baseProps(),
    dnsManagementStatus: vi.fn(() =>
      Promise.resolve({ status: "failed" as const })
    ),
  }
  wrap(<DnsStep {...props} />)

  fireEvent.click(screen.getByRole("button", { expanded: false }))
  fireEvent.click(screen.getByText("Cloudflare"))
  fireEvent.change(await screen.findByLabelText("Clé API"), {
    target: { value: "bad-token" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

  // Message d'erreur dédié au token invalide.
  expect(
    await screen.findByText(/La publication DNS a échoué/)
  ).toBeInTheDocument()

  // Retry → retour au formulaire, token vidé pour ressaisie.
  fireEvent.click(screen.getByText("Réessayer"))
  expect(await screen.findByText("Fournisseur DNS")).toBeInTheDocument()
  const token: HTMLInputElement = await screen.findByLabelText("Clé API")
  expect(token.value).toBe("")
})

it("auto path: pending affiche la phase de vérification, pas encore la grille", async () => {
  const props = {
    ...baseProps(),
    dnsManagementStatus: vi.fn(() =>
      Promise.resolve({ status: "pending" as const })
    ),
  }
  wrap(<DnsStep {...props} />)

  fireEvent.click(screen.getByRole("button", { expanded: false }))
  fireEvent.click(screen.getByText("Cloudflare"))
  fireEvent.change(await screen.findByLabelText("Clé API"), {
    target: { value: "tok" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }))

  // Spinner de vérification visible ; la grille n'est pas encore atteinte.
  expect(
    await screen.findByText(/Publication des enregistrements en cours/)
  ).toBeInTheDocument()
  expect(props.dnsManagementStatus).toHaveBeenCalled()
})
```

- [ ] **Step 6 : Lancer tous les tests `DnsStep`**

Run: `bun run test -- src/components/setup/steps/DnsStep.test.tsx`
Expected: PASS (cas existants auto/manuel + nouveaux failed/pending + `nextVerifyPhase`).

- [ ] **Step 7 : Commit**

```bash
git add src/components/setup/steps/DnsStep.tsx src/components/setup/steps/DnsStep.test.tsx
git commit -m "feat(setup): phase verifying pilotée par DnsManagement dans DnsStep (#62)"
```

---

## Task 5 : Câblage `SetupWizard` + route

**Files:**
- Modify: `src/components/setup/SetupWizard.tsx`
- Modify: `src/components/setup/SetupWizard.test.tsx`
- Modify: `src/routes/setup/index.tsx`

**Interfaces:**
- Consumes: prop `dnsManagementStatus` de `DnsStep` (Task 4) ; `dnsManagementStatusFn` (Task 2).
- Produces: `SetupWizard` accepte et relaie `dnsManagementStatus`.

- [ ] **Step 1 : Brancher la prop dans `SetupWizard.tsx`**

(a) Dans l'interface des props de `SetupWizard` (à côté de `gridStatus: () => Promise<{ origin: string; records: DnsGridRecord[] }>`), importer le type et ajouter la prop. En tête de fichier, à côté de l'import `AcmeStatus` :

```ts
import type { DnsManagementStatus } from "@/server/stalwart-dns"
```

Dans l'interface des props (après la ligne `gridStatus: …`) :

```ts
  dnsManagementStatus: () => Promise<{ status: DnsManagementStatus }>
```

(b) Déstructurer la prop dans la signature du composant (après `gridStatus,`) :

```ts
  dnsManagementStatus,
```

(c) La passer à `<DnsStep>` (après `gridStatus={gridStatus}`). `dnsManagementStatus` est une lecture GET passée directement, comme `gridStatus` et `acmeStatus` (pas de wrapper `withReauth`) :

```tsx
        gridStatus={gridStatus}
        dnsManagementStatus={dnsManagementStatus}
```

- [ ] **Step 2 : Fournir la prop dans `SetupWizard.test.tsx`**

Repérer l'objet de props de test (qui contient `gridStatus: vi.fn()…` et `acmeStatus: vi.fn()…`) et ajouter :

```ts
  dnsManagementStatus: vi
    .fn()
    .mockResolvedValue({ status: "published" as const }),
```

- [ ] **Step 3 : Brancher la route `src/routes/setup/index.tsx`**

(a) Ajouter `dnsManagementStatusFn` à l'import depuis `@/server/setup-actions` (à côté de `dnsGridStatusFn`, `acmeStatusFn`).

(b) Passer la prop à `<SetupWizard>` (après `gridStatus={() => dnsGridStatusFn()}`) :

```tsx
      dnsManagementStatus={() => dnsManagementStatusFn()}
```

- [ ] **Step 4 : Typecheck + suite complète**

Run: `bun run typecheck && bun run test`
Expected: PASS (toute la suite, incl. `SetupWizard.test.tsx`).

- [ ] **Step 5 : Commit**

```bash
git add src/components/setup/SetupWizard.tsx src/components/setup/SetupWizard.test.tsx src/routes/setup/index.tsx
git commit -m "feat(setup): câble dnsManagementStatus dans le wizard et la route (#62)"
```

---

## Vérification finale (avant PR)

- [ ] **Lint + typecheck + tests complets**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS partout.

- [ ] **Revue sécurité ciblée** : dispatcher l'agent `security-reviewer` sur le diff de branche (nouvelle server-fn = lecture admin, aucun secret exposé). Issue #62 demande une revue sécurité légère.

- [ ] **Revue conventions** : dispatcher l'agent `code-reviewer` sur le diff (couverture des fonctions pures, i18n, pattern server-fn).

- [ ] **(Optionnel) Validation réelle** : sur le serveur de test (getstalmail.com), rejouer le scénario token invalide via le wizard et confirmer que `DnsStep` affiche l'erreur « La publication DNS a échoué » au lieu d'une grille « verified ».

- [ ] **PR** : ouvrir la PR (`feat(setup): … (#62)`), laisser tourner CodeRabbit, traiter les retours (skill `superpowers:receiving-code-review`).

---

## Self-Review (couverture spec)

- Helper pur `classifyDnsManagement` → Task 1 ✓
- Lecture `getDnsManagementStatus` → Task 1 ✓
- Server-fn `dnsManagementStatusFn` (GET, non gardée comme acmeStatus) → Task 2 ✓
- Phase `verifying` bloquante, poll 5s, deadline 180s, failed/published/pending → Task 4 ✓
- Erreur explicite + ressaisie token (retry auto existant) → Task 4 (code Task 3) ✓
- Résolution live conservée en complément (gridStatus inchangé) → aucune modif de `dnsGridStatusHandler` ✓
- i18n FR + EN → Task 3 ✓
- Câblage SetupWizard + route → Task 5 ✓
- Sécurité (lecture admin, pas de secret) → vérif finale ✓
- Hors scope (failureReason brut, chemin manuel, gridStatus) → non touchés ✓
