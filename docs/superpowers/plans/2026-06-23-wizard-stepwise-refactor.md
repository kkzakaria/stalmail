# Refactor du wizard de setup — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre le wizard en machine linéaire pilotée par l'état serveur où chaque étape **collecte SA saisie puis l'exécute** (marche avant, ré-exécution idempotente), avec l'ordre `Welcome → Domaine → DNS → SSL → Compte → Done`.

**Architecture:** Supprimer le découpage « collecte (1-5) puis activation (6-9) » et le `WizardData` context. La phase « activation » actuelle (déjà pilotée par `deriveSetupStep`, exécutant en ligne) devient le modèle de **toutes** les étapes post-bootstrap. Chaque étape collecte son input là où il est consommé. `deriveSetupStep` reste le point de vérité unique de la reprise.

**Tech Stack:** TanStack Start (server functions), React 19, react-i18next, Vitest + Testing Library, Zod, JMAP (Stalwart v0.16).

## Global Constraints

- **Spec :** `docs/superpowers/specs/2026-06-23-wizard-stepwise-refactor-design.md` (source de vérité).
- **Séquence cible :** `Welcome → Domaine [submit→redémarrage] → DNS → SSL → Compte → Done`.
- **`deriveSetupStep` (nouvel ordre) :** `done` si `isSetupComplete()` ; `collect` si bootstrap ; `dns` si domaine absent ou DNS non configuré ; `ssl` si `certificateManagement != Automatic` ET pas de marqueur `sslAcknowledged` ; `account` si pas de compte user ; sinon `done`.
- **Signaux serveur :** DNS = domaine présent ET (`dnsManagement['@type']==='Automatic'` **ou** marqueur `dnsConfigured` (Manuel)) ; SSL = `certificateManagement['@type']==='Automatic'` **ou** marqueur dédié `sslAcknowledged` (Manuel) ; Compte = compte user non-système présent.
- **Mode Manuel :** `setDnsManagement({'@type':'Manual'})` + marqueur `dnsConfigured` persistant ; étape SSL informative (pas de `configureAcme`) car DNS-01 exige un `dnsServerId`, franchie via le marqueur dédié `sslAcknowledged` (`isSslAcknowledged()`/`markSslAcknowledged()`, calque de `dnsConfigured`).
- **Erreurs (uniforme) :** message générique i18n + **code opaque stable** (table fermée serveur, ex. `SETUP-DNS-REJECTED`) + Réessayer ; on reste sur l'étape ; aucune fuite de détail JMAP/HTTP (R6).
- **Redémarrage :** spinner + légende générique non-technique (« Configuration en cours… ») ; échec → message + code + Réessayer.
- **i18n :** tout en français via clés `t('...')`, jamais de texte en dur.
- **Tests :** fonctions pures testées isolément ; composants présentationnels (props injectées, pas de hooks de route). Le pre-commit (`lint && typecheck && test`) ne doit pas être contourné.
- **Hors scope :** providers multi-credentials (Route53/Lightsail/Tsig) ; pas de modif backend Stalwart.

---

## Structure des fichiers

