# Plan 2b-ii — Stage A: Account step + DNS grid step

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the first two monitoring-phase screens of the setup wizard — **step 6 (admin account creation)** and **step 7 (DNS records: live auto-grid + manual sectioned table)** — wired to the existing Plan 2a backend via thin new server functions, in the established `.stalmail-wizard` design system.

**Architecture:** After the bootstrap→normal restart, the wizard enters the monitoring phase. The starting monitoring step is determined by `getStep()` (`deriveSetupStep()`), then the wizard advances **locally** (account → dns → ssl → done) — NOT by re-polling getStep, because `deriveSetupStep` stays on `'dns'` forever in manual mode (no `dnsManagement=Automatic` is ever set). Each step component performs the real Stalwart mutation through a server function. Collected data (name, password, provider, secret) lives in the in-session wizard context carried over from the collect phase.

**Tech Stack:** React 19, TanStack Start (server functions), Zod, i18next, the wizard UI primitives from 2b-i, Vitest. Backend modules from Plan 2a (all present): `stalwart-account.ts` (`createAdminAccount`, `WeakPasswordError`), `stalwart-dns.ts` (`createDnsServer`, `DNS_PROVIDERS`), `stalwart-domain.ts` (`getPrimaryDomain`, `setDnsManagementAutomatic`), `dns-zone.ts` (`parseZoneFile`), `dns-resolve.ts` (`resolveRecordStatus`), `jmap.ts`.

**Scope (Stage A only):** steps 6 + 7. Steps 8 (SSL/ACME) and 9 (Done) stay as the existing monitoring placeholder — Stage B builds them after a live ACME recon. Recovery-admin hardening is Stage C. NO new ACME/Task backend in this stage (the DNS task badge is derived from the per-record grid, exactly like the prototype).

**Design source of truth:** `docs/design/wizard-handoff/project/wizard/steps-monitor.jsx` (StepAccount, StepDns markup/phases), `.../wizard/ui.jsx` (StatusBadge, CopyIconBtn, DownloadButton), `.../wizard/styles.css` (the DNS-grid CSS classes), `.../wizard/i18n.js` (the `ac_*`, `n_*`, `t_*`, `st_*` strings). The prototype SIMULATES with timers; we replace the simulation with real server-function calls + polling. Match the visual output, not the simulation internals.

---

## Data model & navigation (read before implementing)

`WizardData` (src/components/setup/wizard-context.tsx) carries: `serverHostname`, `defaultDomain`, `provider`, `secret`, `name`, `password`. Map to the prototype's fields: `name`→adminName, `defaultDomain`→domain, `serverHostname`→hostname, `provider`, `secret`, `password`.

`SetupWizard` already holds `monitorStep` (set by `RestartScreen.onReady(step)`). Extend the monitoring rendering:
- `monitorStep === 'account'` → `<AccountStep>`; its completion calls `setMonitorStep('dns')`.
- `monitorStep === 'dns'` → `<DnsStep>`; its completion calls `setMonitorStep('ssl')`.
- `monitorStep === 'ssl' | 'done'` → the existing placeholder (Stage A leaves these).

Stepper `current`: account=6, dns=7 (ssl=8, done=9 for later). Update `screenToCurrent` / caption accordingly so the stepper highlights the right Activation dot during monitoring.

---

## Task 1: i18n — monitoring strings (account + DNS)

**Files:** Modify `src/i18n/resources.ts`; the parity test `src/i18n/resources.test.ts` must stay green.

Add a `wizard.account.monitor` group and a `wizard.dns.records` group (keep the existing collect keys). Use the FR/EN strings from `docs/design/wizard-handoff/project/wizard/i18n.js` (the `ac_*`, `n_*`, `t_*`, `st_*` keys). Use i18next `{{var}}` interpolation. Concretely add (FR shown; mirror in `en` for parity):

