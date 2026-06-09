# Setup Wizard UI — Foundations & Collect (Plan 2b-i) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the wizard shell and the 5 collect-phase screens (welcome+language, domain, DNS provider, admin account, recap), with i18n (FR/EN), TanStack Form + Zod validation, and the bootstrap submit → restart-wait flow — landing the server in normal mode at the `account` step (implemented by Plan 2b-ii).

**Architecture:** A single `/setup` route renders `<SetupWizard>`, which reads the current step from the server (`getStep()`), holds collected form values in React context, and renders the active step component. Each step is an isolated component using TanStack Form with a per-step Zod schema (reused by server-function validators). After the recap submits the Bootstrap, a poll-based restart screen waits for the server to re-enter normal mode.

**Tech Stack:** React 19, TanStack Start (server functions + router), TanStack Form, Zod, react-i18next, shadcn/ui (base-nova), Tailwind v4, Vitest + Testing Library.

**Reference:** spec `docs/superpowers/specs/2026-06-09-setup-wizard-ui-design.md`. Backend (Plan 2a, merged) provides `getStep` / `submitBootstrapFn` in `src/server/setup-actions.ts`, `DNS_PROVIDERS` in `src/server/stalwart-dns.ts`, and the JMAP modules.

**Conventions (existing repo):**
- Server functions: `createServerFn({method}).handler(fn)`; called from components as `await getStep()` (GET) or `await submitBootstrapFn({ data })` (POST). Handlers are exported separately for unit testing (see `src/routes/index.tsx`).
- Tests: client/component tests are `.test.tsx` under `src/routes/**` or `src/components/**` (jsdom). Server tests are `.test.ts` under `src/server/**` (node). Component tests use `@testing-library/react`.
- Imports alias `@/` → `src/` (see `components.json`).
- Pre-commit hook runs lint + typecheck + tests; never `--no-verify`. Run a single file with `bun run test <path>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` (modify) | Broaden client project to include `src/i18n/**` and `.test.ts` component tests. |
| `src/i18n/resources.ts` | FR + EN translation bundles (collect-phase keys) + typed `defaultNS`. |
| `src/i18n/i18n.ts` | Configured i18next instance (sync, bundled resources) + `SUPPORTED_LANGS`. |
| `src/i18n/i18n.test.ts` | FR/EN key parity + resolution. |
| `src/server/setup-lang.ts` | `readLangCookie()` + `getServerLang` server fn (SSR language from cookie). |
| `src/server/setup-lang.test.ts` | Cookie parsing tests. |
| `src/components/setup/schemas.ts` | Zod schemas: `domainSchema`, `dnsProviderSchema`, `adminAccountSchema`. |
| `src/components/setup/schemas.test.ts` | Valid/invalid cases. |
| `src/components/setup/wizard-context.tsx` | `WizardProvider` + `useWizard()` holding collected values across steps. |
| `src/components/setup/wizard-context.test.tsx` | State accumulation. |
| `src/components/setup/Stepper.tsx` | Progress indicator. |
| `src/components/setup/Stepper.test.tsx` | Active/index rendering. |
| `src/components/setup/steps/WelcomeStep.tsx` | Language switch + start. |
| `src/components/setup/steps/DomainStep.tsx` | hostname + domain form. |
| `src/components/setup/steps/DnsProviderStep.tsx` | provider select + secret. |
| `src/components/setup/steps/AdminAccountStep.tsx` | name/email/password + strength. |
| `src/components/setup/steps/RecapStep.tsx` | recap + submit bootstrap. |
| `src/components/setup/steps/*.test.tsx` | One focused test per step. |
| `src/components/setup/RestartScreen.tsx` | Poll `getStep` until normal mode. |
| `src/components/setup/RestartScreen.test.tsx` | Poll/transition. |
| `src/components/setup/SetupWizard.tsx` | Shell: step routing, error panel, restart wiring. |
| `src/components/setup/SetupWizard.test.tsx` | Step dispatch + error. |
| `src/components/setup/password-strength.ts` | `scorePassword()` (UX meter). |
| `src/components/setup/password-strength.test.ts` | Scoring. |
| `src/components/ui/*` | Generated shadcn: input, label, card, select, alert, badge, separator, progress. |
| `src/routes/__root.tsx` (modify) | Wrap app in `<I18nextProvider>`; set language from root loader. |
| `src/routes/setup/index.tsx` (modify) | Render `<SetupWizard>`; loader returns initial step + lang; `errorComponent`. |
| `src/server/setup-actions.ts` (modify) | Add Zod validator to `submitBootstrapFn`. |

---

## Task 1: Dependencies, shadcn components, vitest config

**Files:** `package.json`, `src/components/ui/*`, `vitest.config.ts`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
bun add @tanstack/react-form zod i18next react-i18next
```
Expected: added to `package.json` dependencies.

- [ ] **Step 2: Generate shadcn components**

Run:
```bash
bunx shadcn@latest add input label card select alert badge separator progress --yes
```
Expected: files created under `src/components/ui/` (input.tsx, label.tsx, card.tsx, select.tsx, alert.tsx, badge.tsx, separator.tsx, progress.tsx). If the CLI prompts, accept defaults (the project's `components.json` is already configured, style `base-nova`).

- [ ] **Step 3: Broaden the Vitest client project**

Modify `vitest.config.ts` — change the client project's `include` to also cover `src/i18n` and `.test.ts` files under components:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          include: ['src/server/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'client',
          include: [
            'src/routes/**/*.test.{ts,tsx}',
            'src/components/**/*.test.{ts,tsx}',
            'src/i18n/**/*.test.{ts,tsx}',
          ],
          environment: 'jsdom',
          globals: true,
        },
      },
    ],
  },
})
```

- [ ] **Step 4: Verify build still works**