**Serveur (modifiés/créés)**
- `src/server/setup-flag.ts` — ajout marqueur `dnsConfigured` (`isDnsConfigured`/`markDnsConfigured`).
- `src/server/setup-state.ts` — `deriveSetupStep` réordonné + gate SSL + marqueur.
- `src/server/stalwart-domain.ts` — `setDnsManagementManual` + helper `findDnsServerId` (idempotence).
- `src/server/stalwart-dns.ts` — `createDnsServer` idempotent (réutilise l'existant).
- `src/server/setup-errors.ts` *(nouveau)* — table fermée de codes + `toSetupErrorCode`.
- `src/server/setup-actions.ts` — `setDnsManagementManualFn` ; handlers mappent vers codes ; suppression rien.

**Client (modifiés/créés/supprimés)**
- `src/components/setup/steps/DomainStep.tsx` — exécute `submitBootstrap` au « Suivant ».
- `src/components/setup/steps/DnsStep.tsx` — intègre le formulaire provider+token (fusion `DnsProviderStep`), exécute auto/Manuel.
- `src/components/setup/steps/AccountStep.tsx` — intègre le champ `name` (fusion `AdminAccountStep`).
- `src/components/setup/steps/SslStep.tsx` — inchangé fonctionnellement (déplacé avant Compte) ; gère le cas Manuel (informatif).
- `src/components/setup/SetupWizard.tsx` — réécriture orchestration (linéaire, serveur-dirigée, sans context).
- `src/components/setup/ui/StepperH.tsx` — séquence linéaire (suppression des groupes).
- `src/components/setup/ui/SetupErrorBox.tsx` *(nouveau)* — message + code + Réessayer (réutilisable).
- `src/routes/setup/index.tsx` — câblage des fns (ajout `setDnsManagementManualFn`).
- `src/i18n/resources.ts` — étapes réordonnées, légende redémarrage, codes d'erreur, suppression clés recap/dnsProvider obsolètes.
- **Supprimés :** `DnsProviderStep.tsx`, `AdminAccountStep.tsx`, `RecapStep.tsx`, `wizard-context.tsx` (+ leurs tests).

---

## Task 1 : Marqueur de progression DNS (`dnsConfigured`)

**Files:**
- Modify: `src/server/setup-flag.ts`
- Test: `src/server/setup-flag.test.ts`

**Interfaces:**
- Produces: `isDnsConfigured(): boolean`, `markDnsConfigured(): void` (fichier `.stalmail-dns-configured` dans `STALMAIL_RUN_DIR`).

- [ ] **Step 1 : Test d'abord**

```typescript
// dans setup-flag.test.ts — ajouter
import { isDnsConfigured, markDnsConfigured } from './setup-flag'

it('dnsConfigured: false avant, true après markDnsConfigured', () => {
  process.env.STALMAIL_RUN_DIR = tmpDir // dossier temp du test existant
  expect(isDnsConfigured()).toBe(false)
  markDnsConfigured()
  expect(isDnsConfigured()).toBe(true)
})
```

- [ ] **Step 2 : Lancer le test → échoue** (`isDnsConfigured` non exporté).

Run: `bun run test src/server/setup-flag.test.ts`

- [ ] **Step 3 : Implémenter**

```typescript
// setup-flag.ts — ajouter sous flagPath()
function dnsFlagPath(): string {
  return `${process.env.STALMAIL_RUN_DIR ?? '/run/stalmail'}/.stalmail-dns-configured`
}
export function isDnsConfigured(): boolean {
  return existsSync(dnsFlagPath())
}
export function markDnsConfigured(): void {
  writeFileSync(dnsFlagPath(), new Date().toISOString(), 'utf-8')
}
```

- [ ] **Step 4 : Test vert.** Run: `bun run test src/server/setup-flag.test.ts`
- [ ] **Step 5 : Commit** — `git commit -m "feat(setup): marqueur dnsConfigured persistant"`

---

## Task 2 : `deriveSetupStep` — nouvel ordre + gate SSL + marqueur

**Files:**
- Modify: `src/server/setup-state.ts`
- Test: `src/server/setup-state.test.ts`

**Interfaces:**
- Consumes: `isDnsConfigured` (Task 1), `getPrimaryDomain` (existant, expose `dnsManagement` et `certificateManagement`).
- Produces: `deriveSetupStep()` avec ordre `collect → dns → ssl → account → done`.

- [ ] **Step 1 : Tests d'abord** (mocks JMAP/flags comme l'existant) — couvrir :
  - bootstrap → `'collect'` ;
  - normal, dnsManagement ≠ Automatic, pas de marqueur → `'dns'` ;
  - dnsManagement Automatic, certificateManagement ≠ Automatic → `'ssl'` ;
  - DNS+SSL ok, pas de compte user → `'account'` ;
  - tout ok → `'done'` ;
  - **Manuel** : dnsManagement ≠ Automatic mais `isDnsConfigured()===true` → on **dépasse** `'dns'` (→ `'ssl'`).

```typescript
it("Manuel : marqueur dnsConfigured fait dépasser l'étape dns", async () => {
  // bootstrap=false, domaine dnsManagement Manual, isDnsConfigured=true,
  // certificateManagement absent → attendu 'ssl'
  expect(await deriveSetupStep()).toBe('ssl')
})
it('ordre : DNS avant compte (compte présent mais DNS non configuré → dns)', async () => {
  expect(await deriveSetupStep()).toBe('dns')
})
```

- [ ] **Step 2 : Lancer → échoue** (ancien ordre `account` avant `dns`).
- [ ] **Step 3 : Implémenter**