```ts
// inside wizard.account:
monitor: {
  creating: 'Création de {{email}}…',
  done: 'Compte {{email}} créé.',
  weakTitle: 'Mot de passe refusé',
  weak: 'Le serveur a jugé ce mot de passe trop faible. Choisissez-en un plus robuste.',
  newPassword: 'Nouveau mot de passe',
  retry: 'Créer le compte',
},
// new top-level group wizard.dns.records:
records: {
  title: 'Enregistrements DNS',
  subAuto: 'Publication automatique via {{provider}}, puis vérification de chaque enregistrement.',
  subManual: 'Créez ces enregistrements chez votre fournisseur DNS. La vérification se met à jour automatiquement.',
  connecting: 'Connexion à {{provider}}…',
  publishing: 'Publication des enregistrements…',
  task: 'Tâche DnsManagement',
  zoneFull: 'Fichier de zone complet',
  downloadTxt: 'Télécharger (.txt)',
  type: 'Type', name: 'Nom', value: 'Valeur', status: 'Statut',
  extTag: 'zone externe',
  extNote: "L'enregistrement A se trouve dans la zone {{zone}}, hors de la zone {{domain}} gérée via {{provider}} — créez-le manuellement chez le gestionnaire de cette zone.",
  errorHint: 'Introuvable lors de la dernière résolution. Nouvel essai dans 60 s.',
  background: 'La vérification continue en arrière-plan — vous pouvez poursuivre.',
  allOk: 'Tous les enregistrements sont vérifiés.',
  groups: {
    a:    { t: 'Adresse du serveur', d: 'Fait pointer {{host}} vers l’adresse IP du serveur.' },
    mx:   { t: 'Routage du courrier', d: 'Dirige le courrier de {{domain}} vers ce serveur.' },
    txt:  { t: 'Authentification — SPF, DKIM, DMARC', d: "Protège le domaine contre l'usurpation d'expéditeur." },
    srv:  { t: 'Découverte des services', d: 'Permet aux clients mail de trouver IMAP (993) et SMTP (465).' },
    cname:{ t: 'Autoconfiguration', d: 'Alias utilisé pour la configuration automatique des clients.' },
  },
},
// new group wizard.taskStatus:
taskStatus: { pending: 'En attente', inProgress: 'En cours', completed: 'Terminée', partial: 'Échec partiel' },
// new group wizard.recordStatus:
recordStatus: { verified: 'Vérifié', pending: 'En attente', error: 'Erreur' },
```

(EN equivalents are in `i18n.js`: `ac_*`, `n_*`, `t_*`, `st_*`. Mirror exactly. The `groups.*.d` strings use `{{host}}`/`{{domain}}` interpolation — keep placeholders identical in fr/en.)

- [ ] Add the keys to `fr` and `en`. Run `bun run test` (parity + placeholder tests green) and `bun run typecheck`.
- [ ] Commit: `feat(i18n): monitoring strings for account + DNS steps`.

---

## Task 2: wizard.css — DNS-grid + zone classes

**Files:** Modify `src/components/setup/wizard.css`.