Run: `bun run test && bun run typecheck`
Expected: existing 82 tests pass; typecheck clean (shadcn components compile).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/components/ui vitest.config.ts
git commit -m "chore(ui): add TanStack Form, Zod, i18next, shadcn components"
```

---

## Task 2: i18n resources + instance

**Files:** Create `src/i18n/resources.ts`, `src/i18n/i18n.ts`, `src/i18n/i18n.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/i18n/i18n.test.ts
import { describe, it, expect } from 'vitest'
import { fr, en } from './resources'
import { createI18n, SUPPORTED_LANGS } from './i18n'

const keys = (obj: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )

describe('i18n resources', () => {
  it('FR and EN have identical key sets', () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort())
  })

  it('exposes fr and en as supported languages', () => {
    expect(SUPPORTED_LANGS).toEqual(['fr', 'en'])
  })

  it('resolves a key in the requested language', async () => {
    const i18n = createI18n('en')
    await i18n.init
    expect(i18n.t('wizard.welcome.start')).toBe(en.wizard.welcome.start)
    expect(i18n.getResource('fr', 'translation', 'wizard.welcome.start')).toBe(
      fr.wizard.welcome.start,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/i18n/i18n.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write the resources**

```ts
// src/i18n/resources.ts
export const fr = {
  wizard: {
    nav: { back: 'Retour', next: 'Suivant' },
    steps: {
      welcome: 'Bienvenue',
      domain: 'Domaine',
      dns: 'DNS',
      account: 'Compte',
      recap: 'Récapitulatif',
    },
    error: { title: 'Une erreur est survenue', retry: 'Réessayer' },
    welcome: {
      title: 'Configurons votre serveur mail',
      subtitle: 'Quelques étapes et votre boîte est prête.',
      language: 'Langue',
      start: 'Commencer',
    },
    domain: {
      title: 'Votre domaine',
      hostname: 'Nom d’hôte public',
      hostnameHint: 'ex. mail.exemple.fr',
      domain: 'Domaine email',
      domainHint: 'ex. exemple.fr',
      dnsWarning: 'Ce nom d’hôte ne pointe pas encore vers ce serveur.',
    },
    dns: {
      title: 'Fournisseur DNS',
      provider: 'Fournisseur',
      manual: 'Manuel (je gère mes enregistrements)',
      secret: 'Clé API',
      secretHint: 'Jamais affichée après validation.',
    },
    account: {
      title: 'Compte administrateur',
      name: 'Nom d’utilisateur',
      email: 'Adresse email',
      password: 'Mot de passe',
      strength: { weak: 'Faible', medium: 'Moyen', strong: 'Fort' },
    },
    recap: {
      title: 'Récapitulatif',
      submit: 'Configurer',
      hostname: 'Nom d’hôte',
      domain: 'Domaine',
      dns: 'DNS',
      account: 'Administrateur',
    },
    restart: {
      title: 'Configuration en cours',
      subtitle: 'Le serveur redémarre, un instant…',
      timeout: 'Cela prend plus longtemps que prévu.',
    },
  },
} as const

export const en: typeof fr = {
  wizard: {
    nav: { back: 'Back', next: 'Next' },
    steps: {
      welcome: 'Welcome',
      domain: 'Domain',
      dns: 'DNS',
      account: 'Account',
      recap: 'Summary',
    },
    error: { title: 'Something went wrong', retry: 'Retry' },
    welcome: {
      title: 'Let’s set up your mail server',
      subtitle: 'A few steps and your inbox is ready.',
      language: 'Language',
      start: 'Get started',
    },
    domain: {
      title: 'Your domain',
      hostname: 'Public hostname',
      hostnameHint: 'e.g. mail.example.com',
      domain: 'Email domain',
      domainHint: 'e.g. example.com',
      dnsWarning: 'This hostname does not point to this server yet.',
    },
    dns: {
      title: 'DNS provider',
      provider: 'Provider',
      manual: 'Manual (I manage my records)',
      secret: 'API key',
      secretHint: 'Never shown after you continue.',
    },
    account: {
      title: 'Administrator account',
      name: 'Username',
      email: 'Email address',
      password: 'Password',
      strength: { weak: 'Weak', medium: 'Medium', strong: 'Strong' },
    },
    recap: {
      title: 'Summary',
      submit: 'Set up',
      hostname: 'Hostname',
      domain: 'Domain',
      dns: 'DNS',
      account: 'Administrator',
    },
    restart: {
      title: 'Setting things up',
      subtitle: 'The server is restarting, one moment…',
      timeout: 'This is taking longer than expected.',
    },
  },
}
```

- [ ] **Step 4: Write the instance factory**

```ts
// src/i18n/i18n.ts
import i18next, { type i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { fr, en } from './resources'

export const SUPPORTED_LANGS = ['fr', 'en'] as const
export type Lang = (typeof SUPPORTED_LANGS)[number]
export const DEFAULT_LANG: Lang = 'fr'
export const LANG_COOKIE = 'stalmail_lang'

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'en'
}

// Synchronous, bundled resources — no async backend, so no Suspense needed.
export function createI18n(lng: Lang = DEFAULT_LANG): I18n {
  const instance = i18next.createInstance()
  void instance.use(initReactI18next).init({
    lng,
    fallbackLng: DEFAULT_LANG,
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  return instance
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test src/i18n/i18n.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/i18n
git commit -m "feat(ui): add i18n resources (FR/EN) and i18next instance"
```

---

## Task 3: Zod schemas for collect steps

**Files:** Create `src/components/setup/schemas.ts`, `src/components/setup/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/setup/schemas.test.ts
import { describe, it, expect } from 'vitest'
import { domainSchema, dnsProviderSchema, adminAccountSchema } from './schemas'

describe('domainSchema', () => {
  it('accepts a valid hostname and domain', () => {
    expect(
      domainSchema.safeParse({ serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' }).success,
    ).toBe(true)
  })
  it('rejects a hostname without a dot', () => {
    expect(domainSchema.safeParse({ serverHostname: 'mail', defaultDomain: 'exemple.fr' }).success).toBe(false)
  })
})

describe('dnsProviderSchema', () => {
  it('requires a secret when provider is not Manual', () => {
    expect(dnsProviderSchema.safeParse({ provider: 'Cloudflare', secret: '' }).success).toBe(false)
    expect(dnsProviderSchema.safeParse({ provider: 'Cloudflare', secret: 'tok' }).success).toBe(true)
  })
  it('allows an empty secret for Manual', () => {
    expect(dnsProviderSchema.safeParse({ provider: 'Manual', secret: '' }).success).toBe(true)
  })
})

describe('adminAccountSchema', () => {
  it('accepts a valid account', () => {
    expect(
      adminAccountSchema.safeParse({ name: 'koffi', password: 'correct horse battery staple' }).success,
    ).toBe(true)
  })
  it('rejects an empty name or short password', () => {
    expect(adminAccountSchema.safeParse({ name: '', password: 'correct horse battery staple' }).success).toBe(false)
    expect(adminAccountSchema.safeParse({ name: 'koffi', password: 'short' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/schemas.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the schemas**

```ts
// src/components/setup/schemas.ts
import { z } from 'zod'
import { DNS_PROVIDERS } from '@/server/stalwart-dns'

const hostname = z
  .string()
  .min(1)
  .regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i, 'invalid hostname')

export const domainSchema = z.object({
  serverHostname: hostname,
  defaultDomain: hostname,
})
export type DomainValues = z.infer<typeof domainSchema>

export const dnsProviderSchema = z
  .object({
    provider: z.enum(DNS_PROVIDERS),
    secret: z.string(),
  })
  .refine((v) => v.provider === 'Manual' || v.secret.trim().length > 0, {
    message: 'secret required',
    path: ['secret'],
  })
export type DnsProviderValues = z.infer<typeof dnsProviderSchema>

export const adminAccountSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9._-]+$/i, 'invalid username'),
  // Client-side minimum only; the server enforces real strength (zxcvbn).
  password: z.string().min(8),
})
export type AdminAccountValues = z.infer<typeof adminAccountSchema>
```

> Note: `DNS_PROVIDERS` is `as const` in `stalwart-dns.ts`, so `z.enum(DNS_PROVIDERS)` typechecks against the literal union.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/schemas.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/schemas.ts src/components/setup/schemas.test.ts
git commit -m "feat(ui): add Zod schemas for collect steps"
```

