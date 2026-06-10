# Plan 2b-ii — Stage B: SSL/ACME step + Done step

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the last two monitoring screens — **step 8 (SSL via ACME, non-blocking)** and **step 9 (Done / finalize)** — plus the ACME backend (`stalwart-acme.ts`) and the `configureAcmeFn` / `acmeStatusFn` / `finishSetupFn` server functions, wired into the wizard shell. This replaces the `ssl`/`done` placeholder left by Stage A.

**Architecture:** The SSL step creates an `x:AcmeProvider` (Let's Encrypt, TLS-ALPN-01) and flips the domain to `certificateManagement = Automatic`, then polls the `AcmeRenewal` task. It is **non-blocking**: the user can continue even while the task is `Pending`/`Failed` (Stalwart keeps retrying; `:8080/admin` stays reachable). The Done step calls `finishSetupFn` (`markSetupComplete()` → sets the `.stalmail-configured` flag, which makes `deriveSetupStep` return `'done'`), shows a recap + backup reminder, and links to `/login`.

**Tech Stack:** TanStack Start server functions, the existing `jmap.ts` transport, the wizard UI primitives, i18next, Vitest. Backend from Plan 2a: `jmap.ts` (`jmapCall`, `resolveAccountId`, `firstResponse`, `expectResult`), `stalwart-domain.ts` (`getPrimaryDomain`), `setup-flag.ts` (`markSetupComplete`).

**CRITICAL — verified v0.16 JMAP shapes (from the live recon, `docs/superpowers/specs/2026-06-09-stalwart-api-capture.md` §9):** the design's guessed shapes were ALL wrong. Use these EXACT shapes:
- `x:AcmeProvider/set` create: `challengeType` is an **enum string** `"TlsAlpn01"` (not `{@type}`); `contact` is a **map** `{ "mailto:<email>": true }` (not an array); `renewBefore` is optional (omit). Returns `created.<ref>.id`.
- `x:Domain/set` update: `certificateManagement = { "@type": "Automatic", "acmeProviderId": "<id>", "subjectAlternativeNames": { "<hostname>": true } }` — SAN is a **map**, optional.
- `x:Task/query` + `x:Task/get`: find the task with `@type === "AcmeRenewal"`; its `status.@type` ∈ `Pending` | `Retry` | `Failed`.

**Design source:** `docs/design/wizard-handoff/project/wizard/steps-monitor.jsx` (StepSsl, StepDone), `ui.jsx`, `styles.css` (`.step-done`, `.done-mark`), `i18n.js` (`sl_*`, `sa_*`, `f_*`).

**Out of scope:** recovery-admin hardening (Stage C).

---

## Data model & navigation

`SetupWizard` already renders the monitoring phase (Stage A). Extend:
- `monitorStep === 'ssl'` → `<SslStep>` (was placeholder); its `onNext` → `setMonitorStep('done')`.
- `monitorStep === 'done'` → `<DoneStep>` (was placeholder); terminal (button → `/login`).
- Stepper `current`: ssl=8, done=9 (already mapped in Stage A's `monitorToCurrent`).

`SslStep` needs `hostname` (= `data.serverHostname`) and `contactEmail` (= `${data.name}@${data.defaultDomain}`). `DoneStep` shows `data` recap + the SSL status carried from step 8 (lift `sslStatus` into wizard context via `setData`).

---

## Task 1: i18n — SSL + Done strings

**Files:** `src/i18n/resources.ts` (parity test must stay green).

Add (FR shown; mirror `en` from `i18n.js` `sl_*`/`sa_*`/`f_*`; keep placeholders identical):

```ts
// new group wizard.ssl:
ssl: {
  title: 'Certificat SSL',
  subtitle: 'Un certificat Let’s Encrypt est obtenu automatiquement via ACME.',
  configuring: 'Création du fournisseur ACME…',
  provider: 'Fournisseur ACME',
  providerValue: 'Let’s Encrypt · TLS-ALPN-01',
  contact: 'Contact',
  san: 'Nom couvert',
  task: 'Tâche AcmeRenewal',
  nonBlocking: 'Vous pouvez continuer : Stalwart réessaiera automatiquement et l’administration reste accessible sur :8080/admin.',
  failedHint: 'Le port 443 doit être joignable depuis Internet pour le défi TLS-ALPN.',
  status: { pending: 'En attente', failed: 'Échec — nouvel essai planifié', valid: 'Certificat actif' },
},
// new group wizard.done:
done: {
  title: 'Votre serveur est prêt',
  subtitle: 'Stalmail est configuré et opérationnel.',
  domain: 'Domaine', host: 'Serveur', ssl: 'Certificat', admin: 'Administrateur',
  sslOk: 'Actif (Let’s Encrypt)', sslPending: 'En cours d’obtention',
  backupTitle: 'Sauvegardez vos données',
  backup: 'Le volume stalmail-data contient vos e-mails et votre configuration. Mettez en place une sauvegarde régulière.',
  open: 'Ouvrir ma boîte mail', finishing: 'Finalisation…',
},
```

(EN: `Let's Encrypt`/`TLS-ALPN-01`, statuses `Pending`/`Failed — retry scheduled`/`Certificate active`, etc. — copy from `i18n.js`.)

- [ ] Add keys to `fr`+`en`; run `bun run test` + `bun run typecheck`. Commit: `feat(i18n): SSL + Done strings`.

---

## Task 2: wizard.css — Done screen classes

**Files:** `src/components/setup/wizard.css`.

Port (scoped under `.stalmail-wizard`, descendant convention) the omitted Done classes from `styles.css`: `.step-done`, `.done-mark`, `.step-done .step-header`. (`.recap*`, `.alert*`, `.inline-status*`, `.btn*`, `.task-line` already exist.)

- [ ] Add classes; `bun run build`. Commit: `feat(wizard): Done-screen CSS`.

---

## Task 3: stalwart-acme.ts (ACME provider + cert management + task status)

**Files:** Create `src/server/stalwart-acme.ts`; test `src/server/stalwart-acme.test.ts` (mock `./jmap` with the 2a `importActual` pattern; see `stalwart-account.test.ts`).

```ts
import { jmapCall, resolveAccountId, firstResponse, expectResult, JmapError } from './jmap'

const LETSENCRYPT_DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory'

export interface ConfigureAcmeInput {
  domainId: string
  hostname: string
  contactEmail: string
  /** Override the ACME directory (e.g. Let's Encrypt staging in tests). */
  directory?: string
}

/** Creates an AcmeProvider (LE / TLS-ALPN-01) and flips the domain to Automatic cert management. */
export async function configureAcme(input: ConfigureAcmeInput): Promise<string> {
  const accountId = await resolveAccountId()
  // 1) Create the ACME provider — VERIFIED v0.16 shapes (recon §9):
  //    challengeType: enum string; contact: map {"mailto:<email>": true}; renewBefore omitted.
  const createResp = await jmapCall([
    [
      'x:AcmeProvider/set',
      {
        accountId,
        create: {
          p1: {
            directory: input.directory ?? LETSENCRYPT_DIRECTORY,
            challengeType: 'TlsAlpn01',
            contact: { [`mailto:${input.contactEmail}`]: true },
          },
        },
      },
      '0',
    ],
  ])
  const created = (firstResponse(createResp)[1] as {
    created?: { p1?: { id: string } }
    notCreated?: { p1?: unknown }
  })
  const providerId = created.created?.p1?.id
  if (!providerId) throw new JmapError('ACME provider creation rejected', created.notCreated)

  // 2) Flip the domain to Automatic — SAN is a map {"<host>": true}, optional.
  const updResp = await jmapCall([
    [
      'x:Domain/set',
      {
        accountId,
        update: {
          [input.domainId]: {
            certificateManagement: {
              '@type': 'Automatic',
              acmeProviderId: providerId,
              subjectAlternativeNames: { [input.hostname]: true },
            },
          },
        },
      },
      '0',
    ],
  ])
  const upd = firstResponse(updResp)[1] as { updated?: Record<string, unknown>; notUpdated?: unknown }
  if (!upd.updated || !(input.domainId in upd.updated)) {
    throw new JmapError('domain certificateManagement update rejected', upd.notUpdated)
  }
  return providerId
}

export type AcmeStatus = 'pending' | 'failed' | 'valid'

/** Polls the AcmeRenewal task. NON-BLOCKING: Pending/Retry → pending, Failed → failed,
 *  no AcmeRenewal task found → valid (the renewal task is cleared once a cert is active).
 *  NOTE: the "valid" path could not be confirmed live (no public IP in dev); this heuristic
 *  is best-effort and should be revisited if a real cert is obtained. */
export async function getAcmeStatus(): Promise<AcmeStatus> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Task/query', { accountId }, '0'],
    ['x:Task/get', { accountId, '#ids': { resultOf: '0', name: 'x:Task/query', path: '/ids' } }, '1'],
  ])
  const list = (expectResult(responses, 1) as {
    list?: { '@type'?: string; status?: { '@type'?: string } }[]
  }).list ?? []
  const task = list.find((t) => t['@type'] === 'AcmeRenewal')
  if (!task) return 'valid'
  const s = task.status?.['@type']
  if (s === 'Failed') return 'failed'
  return 'pending' // Pending | Retry (and any other in-flight state)
}
```

- [ ] Implement. Tests (mock `jmapCall`/`resolveAccountId`, keep `JmapError` real via importActual):
  1. `configureAcme` → assert the `x:AcmeProvider/set` call carries `challengeType:'TlsAlpn01'` and `contact:{'mailto:a@b':true}` (NOT an array), then the `x:Domain/set` carries `certificateManagement.subjectAlternativeNames:{'mail.b':true}` and `acmeProviderId` from step 1; returns the providerId. Drive `jmapCall` to return `created.p1.id='prov1'` then `updated:{<domainId>:{}}`.
  2. `configureAcme` throws when provider create is `notCreated` / domain update is `notUpdated`.
  3. `getAcmeStatus`: AcmeRenewal task `status.@type='Pending'`→'pending'; `'Failed'`→'failed'; no AcmeRenewal task→'valid'.
- [ ] Run gate. Commit: `feat(setup): stalwart-acme module (provider, cert management, task status)`.

---

## Task 4: Server functions — configureAcmeFn, acmeStatusFn, finishSetupFn

**Files:** `src/server/setup-actions.ts`; extend `src/server/setup-actions.test.ts`.

```ts
export async function configureAcmeHandler(
  { data }: { data: { hostname: string; contactEmail: string } },
): Promise<{ ok: true }> {
  const { getPrimaryDomain } = await import('./stalwart-domain')
  const { configureAcme } = await import('./stalwart-acme')
  const domain = await getPrimaryDomain()
  if (!domain) throw new Error('No primary domain found')
  await configureAcme({ domainId: domain.id, hostname: data.hostname, contactEmail: data.contactEmail })
  return { ok: true }
}

export async function acmeStatusHandler(): Promise<{ status: AcmeStatus }> {
  const { getAcmeStatus } = await import('./stalwart-acme')
  return { status: await getAcmeStatus() }
}

export async function finishSetupHandler(): Promise<{ ok: true }> {
  const { markSetupComplete } = await import('./setup-flag')
  markSetupComplete()
  return { ok: true }
}

export const configureAcmeFn = createServerFn({ method: 'POST' })
  .validator((d: { hostname: string; contactEmail: string }) =>
    z.object({ hostname: z.string().min(1), contactEmail: z.string().min(1) }).parse(d))
  .handler(configureAcmeHandler)
export const acmeStatusFn = createServerFn({ method: 'GET' }).handler(acmeStatusHandler)
export const finishSetupFn = createServerFn({ method: 'POST' }).handler(finishSetupHandler)
```

(Import `type { AcmeStatus } from './stalwart-acme'` as a top-level type-only import.)

- [ ] Implement + tests (mock `./stalwart-domain`, `./stalwart-acme`, `./setup-flag`): `configureAcmeHandler` resolves the domain then calls `configureAcme({domainId, hostname, contactEmail})` and throws on no domain; `acmeStatusHandler` returns the mapped status; `finishSetupHandler` calls `markSetupComplete` and returns `{ok:true}`. Keep prior setup-actions tests green (shared `./stalwart-domain` mock — extend it).
- [ ] Run gate. Commit: `feat(setup): configureAcmeFn, acmeStatusFn, finishSetupFn`.

---

## Task 5: SslStep component (step 8)

**Files:** Create `src/components/setup/steps/SslStep.tsx`; test `…/SslStep.test.tsx`. Reference: `steps-monitor.jsx` `StepSsl`.

Props: `{ hostname: string; contactEmail: string; configureAcme: (i:{hostname:string;contactEmail:string})=>Promise<{ok:true}>; acmeStatus: ()=>Promise<{status:AcmeStatus}>; onStatusChange:(s:AcmeStatus)=>void; onNext:()=>void }` (import `type { AcmeStatus }` from '@/server/stalwart-acme').

Behavior:
- `phase: 'configuring' | 'monitor' | 'error'`, `status: AcmeStatus`.
- On mount: phase='configuring'; `await configureAcme({hostname, contactEmail})`; phase='monitor'; then poll `acmeStatus()` every ~5s (cleanup on unmount; `mountedRef` guard), `setStatus(res.status)` and `onStatusChange(res.status)`. On configure throw → phase='error' + inline Alert + Retry.
- Render (StepHeader, Spinner, Alert, Badge, `.recap`, StepNav):
  - configuring → inline-status Spinner + `wizard.ssl.configuring`.
  - monitor → a `.recap` with rows: provider (`wizard.ssl.providerValue`), contact (mono, contactEmail), san (mono, hostname), task (`wizard.ssl.task`) → `<Badge variant=… pulse=…>` from status (pending→pending+pulse, failed→destructive, valid→success) with `wizard.ssl.status.*`. If status==='failed' → warning Alert (`wizard.ssl.failedHint`). If status!=='valid' → help line (IconInfo) `wizard.ssl.nonBlocking`. Then `StepNav onNext` (always enabled — non-blocking; nextLabel `wizard.common.next`).
  - error → destructive Alert + Retry StepNav.

- [ ] Implement + test (mock the 2 fns): configuring→monitor; status 'pending' shows the pending badge + non-blocking note; status 'failed' shows the failed hint; `onNext` advances; configure rejection shows error+retry. `onStatusChange` is called with the polled status.
- [ ] Run gate. Commit: `feat(wizard): SslStep (step 8) non-blocking ACME`.

---

## Task 6: DoneStep component (step 9)

**Files:** Create `src/components/setup/steps/DoneStep.tsx`; test `…/DoneStep.test.tsx`. Reference: `steps-monitor.jsx` `StepDone`.

Props: `{ domain: string; hostname: string; adminEmail: string; sslStatus: AcmeStatus; finishSetup: ()=>Promise<{ok:true}>; }` (and a link target for the mailbox button — render an `<a href="/login" className="btn btn-primary btn-lg">`).

Behavior:
- `finishing: boolean` (start true). On mount: `await finishSetup()` then `setFinishing(false)`. (On error, still show the screen — finalize is idempotent; optionally surface a console note.)
- finishing → inline-status Spinner + `wizard.done.finishing`.
- done → `.step-done`: `.done-mark` (IconCheck), StepHeader (`wizard.done.title`/`subtitle`), a `.recap` (domain, host, ssl badge [sslStatus==='valid' ? success `wizard.done.sslOk` : pending+pulse `wizard.done.sslPending`], admin email), an info Alert (`wizard.done.backupTitle`/`backup`), and `<a href="/login" className="btn btn-primary btn-lg"><IconMail/>{wizard.done.open}</a>`.

- [ ] Implement + test (mock finishSetup): renders finishing then the done recap; the SSL badge reflects `sslStatus`; the mailbox link points to `/login`; finishSetup is called once.
- [ ] Run gate. Commit: `feat(wizard): DoneStep (step 9) finalize + recap`.

---

## Task 7: Wire SSL + Done into SetupWizard + route

**Files:** `src/components/setup/SetupWizard.tsx`, `src/routes/setup/index.tsx`, `SetupWizard.test.tsx`.

- Add props `configureAcme`, `acmeStatus`, `finishSetup` to SetupWizard (wired in the route to `configureAcmeFn`/`acmeStatusFn`/`finishSetupFn` with the `{data}` unwrap). Hold `sslStatus` in wizard state (`data.sslStatus`?) — add `sslStatus?: AcmeStatus` to `WizardData` (wizard-context.tsx) so DoneStep can read it.
- Replace the placeholder: `monitorStep === 'ssl'` → `<SslStep hostname={data.serverHostname ?? ''} contactEmail={`${data.name ?? ''}@${data.defaultDomain ?? ''}`} configureAcme={configureAcme} acmeStatus={acmeStatus} onStatusChange={(s)=>setData({sslStatus:s})} onNext={()=>setMonitorStep('done')} />`; `monitorStep === 'done'` → `<DoneStep domain={data.defaultDomain ?? ''} hostname={data.serverHostname ?? ''} adminEmail={`${data.name ?? ''}@${data.defaultDomain ?? ''}`} sslStatus={data.sslStatus ?? 'pending'} finishSetup={finishSetup} />`.
- Keep the monitoring placeholder branch only for any other/unknown step.

- [ ] Implement. Update `SetupWizard.test.tsx`: add the 3 new props to all renders (mock fns); add a test that `initialStep="ssl"` renders SslStep and advancing reaches DoneStep. Keep prior tests green.
- [ ] FULL gate: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`. Commit: `feat(wizard): wire SSL + Done monitoring steps`.

---

## Task 8: Live verification + finish

- [ ] Fresh-bootstrap the dev stack; drive collect → submit → restart → account → dns → **ssl**: verify `configureAcmeFn` succeeds against the real Stalwart (the recon-corrected JMAP shapes create the provider + flip the domain to Automatic) and the SSL step polls `acmeStatusFn` (status will be `pending`/`failed` — no public IP — which is the non-blocking design). Continue to **done**: verify `finishSetupFn` sets the flag and the recap + `/login` link render; reload `/setup` → `getStep()` now returns `done`.
- [ ] Report any JMAP mismatch (there should be none — shapes are recon-verified). Dispatch a final whole-branch review; then **superpowers:finishing-a-development-branch** → push + open PR-B.

---

## Self-Review notes (author)

- **Recon-verified shapes** are embedded in Task 3 — the single highest-risk area is de-risked. `challengeType` string, `contact` map, SAN map: all confirmed live.
- **Non-blocking** SSL: Continue is always enabled; `acmeStatus` heuristic maps Pending/Retry→pending, Failed→failed, no-task→valid (best-effort `valid`, noted).
- **`finishSetupFn`** sets `.stalmail-configured` → `deriveSetupStep` returns `done`; the wizard is then complete (redirect to `/login`).
- **Type consistency**: `AcmeStatus` exported from `stalwart-acme.ts`, threaded through server fns, SslStep/DoneStep props, and `WizardData.sslStatus`.
- **Dev-sandbox reality**: the cert never completes (no public IP/443); the flow is fully exercisable nonetheless (provider created, domain Automatic, task Pending, finalize OK).