Port the monitoring CSS classes that Task 1 of 2b-i intentionally omitted, from `docs/design/wizard-handoff/project/wizard/styles.css`, scoping each selector under `.stalmail-wizard` (descendant, matching the existing file's convention — read the file to match the style exactly). Add: `.step-body-wide`, `.dns-table-wrap`, `.dns-table` (+ th/td/tr variants, `.rec-type`, `.rec-name`, `.rec-value`, `.rec-tag`, `.row-error`), `.task-line`, `.task-label`, `.zonefile-wrap`, `.zonefile-head`, `.zonefile`, `.dns-manual`, `.dns-sect*`, `.rec-type-chip`, `.dns-sect-title`, `.dns-sect-desc`, `.dns-table-manual` (+ `.rec-name-cell`, `.rec-status-cell`), `.cell-copy`, `.cell-text`, `.rec-value-cell`, `.copy-icon-btn` (+ `:hover`, `.is-ok`), `.zonefile-actions`. (`.inline-status*`, `.copy-btn*`, `.recap*`, `.badge*` already exist — do not duplicate.)

- [ ] Add the classes. Run `bun run build` (must succeed).
- [ ] Commit: `feat(wizard): DNS-grid + zone CSS for monitoring`.

---

## Task 3: UI primitives — StatusBadge, CopyIconBtn, DownloadButton

**Files:** Create `src/components/setup/ui/monitor-primitives.tsx`; test `src/components/setup/ui/monitor-primitives.test.tsx`.

Port from `docs/design/wizard-handoff/project/wizard/ui.jsx` to typed TSX, reusing `Badge` from `./primitives` and icons from `./icons`:
- `StatusBadge({ status, labels }: { status: 'verified'|'pending'|'error'; labels: { verified: string; pending: string; error: string } })` → `Badge variant="success"` (verified) / `variant="destructive"` (error) / `variant="pending" pulse` (pending), with the matching label.
- `CopyIconBtn({ text, copyLabel, copiedLabel }: …)` → `.copy-icon-btn` button; clipboard write (use the same `Promise.resolve(navigator.clipboard.writeText(text)).catch(()=>{})` idiom as `CopyButton`); flips to `IconCheck` + `.is-ok` for ~1.6 s; `aria-label={copyLabel}`.
- `DownloadButton({ content, filename, label }: …)` → `.copy-btn.copy-btn-sm` with `IconDownload`; on click create a `Blob`, object URL, anchor, click, revoke (port from ui.jsx).

- [ ] Implement + tests: StatusBadge renders the right variant/label per status; CopyIconBtn calls clipboard with the text; DownloadButton creates and clicks an anchor (you can spy on `URL.createObjectURL` / `HTMLAnchorElement.prototype.click`).
- [ ] Run `bun run test` + `bun run typecheck`. Commit: `feat(wizard): StatusBadge, CopyIconBtn, DownloadButton primitives`.

---

## Task 4: Server function — createAdminAccountFn (weak-password aware)

**Files:** Modify `src/server/setup-actions.ts`; test `src/server/setup-actions.test.ts` (extend or create).

The UI must distinguish a weak-password rejection (→ inline retry) from other errors (→ generic alert). Server functions serialize thrown errors opaquely, so return a **discriminated result** instead of throwing for the weak case.

Add a handler + server fn (follow the existing lazy-import pattern in the file):

```ts
export type CreateAccountResult =
  | { status: 'ok' }
  | { status: 'weak'; message?: string }

export async function createAdminAccountHandler(
  { data }: { data: { name: string; password: string } },
): Promise<CreateAccountResult> {
  const { getPrimaryDomain } = await import('./stalwart-domain')
  const { createAdminAccount, WeakPasswordError } = await import('./stalwart-account')
  const domain = await getPrimaryDomain()
  if (!domain) throw new Error('No primary domain found')
  try {
    await createAdminAccount({ name: data.name, domainId: domain.id, password: data.password })
    return { status: 'ok' }
  } catch (e) {
    if (e instanceof WeakPasswordError) return { status: 'weak', message: e.description }
    throw e
  }
}

const createAccountSchema = z.object({ name: z.string().min(1), password: z.string().min(1) })

export const createAdminAccountFn = createServerFn({ method: 'POST' })
  .validator((d: { name: string; password: string }) => createAccountSchema.parse(d))
  .handler(createAdminAccountHandler)
```

(Add `import { z } from 'zod'` at the top.)

- [ ] Implement. Test `createAdminAccountHandler` with `vi.mock('./stalwart-domain')` + `vi.mock('./stalwart-account')` (the 2a mocking pattern — see `src/server/stalwart-account.test.ts`): returns `{status:'ok'}` on success; returns `{status:'weak'}` when `createAdminAccount` throws `WeakPasswordError`; rethrows other errors; throws when no primary domain.
- [ ] Run gate. Commit: `feat(setup): createAdminAccountFn server function`.

---

## Task 5: Server functions — DNS (create server, set management, grid status)

**Files:** Modify `src/server/setup-actions.ts`; extend `src/server/setup-actions.test.ts`.

```ts
export async function createDnsServerHandler(
  { data }: { data: { provider: string; secret: string } },
): Promise<{ dnsServerId: string }> {
  const { createDnsServer } = await import('./stalwart-dns')
  const id = await createDnsServer({ provider: data.provider as never, secret: data.secret })
  return { dnsServerId: id }
}

export async function setDnsManagementHandler(
  { data }: { data: { dnsServerId: string } },
): Promise<{ ok: true }> {
  const { getPrimaryDomain, setDnsManagementAutomatic } = await import('./stalwart-domain')
  const domain = await getPrimaryDomain()
  if (!domain) throw new Error('No primary domain found')
  await setDnsManagementAutomatic({ domainId: domain.id, dnsServerId: data.dnsServerId, origin: domain.name })
  return { ok: true }
}

export interface DnsGridRecord { name: string; type: string; value: string; status: 'verified' | 'pending' | 'error' }

export async function dnsGridStatusHandler(): Promise<{ origin: string; records: DnsGridRecord[] }> {
  const { getPrimaryDomain } = await import('./stalwart-domain')
  const { parseZoneFile } = await import('./dns-zone')
  const { resolveRecordStatus } = await import('./dns-resolve')
  const domain = await getPrimaryDomain()
  if (!domain?.dnsZoneFile) return { origin: domain?.name ?? '', records: [] }
  const parsed = parseZoneFile(domain.dnsZoneFile)
  const records = await Promise.all(
    parsed.map(async (r) => {
      const raw = await resolveRecordStatus(r) // 'verified' | 'mismatch' | 'missing' | 'unsupported'
      const status: DnsGridRecord['status'] =
        raw === 'verified' ? 'verified' : raw === 'mismatch' ? 'error' : 'pending'
      return { name: r.name, type: r.type, value: r.value, status }
    }),
  )
  return { origin: domain.name, records }
}

export const createDnsServerFn = createServerFn({ method: 'POST' })
  .validator((d: { provider: string; secret: string }) =>
    z.object({ provider: z.string().min(1), secret: z.string() }).parse(d))
  .handler(createDnsServerHandler)
export const setDnsManagementFn = createServerFn({ method: 'POST' })
  .validator((d: { dnsServerId: string }) => z.object({ dnsServerId: z.string().min(1) }).parse(d))
  .handler(setDnsManagementHandler)
export const dnsGridStatusFn = createServerFn({ method: 'GET' }).handler(dnsGridStatusHandler)
```

Status mapping rationale: `missing`/`unsupported` → `pending` (still propagating / not checkable), `mismatch` → `error`, `verified` → `verified`. (In the dev sandbox with example domains, records resolve `missing` → all `pending`; that is expected and correct.)

- [ ] Implement. Test each handler with mocked modules: `createDnsServerHandler` returns the id; `setDnsManagementHandler` resolves the domain then calls `setDnsManagementAutomatic` with `{domainId, dnsServerId, origin}` and throws when no domain; `dnsGridStatusHandler` maps statuses (verified→verified, mismatch→error, missing→pending) and returns `[]` when no zone file.
- [ ] Run gate. Commit: `feat(setup): DNS server/management/grid server functions`.

---

## Task 6: AccountStep component (step 6)

**Files:** Create `src/components/setup/steps/AccountStep.tsx`; test `src/components/setup/steps/AccountStep.test.tsx`. Reference: `steps-monitor.jsx` `StepAccount`.

Props: `{ name: string; password: string; domain: string; createAccount: (input: { name: string; password: string }) => Promise<CreateAccountResult>; onPasswordChange: (pw: string) => void; onNext: () => void }`.

Behavior (replace the prototype's timer simulation with the real call):
- On mount, `phase='creating'`; call `createAccount({ name, password })`.
  - result `{status:'ok'}` → `phase='done'`.
  - result `{status:'weak'}` → `phase='weak'` (show the destructive Alert + a new-password `Field` with `PasswordInput` + `StrengthMeter` + a "Créer le compte" button).
  - thrown error → `phase='error'` (inline destructive Alert + Retry that re-runs the create).
- Weak retry: validate `newPass.length >= 8 && newPass !== password`; call `createAccount({ name, password: newPass })`; on ok → `onPasswordChange(newPass)` + `phase='done'`.
- `done` → success inline-status + `StepNav onNext` (next label `wizard.common.next`).

Use `Spinner`, `Alert`, `Field`, `PasswordInput`, `StrengthMeter`, `StepNav`, `IconCheck` from the wizard ui. i18n: `wizard.account.monitor.*`, `wizard.account.show/hide/invalidPassword`, `wizard.account.strength.*`, `wizard.error.*`. Email = `${name}@${domain}`.

- [ ] Implement + test (mock `createAccount`): renders "creating" then "done" on ok and calls onNext; on `{status:'weak'}` shows the weak alert + new-password field, and a valid new password → ok → calls `onPasswordChange` + advances; a thrown error shows the retry alert. Use `vi.fn()` resolving the desired result; `await`/`findBy*` for the async phase.
- [ ] Run gate. Commit: `feat(wizard): AccountStep (step 6) wired to createAdminAccountFn`.

---

## Task 7: DnsStep component (step 7)

**Files:** Create `src/components/setup/steps/DnsStep.tsx`; test `src/components/setup/steps/DnsStep.test.tsx`. Reference: `steps-monitor.jsx` `StepDns`.

Props: `{ provider: string; secret: string; hostname: string; domain: string; createDnsServer: (i:{provider:string;secret:string})=>Promise<{dnsServerId:string}>; setDnsManagement: (i:{dnsServerId:string})=>Promise<{ok:true}>; gridStatus: ()=>Promise<{origin:string;records:DnsGridRecord[]}>; onNext: ()=>void }`.

Behavior:
- `isManual = provider === 'Manual'`.
- **Auto path** (`!isManual`): `phase='connecting'` → call `createDnsServer({provider,secret})` → `phase='publishing'` → call `setDnsManagement({dnsServerId})` → `phase='grid'`. On any error → inline destructive Alert + Retry.
- **Manual path**: `phase='grid'` immediately (no mutation).
- In `grid`: poll `gridStatus()` every ~5 s (clear on unmount), holding `records`. Render:
  - **auto** → the flat `.dns-table` (type/name/value/status) with `StatusBadge` per row.
  - **manual** → the sectioned `.dns-table-manual` grouped by type (DNS_GROUP_DEFS A/MX/TXT/SRV/CNAME), each group a `.dns-sect` row (chip + title `wizard.dns.records.groups.<key>.t` + desc `.d` interpolated with host/domain), then per-record rows with `CopyIconBtn` on name and value + `StatusBadge`; plus a `.zonefile-head` with `CopyButton`(zone text) + `DownloadButton`(`${domain}.zone.txt`).
  - external-zone note (auto, if any record name starts with the hostname and the hostname is outside the domain — reuse the `isExternalHost` helper logic; for Stage A you may compute `external` by `record.type==='A' && isExternalHost(hostname, domain)`): `Alert variant="warning"` with `wizard.dns.records.extNote`.
  - **task badge**: derive from records — all `verified` → `completed` (success); any `error` → `partial` (destructive); any `pending` → `inProgress` (pending, pulse); none yet → `pending`. Label from `wizard.taskStatus.*`.
  - footer help: `allVerified ? allOk (IconCheck) : background (IconInfo)`.
  - `StepNav onNext` (non-blocking — always enabled).

Zone text for copy/download: build from `records` as `name  3600 IN  TYPE  value` lines (port `zoneFileText` from steps-monitor.jsx). Provide `isExternalHost`/`hostZone` locally (or import the ones you may extract — simplest: duplicate the two small helpers, or move them to a shared `src/components/setup/dns-helpers.ts` and import in both DomainStep and DnsStep; if you extract, update DomainStep's import and keep its test green).

- [ ] Implement + test (mock the three fns): auto path transitions connecting→publishing→grid and renders the flat table once `gridStatus` resolves records; manual path renders the sectioned table immediately with copy buttons; task badge reflects record statuses; onNext advances. Use fake timers or `findBy*` with a short poll for the grid.
- [ ] Run gate. Commit: `feat(wizard): DnsStep (step 7) live grid + manual table`.

---

## Task 8: Wire steps 6–7 into SetupWizard

**Files:** Modify `src/components/setup/SetupWizard.tsx`, `src/routes/setup/index.tsx` (pass the new server fns), test `src/components/setup/SetupWizard.test.tsx`.

- Pass the new server functions into `SetupWizard` as props (like `submitBootstrap`/`pollStep`): `createAccount`, `createDnsServer`, `setDnsManagement`, `gridStatus`. In `routes/setup/index.tsx`, wire them to `createAdminAccountFn`/`createDnsServerFn`/`setDnsManagementFn`/`dnsGridStatusFn` (call with `{ data }` and unwrap, matching the existing `submitBootstrap` style).
- Replace the monitoring placeholder branch: when `monitorStep === 'account'` render `<AccountStep name={data.name ?? ''} password={data.password ?? ''} domain={data.defaultDomain ?? ''} createAccount={createAccount} onPasswordChange={(pw)=>setData({password:pw})} onNext={() => setMonitorStep('dns')} />`; when `monitorStep === 'dns'` render `<DnsStep provider={data.provider ?? 'Manual'} secret={data.secret ?? ''} hostname={data.serverHostname ?? ''} domain={data.defaultDomain ?? ''} createDnsServer={createDnsServer} setDnsManagement={setDnsManagement} gridStatus={gridStatus} onNext={() => setMonitorStep('ssl')} />`; when `monitorStep === 'ssl' | 'done'` keep the existing placeholder `<p data-testid="monitor-step">`.
- Stepper `current` during monitoring: account→6, dns→7, ssl→8, done→9. Update the `screenToCurrent`/caption logic so the right Activation dot lights up (e.g. a `monitorToCurrent` map used when `monitorStep` is set).
- Keep the collect-phase rendering unchanged.

- [ ] Implement. Update `SetupWizard.test.tsx`: add a test that with `initialStep="account"` (monitoring) the AccountStep renders (mock `createAccount` → `{status:'ok'}`) and advancing reaches the DnsStep; keep the collect-flow test green.
- [ ] Run the FULL gate: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`. Commit: `feat(wizard): wire account + DNS monitoring steps into the shell`.

---

## Task 9: Live verification + finish

- [ ] Resync dev deps if needed and ensure the stack is fresh-bootstrap: `docker compose -f compose.dev.yml run --rm installer` then `docker compose -f compose.dev.yml up -d` (or restart `app`). Vite HMR serves the branch.
- [ ] Drive the full flow against the real Stalwart: open `https://localhost/setup`, complete collect → submit → restart → **AccountStep** (create the admin against real Stalwart; verify success, and that a deliberately weak password triggers the weak-retry path) → **DnsStep** (Manual: verify the sectioned table + copy/download; Auto with a dummy provider+secret: verify it reaches the grid and polls — records will show `pending` since example DNS won't resolve, which is correct). Confirm the wizard then lands on the `ssl` placeholder.
- [ ] Note any real-API mismatch found (e.g. `x:Account/set` or `x:DnsServer/set` shape) and fix the underlying 2a module if needed (with a test). Report findings.
- [ ] Dispatch a final whole-branch review, then use **superpowers:finishing-a-development-branch** → push + open PR-A (`feat:` → triggers a release).

---

## Self-Review notes (author)

- **No new ACME/Task backend** in this stage — the DNS task badge is derived from the per-record grid (matches the prototype and `deriveSetupStep`'s reality). ACME is Stage B after live recon.
- **Manual-mode navigation**: monitoring advances locally (not via getStep), so manual DNS (which never sets `dnsManagement=Automatic`) still progresses. getStep only seeds the starting monitoring step after restart.
- **Reload mid-monitoring** loses in-session context (provider/secret/password); the happy path is continuous within the SPA. Documented limitation; full reload-recovery is out of Stage A scope.
- **Type consistency**: `CreateAccountResult` / `DnsGridRecord` exported from `setup-actions.ts` and consumed by the step components and SetupWizard props. `provider` cast to the `DnsProvider` enum at the `createDnsServer` boundary (`as never` in the handler, validated by zod string).
- **Dev-sandbox reality**: real DNS won't resolve example domains → grid shows `pending`; ACME can't complete (Stage B) — both are expected and the UI is non-blocking.