---

## Task 4: Server — language cookie + bootstrap validator

**Files:** Create `src/server/setup-lang.ts`, `src/server/setup-lang.test.ts`; Modify `src/server/setup-actions.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/setup-lang.test.ts
import { describe, it, expect } from 'vitest'
import { parseLangCookie } from './setup-lang'

describe('parseLangCookie', () => {
  it('returns the lang from the cookie header', () => {
    expect(parseLangCookie('foo=1; stalmail_lang=en; bar=2')).toBe('en')
  })
  it('defaults to fr when absent or unknown', () => {
    expect(parseLangCookie('foo=1')).toBe('fr')
    expect(parseLangCookie('stalmail_lang=zz')).toBe('fr')
    expect(parseLangCookie(undefined)).toBe('fr')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/server/setup-lang.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `setup-lang.ts`**

```ts
// src/server/setup-lang.ts
import { createServerFn } from '@tanstack/react-start'
import { getHeaders } from '@tanstack/react-start/server'
import { DEFAULT_LANG, isLang, LANG_COOKIE, type Lang } from '@/i18n/i18n'

export function parseLangCookie(cookieHeader: string | undefined): Lang {
  const match = cookieHeader?.match(new RegExp(`${LANG_COOKIE}=([^;]+)`))
  const value = match?.[1]
  return isLang(value) ? value : DEFAULT_LANG
}

export async function getServerLangHandler(): Promise<{ lang: Lang }> {
  const cookie = getHeaders().cookie ?? undefined
  return { lang: parseLangCookie(cookie) }
}

export const getServerLang = createServerFn({ method: 'GET' }).handler(getServerLangHandler)
```

> Verification note (library detail, not logic): confirm `getHeaders` is exported from `@tanstack/react-start/server` in the installed version. If the import differs, use the equivalent request-headers accessor; `getHeaders().cookie` must yield the raw Cookie header string. The pure `parseLangCookie` is fully tested regardless.

- [ ] **Step 4: Add a Zod validator to `submitBootstrapFn`**

Modify `src/server/setup-actions.ts`: replace the trivial validator with the domain schema. New file content:

```ts
import { createServerFn } from '@tanstack/react-start'
import { deriveSetupStep } from './setup-state'
import { submitBootstrap, type BootstrapInput } from './stalwart-bootstrap'
import { requestStalwartRestart } from './stalwart-restart'
import { domainSchema } from '@/components/setup/schemas'

export async function getStepHandler(): Promise<{ step: string }> {
  return { step: await deriveSetupStep() }
}

export async function submitBootstrapHandler(
  { data }: { data: BootstrapInput },
): Promise<{ ok: true }> {
  await submitBootstrap(data)
  requestStalwartRestart()
  return { ok: true }
}

export const getStep = createServerFn({ method: 'GET' }).handler(getStepHandler)

export const submitBootstrapFn = createServerFn({ method: 'POST' })
  .validator((d: BootstrapInput) => domainSchema.parse(d))
  .handler(submitBootstrapHandler)
```

(The existing `src/server/setup-actions.test.ts` mocks `@tanstack/react-start`'s `createServerFn` so the `.validator` chain still returns the raw handler — the handler tests are unaffected. Confirm by running them in Step 6.)

- [ ] **Step 5: Run the lang test**

Run: `bun run test src/server/setup-lang.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify setup-actions tests still pass + typecheck**

Run: `bun run test src/server/setup-actions.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/setup-lang.ts src/server/setup-lang.test.ts src/server/setup-actions.ts
git commit -m "feat(setup): add SSR language cookie helper and validate bootstrap input"
```

---

## Task 5: Wizard collected-state context