```typescript
import { isSetupComplete, isDnsConfigured, isSslAcknowledged } from './setup-flag'
// ... helpers inchangés (hasUserAdminAccount, isSystemAdmin) ...

function isDnsManaged(domain: StalwartDomain | null): boolean {
  // Domaine absent ⇒ jamais "managed" (doit router vers l'étape dns).
  if (!domain) return false
  return domain.dnsManagement?.['@type'] === 'Automatic' || isDnsConfigured()
}
function isSslConfigured(domain: StalwartDomain | null): boolean {
  return (domain as { certificateManagement?: { '@type'?: string } } | null)
    ?.certificateManagement?.['@type'] === 'Automatic'
}

export async function deriveSetupStep(): Promise<SetupStep> {
  if (isSetupComplete()) return 'done'
  if (await isBootstrapMode()) return 'collect'
  const domain = await getPrimaryDomain()
  if (!isDnsManaged(domain)) return 'dns'
  // SSL franchi : auto (certificateManagement Automatic) OU marqueur dédié Manuel.
  if (!isSslConfigured(domain) && !isSslAcknowledged()) return 'ssl'
  if (!(await hasUserAdminAccount())) return 'account'
  return 'done'
}
```

(Importer `StalwartDomain` depuis `./stalwart-domain` si pas déjà typé.)

- [ ] **Step 4 : Tests verts.** Run: `bun run test src/server/setup-state.test.ts`
- [ ] **Step 5 : Commit** — `git commit -m "feat(setup): deriveSetupStep DNS→SSL→Compte + gate SSL/marqueur"`

---

## Task 3 : Gestion DNS Manuel côté serveur

**Files:**
- Modify: `src/server/stalwart-domain.ts`, `src/server/setup-actions.ts`
- Test: `src/server/stalwart-domain.test.ts`, `src/server/setup-actions.test.ts`

**Interfaces:**
- Produces: `setDnsManagementManual({ domainId }): Promise<void>` ; server fn `setDnsManagementManualFn` (POST) → `setDnsManagementManual` + `markDnsConfigured`.

- [ ] **Step 1 : Test (stalwart-domain)** — `setDnsManagementManual` envoie `Domain/set update { [domainId]: { dnsManagement: { '@type': 'Manual' } } }`, throw `JmapError` si `notUpdated`.

```typescript
it('setDnsManagementManual pose dnsManagement Manual', async () => {
  mj.mockResolvedValue([['x:Domain/set', { updated: { dom1: {} } }, '0']])
  await setDnsManagementManual({ domainId: 'dom1' })
  const [[, args]] = mj.mock.calls[0][0] as [[string, Record<string, unknown>, string]]
  expect((args.update as any).dom1.dnsManagement).toEqual({ '@type': 'Manual' })
})
```

- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter (stalwart-domain.ts)**

```typescript
export async function setDnsManagementManual(opts: { domainId: string }): Promise<void> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:Domain/set', { accountId, update: { [opts.domainId]: { dnsManagement: { '@type': 'Manual' } } } }, '0'],
  ])
  const result = firstResponse(responses)[1] as { updated?: Record<string, unknown>; notUpdated?: unknown }
  if (!result.updated || !(opts.domainId in result.updated)) {
    throw new JmapError('domain dnsManagement (manual) update rejected', result.notUpdated)
  }
}
```

- [ ] **Step 4 : Server fn (setup-actions.ts)**

```typescript
export async function setDnsManagementManualHandler(): Promise<{ ok: true }> {
  const { getPrimaryDomain, setDnsManagementManual } = await import('./stalwart-domain')
  const { markDnsConfigured } = await import('./setup-flag')
  const domain = await getPrimaryDomain()
  if (!domain) throw new Error('No primary domain found')
  await setDnsManagementManual({ domainId: domain.id })
  markDnsConfigured()
  return { ok: true }
}
export const setDnsManagementManualFn = createServerFn({ method: 'POST' }).handler(setDnsManagementManualHandler)
```

- [ ] **Step 5 : Tests verts** (domain + actions). Run: `bun run test src/server/stalwart-domain.test.ts src/server/setup-actions.test.ts`
- [ ] **Step 6 : Commit** — `git commit -m "feat(setup): setDnsManagementManual + marqueur (chemin DNS Manuel)"`

---

## Task 4 : `createDnsServer` idempotent

**Files:**
- Modify: `src/server/stalwart-dns.ts`
- Test: `src/server/stalwart-dns.test.ts`

**Interfaces:**
- Produces: `createDnsServer` réutilise un DnsServer existant du même provider au lieu d'en créer un doublon (reprise/retry).