**Files:** Create `src/components/setup/wizard-context.tsx`, `src/components/setup/wizard-context.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/setup/wizard-context.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WizardProvider, useWizard } from './wizard-context'

function Probe() {
  const { data, setData } = useWizard()
  return (
    <div>
      <span data-testid="host">{data.serverHostname ?? '-'}</span>
      <button onClick={() => setData({ serverHostname: 'mail.exemple.fr' })}>set</button>
    </div>
  )
}

describe('useWizard', () => {
  it('accumulates collected values', () => {
    render(
      <WizardProvider>
        <Probe />
      </WizardProvider>,
    )
    expect(screen.getByTestId('host').textContent).toBe('-')
    fireEvent.click(screen.getByText('set'))
    expect(screen.getByTestId('host').textContent).toBe('mail.exemple.fr')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/wizard-context.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the context**

```tsx
// src/components/setup/wizard-context.tsx
import { createContext, useContext, useState, type ReactNode } from 'react'

export interface WizardData {
  serverHostname?: string
  defaultDomain?: string
  provider?: string
  secret?: string
  name?: string
  password?: string
}

interface WizardCtx {
  data: WizardData
  setData: (patch: Partial<WizardData>) => void
}

const Ctx = createContext<WizardCtx | null>(null)

export function WizardProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<WizardData>({})
  const setData = (patch: Partial<WizardData>) =>
    setDataState((prev) => ({ ...prev, ...patch }))
  return <Ctx.Provider value={{ data, setData }}>{children}</Ctx.Provider>
}

export function useWizard(): WizardCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useWizard must be used within WizardProvider')
  return ctx
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/wizard-context.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/wizard-context.tsx src/components/setup/wizard-context.test.tsx
git commit -m "feat(ui): add wizard collected-state context"
```

---

## Task 6: Password strength helper

**Files:** Create `src/components/setup/password-strength.ts`, `src/components/setup/password-strength.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/setup/password-strength.test.ts
import { describe, it, expect } from 'vitest'
import { scorePassword } from './password-strength'

describe('scorePassword', () => {
  it('rates short/common passwords weak', () => {
    expect(scorePassword('pass')).toBe('weak')
    expect(scorePassword('password')).toBe('weak')
  })
  it('rates a long varied passphrase strong', () => {
    expect(scorePassword('correct horse battery staple 9')).toBe('strong')
  })
  it('rates a medium password medium', () => {
    expect(scorePassword('Abcd1234')).toBe('medium')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/password-strength.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the helper**

```ts
// src/components/setup/password-strength.ts
export type Strength = 'weak' | 'medium' | 'strong'

const COMMON = new Set(['password', '12345678', 'qwerty', 'azerty', 'admin'])

// Lightweight UX heuristic only — the server enforces real strength (zxcvbn).
export function scorePassword(pw: string): Strength {
  if (pw.length < 8 || COMMON.has(pw.toLowerCase())) return 'weak'
  let variety = 0
  if (/[a-z]/.test(pw)) variety++
  if (/[A-Z]/.test(pw)) variety++
  if (/[0-9]/.test(pw)) variety++
  if (/[^a-z0-9]/i.test(pw)) variety++
  if (pw.length >= 20 || (pw.length >= 12 && variety >= 3)) return 'strong'
  if (pw.length >= 10 && variety >= 2) return 'medium'
  return variety >= 3 ? 'medium' : 'weak'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/password-strength.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/password-strength.ts src/components/setup/password-strength.test.ts
git commit -m "feat(ui): add password strength heuristic"
```

---

## Task 7: Stepper component

**Files:** Create `src/components/setup/Stepper.tsx`, `src/components/setup/Stepper.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/setup/Stepper.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Stepper } from './Stepper'

describe('Stepper', () => {
  it('renders all step labels and marks the active one', () => {
    render(<Stepper labels={['Bienvenue', 'Domaine', 'DNS']} activeIndex={1} />)
    expect(screen.getByText('Domaine')).toHaveAttribute('data-active', 'true')
    expect(screen.getByText('Bienvenue')).toHaveAttribute('data-active', 'false')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/Stepper.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// src/components/setup/Stepper.tsx
export function Stepper({ labels, activeIndex }: { labels: string[]; activeIndex: number }) {
  return (
    <ol className="mb-8 flex items-center justify-center gap-2 text-sm">
      {labels.map((label, i) => (
        <li
          key={label}
          data-active={i === activeIndex}
          aria-current={i === activeIndex ? 'step' : undefined}
          className={
            i === activeIndex
              ? 'font-medium text-foreground'
              : 'text-muted-foreground'
          }
        >
          {label}
          {i < labels.length - 1 && <span className="mx-2 text-muted-foreground">→</span>}
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/Stepper.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/Stepper.tsx src/components/setup/Stepper.test.tsx
git commit -m "feat(ui): add wizard stepper"
```

---

## Task 8: WelcomeStep (language switch)

**Files:** Create `src/components/setup/steps/WelcomeStep.tsx`, `src/components/setup/steps/WelcomeStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/setup/steps/WelcomeStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { WelcomeStep } from './WelcomeStep'

function renderWithI18n(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)
}

describe('WelcomeStep', () => {
  it('shows the start button and calls onNext', () => {
    const onNext = vi.fn()
    renderWithI18n(<WelcomeStep onNext={onNext} />)
    fireEvent.click(screen.getByRole('button', { name: 'Commencer' }))
    expect(onNext).toHaveBeenCalled()
  })

  it('switches language when EN is chosen', () => {
    renderWithI18n(<WelcomeStep onNext={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/steps/WelcomeStep.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// src/components/setup/steps/WelcomeStep.tsx
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { SUPPORTED_LANGS, LANG_COOKIE } from '@/i18n/i18n' // LANG_COOKIE defined in Task 2

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t, i18n } = useTranslation()

  const setLang = (lng: string) => {
    void i18n.changeLanguage(lng)
    if (typeof document !== 'undefined') {
      document.cookie = `${LANG_COOKIE}=${lng}; path=/; max-age=31536000`
    }
  }

  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center gap-2">
        {SUPPORTED_LANGS.map((lng) => (
          <Button
            key={lng}
            variant={i18n.resolvedLanguage === lng ? 'default' : 'outline'}
            size="sm"
            onClick={() => setLang(lng)}
          >
            {lng.toUpperCase()}
          </Button>
        ))}
      </div>
      <h1 className="text-2xl font-semibold">{t('wizard.welcome.title')}</h1>
      <p className="text-muted-foreground">{t('wizard.welcome.subtitle')}</p>
      <Button onClick={onNext}>{t('wizard.welcome.start')}</Button>
    </div>
  )
}
```

> `LANG_COOKIE` is already exported from `@/i18n/i18n` (Task 2) and consumed by `setup-lang.ts` (Task 4) — no duplication.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/steps/WelcomeStep.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/steps/WelcomeStep.tsx src/components/setup/steps/WelcomeStep.test.tsx
git commit -m "feat(ui): add WelcomeStep with language switch"
```

---

## Task 9: DomainStep

**Files:** Create `src/components/setup/steps/DomainStep.tsx`, `src/components/setup/steps/DomainStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/setup/steps/DomainStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { DomainStep } from './DomainStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('DomainStep', () => {
  it('submits valid hostname + domain via onNext', async () => {
    const onNext = vi.fn()
    wrap(<DomainStep defaults={{}} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Nom d’hôte public'), { target: { value: 'mail.exemple.fr' } })
    fireEvent.change(screen.getByLabelText('Domaine email'), { target: { value: 'exemple.fr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() =>
      expect(onNext).toHaveBeenCalledWith({ serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' }),
    )
  })

  it('does not advance with an invalid hostname', async () => {
    const onNext = vi.fn()
    wrap(<DomainStep defaults={{}} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Nom d’hôte public'), { target: { value: 'nope' } })
    fireEvent.change(screen.getByLabelText('Domaine email'), { target: { value: 'exemple.fr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(onNext).not.toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/steps/DomainStep.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// src/components/setup/steps/DomainStep.tsx
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { domainSchema, type DomainValues } from '../schemas'

interface Props {
  defaults: Partial<DomainValues>
  onNext: (v: DomainValues) => void
  onBack: () => void
}

export function DomainStep({ defaults, onNext, onBack }: Props) {
  const { t } = useTranslation()
  const form = useForm({
    defaultValues: {
      serverHostname: defaults.serverHostname ?? '',
      defaultDomain: defaults.defaultDomain ?? '',
    },
    validators: { onSubmit: domainSchema },
    onSubmit: ({ value }) => onNext(value),
  })

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <h2 className="text-xl font-semibold">{t('wizard.domain.title')}</h2>
      <form.Field
        name="serverHostname"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.domain.hostname')}</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t('wizard.domain.hostnameHint')}
            />
            {!field.state.meta.isValid && (
              <p className="text-destructive text-sm">{field.state.meta.errors.map(String).join(', ')}</p>
            )}
          </div>
        )}
      />
      <form.Field
        name="defaultDomain"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.domain.domain')}</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t('wizard.domain.domainHint')}
            />
            {!field.state.meta.isValid && (
              <p className="text-destructive text-sm">{field.state.meta.errors.map(String).join(', ')}</p>
            )}
          </div>
        )}
      />
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>{t('wizard.nav.back')}</Button>
        <Button type="submit">{t('wizard.nav.next')}</Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/steps/DomainStep.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/steps/DomainStep.tsx src/components/setup/steps/DomainStep.test.tsx
git commit -m "feat(ui): add DomainStep"
```

---

## Task 10: DnsProviderStep

**Files:** Create `src/components/setup/steps/DnsProviderStep.tsx`, `src/components/setup/steps/DnsProviderStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/setup/steps/DnsProviderStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { DnsProviderStep } from './DnsProviderStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('DnsProviderStep', () => {
  it('advances in Manual mode without a secret', async () => {
    const onNext = vi.fn()
    wrap(<DnsProviderStep defaults={{ provider: 'Manual', secret: '' }} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(onNext).toHaveBeenCalledWith({ provider: 'Manual', secret: '' }))
  })

  it('requires a secret for a real provider', async () => {
    const onNext = vi.fn()
    wrap(<DnsProviderStep defaults={{ provider: 'Cloudflare', secret: '' }} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(onNext).not.toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/steps/DnsProviderStep.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// src/components/setup/steps/DnsProviderStep.tsx
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DNS_PROVIDERS } from '@/server/stalwart-dns'
import { dnsProviderSchema, type DnsProviderValues } from '../schemas'

interface Props {
  defaults: Partial<DnsProviderValues>
  onNext: (v: DnsProviderValues) => void
  onBack: () => void
}

export function DnsProviderStep({ defaults, onNext, onBack }: Props) {
  const { t } = useTranslation()
  const form = useForm({
    defaultValues: {
      provider: defaults.provider ?? 'Manual',
      secret: defaults.secret ?? '',
    },
    validators: { onSubmit: dnsProviderSchema },
    onSubmit: ({ value }) => onNext(value),
  })

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <h2 className="text-xl font-semibold">{t('wizard.dns.title')}</h2>
      <form.Field
        name="provider"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.dns.provider')}</Label>
            <select
              id={field.name}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            >
              <option value="Manual">{t('wizard.dns.manual')}</option>
              {DNS_PROVIDERS.filter((p) => p !== 'Manual').map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}
      />
      <form.Subscribe
        selector={(s) => s.values.provider}
        children={(provider) =>
          provider !== 'Manual' ? (
            <form.Field
              name="secret"
              children={(field) => (
                <div className="space-y-1">
                  <Label htmlFor={field.name}>{t('wizard.dns.secret')}</Label>
                  <Input
                    id={field.name}
                    type="password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">{t('wizard.dns.secretHint')}</p>
                  {!field.state.meta.isValid && (
                    <p className="text-destructive text-sm">{field.state.meta.errors.map(String).join(', ')}</p>
                  )}
                </div>
              )}
            />
          ) : null
        }
      />
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>{t('wizard.nav.back')}</Button>
        <Button type="submit">{t('wizard.nav.next')}</Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/steps/DnsProviderStep.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/steps/DnsProviderStep.tsx src/components/setup/steps/DnsProviderStep.test.tsx
git commit -m "feat(ui): add DnsProviderStep"
```

---

## Task 11: AdminAccountStep

**Files:** Create `src/components/setup/steps/AdminAccountStep.tsx`, `src/components/setup/steps/AdminAccountStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/setup/steps/AdminAccountStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { AdminAccountStep } from './AdminAccountStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('AdminAccountStep', () => {
  it('submits a valid account and shows a strength label', async () => {
    const onNext = vi.fn()
    wrap(<AdminAccountStep defaults={{}} domain="exemple.fr" onNext={onNext} onBack={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Nom d’utilisateur'), { target: { value: 'koffi' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct horse battery 9' } })
    expect(screen.getByText('Fort')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(onNext).toHaveBeenCalledWith({ name: 'koffi', password: 'correct horse battery 9' }))
  })

  it('shows the derived email from name + domain', () => {
    wrap(<AdminAccountStep defaults={{ name: 'koffi' }} domain="exemple.fr" onNext={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByText('koffi@exemple.fr')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/steps/AdminAccountStep.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// src/components/setup/steps/AdminAccountStep.tsx
import { useForm } from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminAccountSchema, type AdminAccountValues } from '../schemas'
import { scorePassword } from '../password-strength'

interface Props {
  defaults: Partial<AdminAccountValues>
  domain: string
  onNext: (v: AdminAccountValues) => void
  onBack: () => void
}

export function AdminAccountStep({ defaults, domain, onNext, onBack }: Props) {
  const { t } = useTranslation()
  const form = useForm({
    defaultValues: { name: defaults.name ?? '', password: defaults.password ?? '' },
    validators: { onSubmit: adminAccountSchema },
    onSubmit: ({ value }) => onNext(value),
  })

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <h2 className="text-xl font-semibold">{t('wizard.account.title')}</h2>
      <form.Field
        name="name"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.account.name')}</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <p className="text-muted-foreground text-sm">
              {t('wizard.account.email')}: {field.state.value || 'admin'}@{domain}
            </p>
            {!field.state.meta.isValid && (
              <p className="text-destructive text-sm">{field.state.meta.errors.map(String).join(', ')}</p>
            )}
          </div>
        )}
      />
      <form.Field
        name="password"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor={field.name}>{t('wizard.account.password')}</Label>
            <Input
              id={field.name}
              type="password"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            {field.state.value && (
              <p className="text-sm">{t(`wizard.account.strength.${scorePassword(field.state.value)}`)}</p>
            )}
            {!field.state.meta.isValid && (
              <p className="text-destructive text-sm">{field.state.meta.errors.map(String).join(', ')}</p>
            )}
          </div>
        )}
      />
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>{t('wizard.nav.back')}</Button>
        <Button type="submit">{t('wizard.nav.next')}</Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/steps/AdminAccountStep.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/steps/AdminAccountStep.tsx src/components/setup/steps/AdminAccountStep.test.tsx
git commit -m "feat(ui): add AdminAccountStep with strength meter"
```

---

## Task 12: RecapStep (submit bootstrap)

**Files:** Create `src/components/setup/steps/RecapStep.tsx`, `src/components/setup/steps/RecapStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/setup/steps/RecapStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { RecapStep } from './RecapStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

const data = { serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr', provider: 'Manual', name: 'koffi' }

describe('RecapStep', () => {
  it('calls onSubmit (which submits the bootstrap) and surfaces success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    wrap(<RecapStep data={data} onSubmit={onSubmit} onBack={vi.fn()} />)
    expect(screen.getByText('mail.exemple.fr')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Configurer' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  it('shows an error and a retry button when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    wrap(<RecapStep data={data} onSubmit={onSubmit} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configurer' }))
    await waitFor(() => expect(screen.getByText('Réessayer')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/steps/RecapStep.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// src/components/setup/steps/RecapStep.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { WizardData } from '../wizard-context'

interface Props {
  data: WizardData
  onSubmit: () => Promise<void>
  onBack: () => void
}

export function RecapStep({ data, onSubmit, onBack }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t('wizard.recap.title')}</h2>
      <dl className="space-y-2 text-sm">
        <Row label={t('wizard.recap.hostname')} value={data.serverHostname} />
        <Row label={t('wizard.recap.domain')} value={data.defaultDomain} />
        <Row label={t('wizard.recap.dns')} value={data.provider} />
        <Row label={t('wizard.recap.account')} value={`${data.name ?? ''}@${data.defaultDomain ?? ''}`} />
      </dl>
      {error && (
        <div role="alert" className="border-destructive text-destructive rounded-md border p-3 text-sm">
          <p>{t('wizard.error.title')}: {error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={submit}>
            {t('wizard.error.retry')}
          </Button>
        </div>
      )}
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          {t('wizard.nav.back')}
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy ? '…' : t('wizard.recap.submit')}
        </Button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between border-b pb-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/steps/RecapStep.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/steps/RecapStep.tsx src/components/setup/steps/RecapStep.test.tsx
git commit -m "feat(ui): add RecapStep with bootstrap submit + error retry"
```

---

## Task 13: RestartScreen (poll until normal mode)

**Files:** Create `src/components/setup/RestartScreen.tsx`, `src/components/setup/RestartScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/setup/RestartScreen.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { RestartScreen } from './RestartScreen'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('RestartScreen', () => {
  it('polls getStep and calls onReady once it leaves "collect"', async () => {
    const steps = ['collect', 'collect', 'account']
    const poll = vi.fn(async () => ({ step: steps.shift() ?? 'account' }))
    const onReady = vi.fn()
    wrap(<RestartScreen poll={poll} intervalMs={5} onReady={onReady} />)
    expect(screen.getByText('Configuration en cours')).toBeInTheDocument()
    await waitFor(() => expect(onReady).toHaveBeenCalledWith('account'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/RestartScreen.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the component**

```tsx
// src/components/setup/RestartScreen.tsx
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  poll: () => Promise<{ step: string }>
  onReady: (step: string) => void
  intervalMs?: number
  timeoutMs?: number
}

export function RestartScreen({ poll, onReady, intervalMs = 2000, timeoutMs = 90_000 }: Props) {
  const { t } = useTranslation()
  const [timedOut, setTimedOut] = useState(false)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    let active = true
    const started = Date.now()
    const tick = async () => {
      if (!active) return
      try {
        const { step } = await poll()
        if (!active) return
        if (step !== 'collect') {
          onReadyRef.current(step)
          return
        }
      } catch {
        // ignore transient errors while the server is down
      }
      if (Date.now() - started >= timeoutMs) {
        setTimedOut(true)
        return
      }
      setTimeout(() => void tick(), intervalMs)
    }
    void tick()
    return () => {
      active = false
    }
  }, [poll, intervalMs, timeoutMs])

  return (
    <div className="space-y-3 py-12 text-center">
      <div className="border-primary mx-auto h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
      <h2 className="text-lg font-medium">{t('wizard.restart.title')}</h2>
      <p className="text-muted-foreground text-sm">
        {timedOut ? t('wizard.restart.timeout') : t('wizard.restart.subtitle')}
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/RestartScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/RestartScreen.tsx src/components/setup/RestartScreen.test.tsx
git commit -m "feat(ui): add restart-wait screen polling getStep"
```

---

## Task 14: SetupWizard shell

**Files:** Create `src/components/setup/SetupWizard.tsx`, `src/components/setup/SetupWizard.test.tsx`

The shell drives the collect phase locally (welcome→domain→dns→account→recap→restart). After restart it hands control to the monitoring phase (Plan 2b-ii); for 2b-i, once the restart resolves to `account`, it renders a placeholder panel keyed by the resolved step.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/setup/SetupWizard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { SetupWizard } from './SetupWizard'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('SetupWizard', () => {
  it('walks the collect phase and submits the bootstrap', async () => {
    const submitBootstrap = vi.fn().mockResolvedValue(undefined)
    const poll = vi.fn().mockResolvedValue({ step: 'account' })
    wrap(<SetupWizard initialStep="collect" submitBootstrap={submitBootstrap} pollStep={poll} />)

    fireEvent.click(screen.getByRole('button', { name: 'Commencer' }))
    fireEvent.change(screen.getByLabelText('Nom d’hôte public'), { target: { value: 'mail.exemple.fr' } })
    fireEvent.change(screen.getByLabelText('Domaine email'), { target: { value: 'exemple.fr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    // DNS step (Manual default) → Next
    await screen.findByText('Fournisseur DNS')
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    // Account step
    await screen.findByText('Compte administrateur')
    fireEvent.change(screen.getByLabelText('Nom d’utilisateur'), { target: { value: 'koffi' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct horse battery 9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    // Recap → Configurer
    await screen.findByText('Récapitulatif')
    fireEvent.click(screen.getByRole('button', { name: 'Configurer' }))
    await waitFor(() =>
      expect(submitBootstrap).toHaveBeenCalledWith({ serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' }),
    )
    // restart screen appears
    await screen.findByText('Configuration en cours')
  })

  it('starts directly in the monitoring placeholder when initialStep is account', () => {
    wrap(<SetupWizard initialStep="account" submitBootstrap={vi.fn()} pollStep={vi.fn()} />)
    expect(screen.getByTestId('monitor-step').textContent).toBe('account')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/setup/SetupWizard.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the shell**

```tsx
// src/components/setup/SetupWizard.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Stepper } from './Stepper'
import { WizardProvider, useWizard } from './wizard-context'
import { WelcomeStep } from './steps/WelcomeStep'
import { DomainStep } from './steps/DomainStep'
import { DnsProviderStep } from './steps/DnsProviderStep'
import { AdminAccountStep } from './steps/AdminAccountStep'
import { RecapStep } from './steps/RecapStep'
import { RestartScreen } from './RestartScreen'
import type { DomainValues } from './schemas'

type CollectScreen = 'welcome' | 'domain' | 'dns' | 'account' | 'recap' | 'restarting'

interface Props {
  initialStep: string
  submitBootstrap: (input: DomainValues) => Promise<void>
  pollStep: () => Promise<{ step: string }>
}

export function SetupWizard(props: Props) {
  return (
    <WizardProvider>
      <WizardInner {...props} />
    </WizardProvider>
  )
}

function WizardInner({ initialStep, submitBootstrap, pollStep }: Props) {
  const { t } = useTranslation()
  const { data, setData } = useWizard()
  // In bootstrap mode we drive the collect phase locally; otherwise jump to monitoring.
  const [screen, setScreen] = useState<CollectScreen>(
    initialStep === 'collect' ? 'welcome' : 'restarting',
  )
  const [monitorStep, setMonitorStep] = useState<string>(
    initialStep === 'collect' ? '' : initialStep,
  )

  const collectLabels = [
    t('wizard.steps.welcome'),
    t('wizard.steps.domain'),
    t('wizard.steps.dns'),
    t('wizard.steps.account'),
    t('wizard.steps.recap'),
  ]
  const order: CollectScreen[] = ['welcome', 'domain', 'dns', 'account', 'recap']
  const activeIndex = Math.max(0, order.indexOf(screen))

  // Monitoring phase is implemented in Plan 2b-ii; here we render a placeholder.
  if (monitorStep) {
    return (
      <Card className="mx-auto mt-16 max-w-lg p-8">
        <p data-testid="monitor-step" className="text-muted-foreground text-center text-sm">
          {monitorStep}
        </p>
      </Card>
    )
  }

  return (
    <Card className="mx-auto mt-16 max-w-lg p-8">
      {screen !== 'restarting' && <Stepper labels={collectLabels} activeIndex={activeIndex} />}
      {screen === 'welcome' && <WelcomeStep onNext={() => setScreen('domain')} />}
      {screen === 'domain' && (
        <DomainStep
          defaults={data}
          onBack={() => setScreen('welcome')}
          onNext={(v) => {
            setData(v)
            setScreen('dns')
          }}
        />
      )}
      {screen === 'dns' && (
        <DnsProviderStep
          defaults={data}
          onBack={() => setScreen('domain')}
          onNext={(v) => {
            setData(v)
            setScreen('account')
          }}
        />
      )}
      {screen === 'account' && (
        <AdminAccountStep
          defaults={data}
          domain={data.defaultDomain ?? ''}
          onBack={() => setScreen('dns')}
          onNext={(v) => {
            setData(v)
            setScreen('recap')
          }}
        />
      )}
      {screen === 'recap' && (
        <RecapStep
          data={data}
          onBack={() => setScreen('account')}
          onSubmit={async () => {
            await submitBootstrap({
              serverHostname: data.serverHostname ?? '',
              defaultDomain: data.defaultDomain ?? '',
            })
            setScreen('restarting')
          }}
        />
      )}
      {screen === 'restarting' && (
        <RestartScreen poll={pollStep} onReady={(step) => setMonitorStep(step)} />
      )}
    </Card>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/setup/SetupWizard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/SetupWizard.tsx src/components/setup/SetupWizard.test.tsx
git commit -m "feat(ui): add SetupWizard shell (collect phase + restart handoff)"
```

---

## Task 15: Route wiring + I18nextProvider

**Files:** Modify `src/routes/__root.tsx`, `src/routes/setup/index.tsx`

- [ ] **Step 1: Wrap the app in `<I18nextProvider>` and seed language from the root loader**

Modify `src/routes/__root.tsx`:
- Add a `loader` that resolves the language server-side via `getServerLang`.
- Build the i18n instance with that language and wrap `children` in `<I18nextProvider>` inside `RootDocument`.

Add these imports at the top:
```tsx
import { I18nextProvider } from 'react-i18next'
import { createI18n, type Lang } from '../i18n/i18n'
import { getServerLang } from '../server/setup-lang'
```
Add a loader to the route options (alongside `head`/`shellComponent`):
```tsx
  loader: async () => {
    const { lang } = await getServerLang()
    return { lang }
  },
```
In `RootDocument`, read the loader data and wrap children:
```tsx
function RootDocument({ children }: { children: React.ReactNode }) {
  const { lang } = Route.useLoaderData() as { lang: Lang }
  const i18n = createI18n(lang)
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        {isDev && (
          <Suspense fallback={null}>
            <DevTools />
          </Suspense>
        )}
        <Scripts />
      </body>
    </html>
  )
}
```

> Verification note: confirm `Route.useLoaderData()` is the correct accessor for the installed `@tanstack/react-router` (it is the standard API). If the root loader cannot run in this position, fall back to wrapping in `shellComponent` with a default `createI18n('fr')` and resolving language client-side from the cookie via a `useEffect` that calls `i18n.changeLanguage`. The collect UI is fully functional either way (language defaults to FR; the WelcomeStep switch works).

- [ ] **Step 2: Replace the setup route with the wizard**

Replace `src/routes/setup/index.tsx` entirely:
```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { getStep, submitBootstrapFn } from '@/server/setup-actions'
import { SetupWizard } from '@/components/setup/SetupWizard'

export const Route = createFileRoute('/setup/')({
  loader: async () => await getStep(),
  component: SetupPage,
  errorComponent: SetupError,
})

function SetupPage() {
  const { step } = Route.useLoaderData()
  return (
    <main className="flex min-h-svh flex-col bg-muted/30 px-4">
      <SetupWizard
        initialStep={step}
        submitBootstrap={(data) => submitBootstrapFn({ data }).then(() => undefined)}
        pollStep={() => getStep()}
      />
    </main>
  )
}

function SetupError() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div role="alert" className="text-center">
        <p className="text-destructive font-medium">{t('wizard.error.title')}</p>
        <button className="mt-4 underline" onClick={() => window.location.reload()}>
          {t('wizard.error.retry')}
        </button>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Typecheck + full suite**

Run: `bun run typecheck && bun run test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 4: Manual smoke (dev server)**

Run: `bun run dev` and open `http://localhost:3000/setup`. Verify: the welcome screen renders, the FR/EN switch flips labels, and you can walk welcome→domain→dns→account→recap. (Submitting requires a running Stalwart in bootstrap mode — that is exercised by the 2a smoke + Plan 2b-ii; here just confirm the collect UI renders and validates.) Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/routes/__root.tsx src/routes/setup/index.tsx
git commit -m "feat(ui): mount setup wizard at /setup with i18n provider"
```

---

## Task 16: Final gate

- [ ] **Step 1: Full suite + gates**

Run: `bun run test && bun run typecheck && bun run lint`
Expected: all green (existing 82 + the new component/i18n/schema/server suites).

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "chore(ui): 2b-i suite green (typecheck + lint)"
```

---

## Self-Review notes (coverage of the spec, §ref = UI design spec)

- §3 stack (TanStack Form, Zod, react-i18next, shadcn) → Task 1, 2.
- §3 i18n FR/EN + cookie + SSR seed + switcher → Tasks 2, 4, 8, 15.
- §4 single `/setup` route + derived step + restart screen → Tasks 14, 15, 13.
- §4 error handling (inline alert + retry; route errorComponent) → Tasks 12, 15.
- §5 collect steps 1–5 → Tasks 8–12.
- §5 zod schemas shared with server `.validator()` → Tasks 3, 4.
- Stepper / collected-state / password meter → Tasks 7, 5, 6.

**Out of scope (Plan 2b-ii):** monitoring phase (account creation, DNS grid, SSL/ACME, Done), the remaining server functions + `stalwart-acme.ts`, and the recovery-admin teardown. The shell hands off to a placeholder keyed by the resolved step once the restart completes.

**Flagged verification points (library details, not logic):** `getHeaders` import path (Task 4), `Route.useLoaderData()` in the root (Task 15), and shadcn `Card`/`Button` variant prop names — each has a stated fallback and does not block the tested logic.