- [ ] **Step 1 : Test** — si `DnsServer/query` renvoie un id existant, `createDnsServer` le **renvoie sans créer** (pas d'appel `create`). Sinon, crée comme aujourd'hui (avec `secret: { '@type': 'Value', secret }`, déjà couvert).

```typescript
it('réutilise un DnsServer existant (idempotence) sans recréer', async () => {
  mj.mockResolvedValueOnce([['x:DnsServer/query', { ids: ['srvX'] }, '0']]) // query
  const id = await createDnsServer({ provider: 'Cloudflare', secret: 'tok' })
  expect(id).toBe('srvX')
  // pas de second appel create
  expect(mj.mock.calls.length).toBe(1)
})
```

- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** — préfixer `createDnsServer` d'une requête `DnsServer/query` (filtrer par `@type`/provider si le filtre est supporté ; sinon query+get et matcher le provider) ; si trouvé, renvoyer l'id ; sinon `create` (corps actuel inchangé).

```typescript
export async function findDnsServerId(provider: DnsProvider): Promise<string | null> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    ['x:DnsServer/query', { accountId }, '0'],
    ['x:DnsServer/get', { accountId, '#ids': { resultOf: '0', name: 'x:DnsServer/query', path: '/ids' } }, '1'],
  ])
  const list = (expectResult(responses, 1) as { list?: Array<{ id: string; '@type'?: string }> }).list ?? []
  return list.find((s) => s['@type'] === provider)?.id ?? null
}
// au début de createDnsServer : const existing = await findDnsServerId(input.provider); if (existing) return existing
```

- [ ] **Step 4 : Tests verts.** Run: `bun run test src/server/stalwart-dns.test.ts`
- [ ] **Step 5 : Commit** — `git commit -m "feat(setup): createDnsServer idempotent (réutilise l'existant)"`

---

## Task 5 : Table de codes d'erreur

**Files:**
- Create: `src/server/setup-errors.ts`, `src/server/setup-errors.test.ts`
- Modify: `src/server/setup-actions.ts` (handlers d'exécution mappent vers code)

**Interfaces:**
- Produces: `SETUP_CODES` (union de littéraux), `class SetupError extends Error { code }`, `toSetupErrorCode(err, fallback): SetupErrorCode`. Les handlers `createDnsServer`/`setDnsManagement(Manual)`/`createAdminAccount`/`configureAcme` catch et `throw new SetupError(code)`. Le message de l'`Error` propagé au client **est** le code (opaque).

- [ ] **Step 1 : Test du mapper** — `toSetupErrorCode(new JmapError('dns server creation rejected'))` → `'SETUP-DNS-REJECTED'` ; `WeakPasswordError` → `'SETUP-ACCOUNT-WEAK'` ; inconnu → fallback fourni.

- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter**

```typescript
export const SETUP_CODES = [
  'SETUP-RESTART-TIMEOUT', 'SETUP-DNS-REJECTED', 'SETUP-DNS-MANAGEMENT-REJECTED',
  'SETUP-ACCOUNT-WEAK', 'SETUP-ACCOUNT-REJECTED', 'SETUP-SSL-REJECTED', 'SETUP-UNKNOWN',
] as const
export type SetupErrorCode = (typeof SETUP_CODES)[number]
export class SetupError extends Error {
  constructor(readonly code: SetupErrorCode) { super(code); this.name = 'SetupError' }
}
export function toSetupErrorCode(err: unknown, fallback: SetupErrorCode): SetupErrorCode {
  if (err instanceof SetupError) return err.code
  const name = (err as { name?: string })?.name
  if (name === 'WeakPasswordError') return 'SETUP-ACCOUNT-WEAK'
  const msg = (err as { message?: string })?.message ?? ''
  if (/dns server creation rejected/.test(msg)) return 'SETUP-DNS-REJECTED'
  if (/dnsManagement.*rejected/.test(msg)) return 'SETUP-DNS-MANAGEMENT-REJECTED'
  return fallback
}
```

- [ ] **Step 4 : Wirer les handlers** — entourer chaque appel risqué :

```typescript
// ex. createDnsServerHandler
try { /* createDnsServer(...) */ }
catch (e) { const { SetupError, toSetupErrorCode } = await import('./setup-errors'); throw new SetupError(toSetupErrorCode(e, 'SETUP-DNS-REJECTED')) }
```

(idem pour setDnsManagement(Manual)/createAdminAccount/configureAcme avec leur fallback. `createAdminAccountHandler` conserve son retour `{status:'weak'}` pour le mot de passe faible — le code n'écrase pas ce flux dédié ; les autres rejets → `SETUP-ACCOUNT-REJECTED`.)

- [ ] **Step 5 : Tests verts** (errors + actions). Run: `bun run test src/server/setup-errors.test.ts src/server/setup-actions.test.ts`
- [ ] **Step 6 : Commit** — `git commit -m "feat(setup): table fermée de codes d'erreur (R6)"`

---

## Task 6 : `SetupErrorBox` (UI réutilisable)

**Files:**
- Create: `src/components/setup/ui/SetupErrorBox.tsx`, `src/components/setup/ui/SetupErrorBox.test.tsx`

**Interfaces:**
- Produces: `<SetupErrorBox code messageKey onRetry />` → message générique `t(messageKey)` + code en petit (copiable) + bouton Réessayer.

- [ ] **Step 1 : Test** — rend le message localisé, le code brut, et appelle `onRetry` au clic.
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter**

```tsx
export function SetupErrorBox({ code, messageKey, onRetry }: { code: string; messageKey: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="...">
      <p className="text-destructive">{t(messageKey)}</p>
      <code className="text-xs opacity-70">{code}</code>
      <button onClick={onRetry}>{t('wizard.common.retry')}</button>
    </div>
  )
}
```

- [ ] **Step 4 : Test vert.** Run: `bun run test src/components/setup/ui/SetupErrorBox.test.tsx`
- [ ] **Step 5 : Commit** — `git commit -m "feat(setup): SetupErrorBox (message+code+retry)"`

---

## Task 7 : i18n — étapes, redémarrage, codes d'erreur

**Files:**
- Modify: `src/i18n/resources.ts`

**Interfaces:**
- Produces: nouvelles clés consommées par les tâches suivantes.

- [ ] **Step 1 : Éditer (fr + en)**
  - `wizard.steps` : réduire à `welcome, domain, dns, ssl, account, done` (supprimer `dnsProvider`, `dnsRecords`, `recap`, `admin` ; `dns` = libellé « DNS », `account` = « Compte »).
  - `wizard.restart` : ajouter/renommer `configuring` = « Configuration en cours… » (fr) / "Setting things up…" (en), retirer le sous-titre technique.
  - `wizard.error.codes.*` : un message générique par code (`SETUP-RESTART-TIMEOUT`, `SETUP-DNS-REJECTED`, …) ; + `wizard.error.generic`.
  - Supprimer les clés devenues mortes (`wizard.recap.*`, `wizard.groups.*` si le stepper ne groupe plus).
- [ ] **Step 2 : Typecheck** (les composants référenceront ces clés). Run: `bun run typecheck`
- [ ] **Step 3 : Commit** — `git commit -m "i18n(setup): étapes réordonnées, légende redémarrage, codes d'erreur"`

---

## Task 8 : `DomainStep` collecte + exécute (`submitBootstrap`)

**Files:**
- Modify: `src/components/setup/steps/DomainStep.tsx`
- Test: `src/components/setup/steps/DomainStep.test.tsx`

**Interfaces:**
- Consumes: `submitBootstrap` (prop), `SetupErrorBox` (Task 6).
- Produces: nouvelles props `submitBootstrap: (v: DomainValues) => Promise<void>`, `onRestart: () => void` ; supprime `onNext`/`onBack` vers Recap.

- [ ] **Step 1 : Tests** — saisie valide + « Suivant » → appelle `submitBootstrap` puis `onRestart` ; rejet de `submitBootstrap` → `SetupErrorBox` (code) + reste sur l'étape ; pas d'avance.
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** — conserver la collecte/validation Zod (`domainSchema`) ; au submit : `setBusy(true)`, `try { await submitBootstrap(values); onRestart() } catch (e) { setError(codeFrom(e)) }`. Le code client provient de `e.message` (= code opaque renvoyé par le handler) ou `'SETUP-UNKNOWN'`.
- [ ] **Step 4 : Tests verts.** Run: `bun run test src/components/setup/steps/DomainStep.test.tsx`
- [ ] **Step 5 : Commit** — `git commit -m "feat(setup): DomainStep exécute submitBootstrap au Suivant"`

---

## Task 9 : `DnsStep` — formulaire provider+token intégré (fusion `DnsProviderStep`)

**Files:**
- Modify: `src/components/setup/steps/DnsStep.tsx`
- Test: `src/components/setup/steps/DnsStep.test.tsx`
- Delete: `src/components/setup/steps/DnsProviderStep.tsx` (+ `.test.tsx`)

**Interfaces:**
- Consumes: `createDnsServer`, `setDnsManagement`, `setDnsManagementManual` (nouveau, Task 3 côté route), `gridStatus`, `SetupErrorBox`.
- Produces: props **sans** `provider`/`secret` injectés (collectés en interne) :
```typescript
interface Props {
  hostname: string; domain: string
  createDnsServer: (i: { provider: string; secret: string }) => Promise<{ dnsServerId: string }>
  setDnsManagement: (i: { dnsServerId: string }) => Promise<{ ok: true }>
  setDnsManagementManual: () => Promise<{ ok: true }>
  gridStatus: () => Promise<{ origin: string; records: DnsGridRecord[] }>
  onNext: () => void
}
```

- [ ] **Step 1 : Tests** — phases :
  - **form** (initiale) : Combobox provider + champ token (réutiliser `dnsProviderSchema`) ; Manuel masque le token.
  - **auto** : submit → `createDnsServer` → `setDnsManagement` → grille (poll `gridStatus`) → « Continuer » → `onNext`. Échec d'un appel → `SetupErrorBox` + retour au form/retry, pas d'avance.
  - **Manuel** : submit → `setDnsManagementManual` → grille (copie) → « Continuer » → `onNext`.
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** — déplacer le JSX/logique de collecte de `DnsProviderStep` en tête de `DnsStep` (phase `form`), puis enchaîner sur la logique d'exécution/grille existante. Le `secret` n'est **jamais** stocké hors du composant. Manuel appelle `setDnsManagementManual()`.
- [ ] **Step 4 : Supprimer `DnsProviderStep.tsx` + test.**
- [ ] **Step 5 : Tests verts.** Run: `bun run test src/components/setup/steps/DnsStep.test.tsx`
- [ ] **Step 6 : Commit** — `git commit -m "feat(setup): DnsStep collecte+exécute (fusion DnsProviderStep)"`

---

## Task 10 : `AccountStep` — champ name intégré (fusion `AdminAccountStep`)

**Files:**
- Modify: `src/components/setup/steps/AccountStep.tsx`
- Test: `src/components/setup/steps/AccountStep.test.tsx`
- Delete: `src/components/setup/steps/AdminAccountStep.tsx` (+ `.test.tsx`)

**Interfaces:**
- Produces: props auto-portées :
```typescript
interface Props {
  domain: string
  createAccount: (i: { name: string; password: string }) => Promise<CreateAccountResult>
  onNext: () => void
}
```

- [ ] **Step 1 : Tests** — collecte `name`+`password` (validation `adminAccountSchema`, nom réservé « admin » rejeté) → `createAccount` → `onNext` ; `{status:'weak'}` → message + reste (champ password réutilisable) ; rejet → `SetupErrorBox`.
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** — fusionner le champ `name` (de `AdminAccountStep`) dans `AccountStep` ; conserver la boucle « mot de passe faible » existante ; le flux `{status:'weak'}` reste distinct du `SetupErrorBox` (erreurs serveur).
- [ ] **Step 4 : Supprimer `AdminAccountStep.tsx` + test.**
- [ ] **Step 5 : Tests verts.** Run: `bun run test src/components/setup/steps/AccountStep.test.tsx`
- [ ] **Step 6 : Commit** — `git commit -m "feat(setup): AccountStep collecte+exécute (fusion AdminAccountStep)"`

---

## Task 11 : `SslStep` — placement avant Compte + cas Manuel

**Files:**
- Modify: `src/components/setup/steps/SslStep.tsx`
- Test: `src/components/setup/steps/SslStep.test.tsx`

**Interfaces:**
- Consumes: `configureAcme`, `acmeStatus` (inchangés). Ajout : props `dnsManual: boolean` et `acknowledgeManualSsl()` (handler `markSslConfiguredFn` → pose le marqueur dédié `sslAcknowledged`).

- [ ] **Step 1 : Tests** — mode auto inchangé (configure ACME, statut non bloquant). **Mode Manuel** (`dnsManual=true`) : n'appelle **pas** `configureAcme` ; affiche un encart informatif (cert mail à gérer hors DNS-01) ; « Continuer » → `acknowledgeManualSsl()` (marqueur `sslAcknowledged`) puis `onNext`. Le retry doit ré-invoquer l'action du **mode courant** (ack en Manuel, `configureAcme` en auto).
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** — chemin informatif si `dnsManual` (« Continuer » → `acknowledgeManualSsl` → `onNext`) ; sinon comportement auto. Erreur → `SetupErrorBox` (code `SETUP-SSL-REJECTED`) + retry mode-conscient.
- [ ] **Step 4 : Tests verts.** Run: `bun run test src/components/setup/steps/SslStep.test.tsx`
- [ ] **Step 5 : Commit** — `git commit -m "feat(setup): SslStep avant Compte + cas DNS Manuel informatif"`

---

## Task 12 : `StepperH` linéaire

**Files:**
- Modify: `src/components/setup/ui/StepperH.tsx`
- Test: `src/components/setup/ui/StepperH.test.tsx`

**Interfaces:**
- Produces: `Props = { steps: { n: number; label: string }[]; current: number }` (suppression `group`/`groupLabels`).

- [ ] **Step 1 : Tests** — rend N étapes en séquence linéaire ; done (`n<current`) coché, courant mis en avant, todo numéroté ; plus de séparateur de groupe.
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** — retirer le groupage ; rendu d'une liste simple.
- [ ] **Step 4 : Tests verts.** Run: `bun run test src/components/setup/ui/StepperH.test.tsx`
- [ ] **Step 5 : Commit** — `git commit -m "refactor(setup): StepperH séquence linéaire"`

---

## Task 13 : `SetupWizard` — réécriture de l'orchestration

**Files:**
- Modify: `src/components/setup/SetupWizard.tsx`
- Test: `src/components/setup/SetupWizard.test.tsx`
- Delete: `src/components/setup/RecapStep`→ déjà couvert ; `src/components/setup/wizard-context.tsx` (+ test).

**Interfaces:**
- Consumes: toutes les server fns (props), `getStep` (`pollStep`), `setDnsManagementManual` (nouveau).
- Produces: orchestration linéaire.

**Modèle d'orchestration :**
- `initialStep` ∈ `collect | dns | ssl | account | done`.
- **Pré-bootstrap** (`step==='collect'`) : sous-état client `welcome → domain`. `DomainStep` exécute `submitBootstrap` → bascule sur l'écran **redémarrage**.
- **Redémarrage** : `RestartScreen` (spinner + `t('wizard.restart.configuring')`) qui **poll `pollStep()`** jusqu'à obtenir un step normal (`dns`…), puis rend l'étape serveur. Timeout → `SetupErrorBox('SETUP-RESTART-TIMEOUT')` + Réessayer (relance le poll).
- **Étapes serveur** : mapper `step → composant` :
  - `dns` → `<DnsStep … onNext={refetchStep}>`
  - `ssl` → `<SslStep dnsManual={…} … onNext={refetchStep}>`
  - `account` → `<AccountStep … onNext={refetchStep}>`
  - `done` → `<DoneStep>` (appelle `finishSetup`).
- `onNext` de chaque étape = **re-poll `getStep()`** (re-dérivation serveur) → avance vers l'étape suivante. (Plus de `setMonitorStep` manuel ni de `WizardData`.)
- `dnsManual` : déterminé par l'absence de chemin auto — le wizard ne connaît pas le provider choisi (collecté dans DnsStep). **Décision** : `SslStep` interroge `acmeStatus`/l'état ; plus simple — `DnsStep.onNext` transmet un booléen `manual` remonté en état local du wizard (non persistant, OK car SSL suit immédiatement DNS dans la même session ; à la reprise pure sur `ssl`, le wizard re-dérive et, si `dnsConfigured` via Manuel, traite SSL en informatif). Le plan d'implémentation : DnsStep `onNext(manual: boolean)`, le wizard mémorise `dnsManual` ; au chargement direct sur `ssl`, déduire `manual` côté serveur via un champ exposé (cf. Task 14).
- **Stepper** : `steps = [welcome, domain, dns, ssl, account, done]` (labels i18n) ; `current` dérivé de l'étape.

- [ ] **Step 1 : Tests** (`SetupWizard.test.tsx`, props mockées) :
  - `initialStep='collect'` → Welcome puis Domaine ; submit → écran redémarrage → poll renvoie `dns` → DnsStep.
  - `initialStep='dns'` (reprise) → DnsStep directement (avec son **formulaire**, pas d'état perdu).
  - `onNext` de DnsStep → re-poll → SSL ; etc.
  - ordre `dns → ssl → account → done` respecté.
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** la machine ci-dessus ; supprimer `CollectScreen` parties recap/account-collect, `WizardData`/`useWizard`, le mapping monitor/screen, les imports de `DnsProviderStep`/`AdminAccountStep`/`RecapStep`.
- [ ] **Step 4 : Supprimer `wizard-context.tsx` (+ test)** ; vérifier qu'aucun import résiduel ne subsiste (`grep -rn wizard-context src`).
- [ ] **Step 5 : Tests verts.** Run: `bun run test src/components/setup/SetupWizard.test.tsx`
- [ ] **Step 6 : Commit** — `git commit -m "refactor(setup): orchestration linéaire pilotée par l'état serveur"`

---

## Task 14 : Exposer le mode DNS pour la reprise SSL + câblage route

**Files:**
- Modify: `src/server/setup-actions.ts` (étendre `getStep` ou un nouveau champ), `src/server/setup-state.ts`, `src/routes/setup/index.tsx`
- Test: `src/server/setup-state.test.ts`, `src/routes/setup/index.tsx` (typecheck)

**Interfaces:**
- Produces: `getStep()` renvoie `{ step, dnsManual }` où `dnsManual = isDnsConfigured() && dnsManagement!==Automatic`. Permet à `SslStep` de savoir, **à la reprise directe**, s'il est en mode informatif. Câblage des nouvelles fns (`setDnsManagementManualFn`) dans la route.

- [ ] **Step 1 : Test** — `getStep` expose `dnsManual: true` quand marqueur posé + dnsManagement non Automatic ; `false` en chemin auto.
- [ ] **Step 2 : Lancer → échoue.**
- [ ] **Step 3 : Implémenter** — enrichir `getStepHandler` (`{ step: await deriveSetupStep(), dnsManual: … }`) ; adapter `pollStep`/`initialStep` côté route + `SetupWizard` pour propager `dnsManual` à `SslStep` ; passer `setDnsManagement={() => setDnsManagementManualFn()}` au DnsStep pour le chemin Manuel.
- [ ] **Step 4 : Tests + typecheck verts.** Run: `bun run test src/server/setup-state.test.ts && bun run typecheck`
- [ ] **Step 5 : Commit** — `git commit -m "feat(setup): exposer dnsManual pour la reprise SSL + câblage route"`

---

## Task 15 : Nettoyage final + suite complète

**Files:** transverse.

- [ ] **Step 1 :** `grep -rn "WizardData\|useWizard\|DnsProviderStep\|AdminAccountStep\|RecapStep\|wizard-context\|monitorStep\|screenToCurrent" src` → **zéro** résultat (hors historique). Corriger tout résidu.
- [ ] **Step 2 :** Vérifier les clés i18n mortes (`wizard.recap`, `wizard.groups`, `wizard.steps.dnsProvider/dnsRecords/admin`) — supprimées et non référencées.
- [ ] **Step 3 :** Suite complète. Run: `bun run lint && bun run typecheck && bun run test`
- [ ] **Step 4 :** `bun run format` puis vérifier le diff (uniquement le périmètre voulu).
- [ ] **Step 5 : Commit** — `git commit -m "chore(setup): nettoyage post-refactor wizard"`

---

## Self-Review (couverture spec)

- Spec §3 (modèle serveur-dirigé, collecte+exécution) → Tasks 8-13. ✅
- Spec §4 séquence + contrat par étape → Tasks 8 (Domaine), 9 (DNS), 11 (SSL), 10 (Compte), 13 (orchestration/Done). ✅
- Spec §5 `deriveSetupStep` nouvel ordre + idempotence → Tasks 2, 4. ✅
- Spec §6 Manuel (variante + marqueur `dnsConfigured`) → Tasks 1, 3, 9, 11, 14. ✅
- Spec §7 redémarrage (spinner + légende) → Tasks 7, 13. ✅
- Spec §8 erreurs (message + code + retry) → Tasks 5, 6, + usage dans 8-11. ✅
- Spec §9 cartographie fichiers → Structure des fichiers + tâches. ✅
- Spec §10 tests → chaque tâche en TDD. ✅
- Spec §11 sécurité (token jamais hors composant, codes opaques, R6) → Tasks 5, 9 (secret local), 13 (suppression context). ✅
- Spec §12 points à lever → Task 1/3 (marqueur), Task 4 (idempotence), Task 5 (codes), Task 11/14 (SSL Manuel). ✅

**Type consistency :** `setDnsManagementManual` (Task 3) consommé en Tasks 9/14 ; `isDnsConfigured`/`markDnsConfigured` (Task 1) en Tasks 2/3/14 ; `SetupError`/`toSetupErrorCode` (Task 5) en Task 5 handlers + UI via `e.message` ; `SetupErrorBox` (Task 6) en 8-11 ; `getStep` enrichi `{step,dnsManual}` (Task 14) cohérent avec route/SetupWizard.
