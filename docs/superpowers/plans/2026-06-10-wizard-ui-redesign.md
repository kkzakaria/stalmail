# Wizard UI Redesign (collect phase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing collect-phase setup wizard UI (Welcome → Domain → DNS provider → Admin account → Recap, plus the restart screen and wizard shell) to faithfully match the new Stalmail design handoff, while staying wired to the existing backend (`getStep` / `submitBootstrapFn`).

**Architecture:** Keep the current TanStack Start route (`/setup`), TanStack Form + Zod validation, and i18next FR/EN. Replace the presentation: a card-centered shell with a header (brand + extensible language selector + light/dark theme toggle), a grouped numbered stepper (Configuration / Activation, 9 dots — only the 5 collect dots are interactive in this scope), and re-skinned step bodies built from a small set of wizard-local UI primitives. The design's visual system is ported as a scoped CSS token sheet (`src/components/setup/wizard.css`) keyed off a `.stalmail-wizard` root with a `data-theme` attribute, so it never clobbers the app-wide shadcn tokens. Geist / Geist Mono fonts, scoped to the wizard. Theme is seeded server-side (cookie) like language, to avoid hydration flash.

**Tech Stack:** React 19, TanStack Start/Router/Form, Zod, i18next/react-i18next, Tailwind v4 + shadcn (untouched for the rest of the app), lucide-react icons, @fontsource-variable/geist(+mono), Vitest + @testing-library/react.

**Out of scope (defer to Plan 2b-ii):** monitoring steps 6–9 (account creation, live DNS grid, ACME/SSL, Done), the login page, and the monitoring server functions. The stepper shows the 4 activation dots as inert "todo" placeholders.

**Source of truth (vendored in repo):** `docs/design/wizard-handoff/` — read these before implementing:
- `project/wizard/styles.css` — the design's full CSS (tokens + every component class).
- `project/wizard/ui.jsx` — the prototype's UI primitives (icons, Button, Field, Input, PasswordInput, Combobox, Alert, Badge, StrengthMeter, StepperH, Brand, LangSelect, ThemeToggle, …).
- `project/wizard/steps-collect.jsx` — the 5 collect steps + restart screen markup/logic.
- `project/wizard/app.jsx` — the card shell + header + step machine.
- `project/wizard/i18n.js` — every FR/EN string and the DNS provider list.
- `project/uploads/2026-06-09-setup-wizard-ui-design.md` — the functional design.

**Fidelity rule (from the handoff README):** match the *visual output*; recreate in the target stack (React/TSX + the ported CSS classes). The prototype is plain UMD React; we port its look, not its globals/localStorage/tweaks-panel.

---

## File Structure

**New files:**
- `src/components/setup/wizard.css` — ported design tokens (scoped under `.stalmail-wizard`, light + `[data-theme="dark"]`) + all wizard component classes + Geist font imports.
- `src/components/setup/ui/icons.tsx` — re-exports the lucide-react icons the wizard uses, under stable local names.
- `src/components/setup/ui/primitives.tsx` — `Button`, `Field`, `TextInput`, `PasswordInput`, `NativeSelect`, `Alert`, `Badge`, `Separator`, `Progress`, `Spinner`, `CopyButton`, `StepHeader`, `StepNav`, `Brand`, `BrandMark`.
- `src/components/setup/ui/Combobox.tsx` — searchable select with a pinned "Manual" sticky option + keyboard nav.
- `src/components/setup/ui/StrengthMeter.tsx` — 4-bar password strength meter (driven by existing `scorePassword`).
- `src/components/setup/ui/StepperH.tsx` — grouped numbered stepper (Configuration / Activation).
- `src/components/setup/ui/LangSelect.tsx` — globe + native select, extensible from `SUPPORTED_LANGS`.
- `src/components/setup/ui/ThemeToggle.tsx` — sun/moon toggle button.
- `src/server/setup-theme.ts` — `THEME_COOKIE`, `parseThemeCookie`, `getServerTheme` server function (mirrors `setup-lang.ts`).
- Tests: `src/components/setup/ui/Combobox.test.tsx`, `StrengthMeter.test.tsx`, `StepperH.test.tsx`, `primitives.test.tsx`, `LangSelect.test.tsx`, `ThemeToggle.test.tsx`, `src/server/setup-theme.test.ts`.

**Modified files:**
- `src/i18n/resources.ts` — extend FR/EN to the full collect-phase string set + 9 step labels + theme/lang labels.
- `src/components/setup/steps/WelcomeStep.tsx` — re-skin; remove in-step language selector (moves to header).
- `src/components/setup/steps/DomainStep.tsx` — re-skin + external-zone warning.
- `src/components/setup/steps/DnsProviderStep.tsx` — Combobox + sticky Manual + secret field.
- `src/components/setup/steps/AdminAccountStep.tsx` — re-skin + derived email + PasswordInput + StrengthMeter.
- `src/components/setup/steps/RecapStep.tsx` — recap rows with per-row edit (`goTo`) + inline error alert.
- `src/components/setup/RestartScreen.tsx` — design restart screen (spinner + indeterminate progress + poll log), real poll preserved.
- `src/components/setup/SetupWizard.tsx` — card shell + header + StepperH + step switch + restart phase + `goTo` + theme state.
- `src/routes/setup/index.tsx` — loader fetches `getStep` + `getServerTheme`; pass `initialTheme`; wrap markup.
- Their existing tests, updated to the new markup/keys.

**Deleted files:**
- `src/components/setup/Stepper.tsx` (replaced by `StepperH`) — removed in the shell task.

---

## Conventions for every task

- Run the project test suite with `bun run test` (Vitest). Typecheck with `bun run typecheck` (or the script that exists — check `package.json`). Lint with `bun run lint`.
- The dev stack is already running and bind-mounts the repo (`compose.dev.yml`), so changes are live at `https://localhost/setup` — but per-task verification is via unit tests + build, not pixels. Live visual check is the final task.
- Commit after each task with a conventional message (`feat:` / `refactor:` / `test:` / `chore:`).
- Every commit must keep `bun run test` and `bun run typecheck` green. Tasks are ordered so step rewrites keep the *same external props* (`onNext`/`onBack`/`defaults`) until the shell task; only `RecapStep` gains a `goTo` prop, added on both sides in its task.

---

## Task 1: Design tokens, Geist fonts & `wizard.css`

**Files:**
- Create: `src/components/setup/wizard.css`
- Modify: `package.json` (add `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`)

- [ ] **Step 1: Install the fonts**

```bash
bun add @fontsource-variable/geist @fontsource-variable/geist-mono
```

After install, confirm the exposed CSS `font-family` names:

```bash
grep -rh "font-family" node_modules/@fontsource-variable/geist/index.css | head -1
grep -rh "font-family" node_modules/@fontsource-variable/geist-mono/index.css | head -1
```

Expected families: `"Geist Variable"` and `"Geist Mono Variable"` (use whatever the grep reports; fall back to `"Geist"` / `"Geist Mono"` in the stack regardless).

- [ ] **Step 2: Write `src/components/setup/wizard.css`**

Port `docs/design/wizard-handoff/project/wizard/styles.css` **verbatim for the component classes**, with these adaptations:

1. **Scope the tokens.** Replace the design's `:root { … }` block with `.stalmail-wizard { … }` (same custom properties/values), and its `[data-theme="dark"] { … }` block with `.stalmail-wizard[data-theme="dark"] { … }`. Keep all token values exactly (accent `oklch(0.55 0.15 250)`, zinc neutrals, `--radius: 8px`, shadows, success/warning/destructive, ring, etc.).
2. **Font imports at the top:**
   ```css
   @import '@fontsource-variable/geist';
   @import '@fontsource-variable/geist-mono';
   ```
   and set, inside `.stalmail-wizard`:
   ```css
   --font-sans: "Geist Variable", "Helvetica Neue", Helvetica, Arial, sans-serif;
   --font-mono: "Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace;
   font-family: var(--font-sans);
   background: var(--background);
   color: var(--foreground);
   min-height: 100vh;
   ```
   (i.e. fold the design's `body { … }` rules onto `.stalmail-wizard` instead of `body`; drop the global `* { box-sizing }`, `html, body`, `p`, `h1` resets — Tailwind base already handles those app-wide. Keep `.mono { font-family: var(--font-mono); }`.)
3. **Keep every component class** from the design unchanged: `.brand`, `.brandmark`, `.btn*`, `.field`, `.label`, `.help`, `.field-error`, `.input*`, `.pw-*`, `.select*`, `.combobox*`, `.card`, `.alert*`, `.badge*`, `.separator`, `.progress*`, `.spinner`, `@keyframes spin/indet`, `.stepper-h*`, `.step-dot*`, `.step-header`, `.step-title`, `.step-sub`, `.step-body*`, `.step-welcome`, `.step-nav`, `.inline-status*`, `.need-*`, `.strength*`, `.recap*`, `.step-restart`, `.restart-spinner`, `.poll-*`, `.shell*`, `.shell-card*`, `.shell-top-actions`, `.lang-select*`, `.theme-toggle`, `.step-anim` + `@keyframes stepIn`, and the `@media (max-width: 760px)` rule. You MAY omit the DNS-grid/zone classes (`.dns-*`, `.zonefile*`, `.rec-*`, `.copy-icon-btn`, `.cell-*`, `.step-done`, `.done-mark`) and the `.login-*` classes — they belong to monitoring/login (out of scope). Omitting them is fine; keeping them is harmless. Keep `.copy-btn*` (used by recap/zone copy affordances we keep minimal).

This file is plain CSS (not processed by Tailwind's `@theme`); it will be imported by the wizard shell in a later task. Importing it here is not required yet.

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: build succeeds (the new CSS is valid; fonts resolve). If `bun run build` is heavy, `bun run typecheck` + a Vite dev compile is acceptable — but a successful production build is the gate.

- [ ] **Step 4: Commit**

```bash
git add src/components/setup/wizard.css package.json bun.lock
git commit -m "feat(wizard): port design tokens, Geist fonts, scoped wizard.css"
```

---

## Task 2: i18n — full collect-phase FR/EN strings

**Files:**
- Modify: `src/i18n/resources.ts`
- Test: `src/i18n/resources.test.ts` (create if absent; otherwise extend)

**Important:** This task is **additive + restructuring** but must keep existing steps compiling. The five step components still reference old keys until their own task migrates them. So: **add all new keys; keep any old key still referenced** (`wizard.welcome.language`, `wizard.domain.hostnameHint`, `wizard.domain.domainHint`, `wizard.domain.dnsWarning`, `wizard.dns.secretHint`). The final cleanup task removes the orphans.

- [ ] **Step 1: Replace `src/i18n/resources.ts` with the merged structure below**

The `fr` object is the source; `en` mirrors it (the `DeepRecord<typeof fr>` type enforces key parity). Use i18next `{{var}}` interpolation. Strings are taken from `docs/design/wizard-handoff/project/wizard/i18n.js`.

```ts
export const fr = {
  wizard: {
    common: {
      back: 'Retour',
      next: 'Continuer',
      retry: 'Réessayer',
      copy: 'Copier',
      copied: 'Copié',
      stepOf: 'Étape {{n}} sur 9',
    },
    groups: { config: 'Configuration', activation: 'Activation' },
    steps: {
      welcome: 'Bienvenue',
      domain: 'Domaine',
      dnsProvider: 'Fournisseur DNS',
      admin: 'Administrateur',
      recap: 'Récapitulatif',
      account: 'Compte',
      dnsRecords: 'Enregistrements DNS',
      ssl: 'SSL',
      done: 'Terminé',
    },
    theme: { toLight: 'Passer au thème clair', toDark: 'Passer au thème sombre' },
    langs: { fr: 'Français', en: 'English' },
    error: { title: 'Une erreur est survenue', retry: 'Réessayer' },
    welcome: {
      title: 'Bienvenue sur Stalmail',
      subtitle:
        'Votre serveur e-mail auto-hébergé. Configurons-le ensemble — comptez environ cinq minutes.',
      needTitle: 'Avant de commencer, ayez sous la main :',
      need1: 'un nom de domaine qui vous appartient',
      need2: "l'accès à la zone DNS de ce domaine",
      start: 'Commencer',
      language: 'Langue', // legacy, removed in cleanup
    },
    domain: {
      title: 'Votre domaine',
      subtitle:
        "Le nom d'hôte identifie ce serveur ; le domaine porte vos adresses e-mail.",
      hostname: "Nom d'hôte du serveur",
      hostnameHelp: 'Le nom DNS public de cette machine.',
      hostnamePlaceholder: 'mail.exemple.fr',
      domain: 'Domaine par défaut',
      domainHelp: 'Vos adresses seront de la forme nom@{{domain}}.',
      domainPlaceholder: 'exemple.fr',
      invalidHostname: "Format de nom d'hôte invalide.",
      invalidDomain: 'Format de domaine invalide.',
      extTitle: "Nom d'hôte hors du domaine par défaut",
      ext: "{{host}} appartient à la zone {{zone}}, distincte de {{domain}}. Son enregistrement A (et le certificat SSL) relèvent de cette zone — l'automatisation DNS ne couvrira que {{domain}}.",
      hostnameHint: 'ex. mail.exemple.fr', // legacy
      domainHint: 'ex. exemple.fr', // legacy
      dnsWarning: "Ce nom d'hôte ne pointe pas encore vers ce serveur.", // legacy
    },
    dns: {
      title: 'Fournisseur DNS',
      subtitle:
        'Stalmail peut créer automatiquement les enregistrements DNS chez votre fournisseur.',
      provider: 'Fournisseur',
      placeholder: 'Choisir un fournisseur…',
      search: 'Rechercher un fournisseur…',
      empty: 'Aucun fournisseur trouvé.',
      manual: 'Configuration manuelle',
      manualHint: 'Je créerai les enregistrements moi-même',
      manualNote:
        "À l'étape 7, le wizard affichera les enregistrements à copier chez votre fournisseur.",
      secret: 'Clé API',
      secretHelp: "Créez un jeton avec accès en écriture à la zone {{domain}}.",
      secretRequired: 'La clé API est requise.',
      required: 'Choisissez un fournisseur ou le mode manuel.',
      secretHint: 'Jamais affichée après validation.', // legacy
    },
    account: {
      title: 'Compte administrateur',
      subtitle: 'Ce compte gérera le serveur et recevra les rapports.',
      name: "Nom d'utilisateur",
      namePlaceholder: 'admin',
      email: 'Adresse : {{email}}',
      invalidName: 'Lettres, chiffres, points et tirets uniquement.',
      password: 'Mot de passe',
      passwordHelp:
        "Indicatif — le serveur applique sa propre politique à l'étape suivante.",
      invalidPassword: '8 caractères minimum.',
      show: 'Afficher le mot de passe',
      hide: 'Masquer le mot de passe',
      strength: { weak: 'Faible', medium: 'Correct', strong: 'Fort' },
    },
    recap: {
      title: 'Récapitulatif',
      subtitle: 'Vérifiez ces informations — le serveur sera configuré avec.',
      hostname: "Nom d'hôte",
      domain: 'Domaine',
      dns: 'DNS',
      dnsAuto: 'Automatique via {{provider}}',
      dnsManual: 'Manuel',
      account: 'Administrateur',
      edit: 'Modifier',
      submit: 'Configurer le serveur',
      note: 'Stalwart écrira sa configuration puis redémarrera.',
    },
    restart: {
      title: 'Configuration en cours',
      subtitle:
        "Le serveur écrit sa configuration et redémarre. Cela prend généralement moins d'une minute.",
      timeout:
        'Cela prend plus de temps que prévu. Vous pouvez réessayer.',
      poll: 'getStep() · tentative {{n}}',
      restarting: 'redémarrage…',
      ready: 'prêt — mode normal',
    },
  },
} as const

type DeepRecord<T> = {
  [K in keyof T]: T[K] extends Record<string, unknown> ? DeepRecord<T[K]> : string
}

export const en: DeepRecord<typeof fr> = {
  wizard: {
    common: { back: 'Back', next: 'Continue', retry: 'Retry', copy: 'Copy', copied: 'Copied', stepOf: 'Step {{n}} of 9' },
    groups: { config: 'Configuration', activation: 'Activation' },
    steps: {
      welcome: 'Welcome', domain: 'Domain', dnsProvider: 'DNS provider', admin: 'Administrator',
      recap: 'Summary', account: 'Account', dnsRecords: 'DNS records', ssl: 'SSL', done: 'Done',
    },
    theme: { toLight: 'Switch to light theme', toDark: 'Switch to dark theme' },
    langs: { fr: 'Français', en: 'English' },
    error: { title: 'Something went wrong', retry: 'Retry' },
    welcome: {
      title: 'Welcome to Stalmail',
      subtitle: "Your self-hosted email server. Let's set it up together — it takes about five minutes.",
      needTitle: 'Before starting, have at hand:',
      need1: 'a domain name you own',
      need2: "access to that domain's DNS zone",
      start: 'Get started',
      language: 'Language',
    },
    domain: {
      title: 'Your domain',
      subtitle: 'The hostname identifies this server; the domain carries your email addresses.',
      hostname: 'Server hostname',
      hostnameHelp: 'The public DNS name of this machine.',
      hostnamePlaceholder: 'mail.example.com',
      domain: 'Default domain',
      domainHelp: 'Your addresses will look like name@{{domain}}.',
      domainPlaceholder: 'example.com',
      invalidHostname: 'Invalid hostname format.',
      invalidDomain: 'Invalid domain format.',
      extTitle: 'Hostname outside the default domain',
      ext: '{{host}} belongs to the {{zone}} zone, distinct from {{domain}}. Its A record (and the SSL certificate) live in that zone — DNS automation will only cover {{domain}}.',
      hostnameHint: 'e.g. mail.example.com',
      domainHint: 'e.g. example.com',
      dnsWarning: 'This hostname does not point to this server yet.',
    },
    dns: {
      title: 'DNS provider',
      subtitle: 'Stalmail can create your DNS records automatically at your provider.',
      provider: 'Provider',
      placeholder: 'Choose a provider…',
      search: 'Search providers…',
      empty: 'No provider found.',
      manual: 'Manual setup',
      manualHint: 'I will create the records myself',
      manualNote: 'At step 7, the wizard will display the records to copy to your provider.',
      secret: 'API key',
      secretHelp: 'Create a token with write access to the {{domain}} zone.',
      secretRequired: 'The API key is required.',
      required: 'Choose a provider or manual mode.',
      secretHint: 'Never shown after you continue.',
    },
    account: {
      title: 'Administrator account',
      subtitle: 'This account will manage the server and receive reports.',
      name: 'Username',
      namePlaceholder: 'admin',
      email: 'Address: {{email}}',
      invalidName: 'Letters, digits, dots and dashes only.',
      password: 'Password',
      passwordHelp: 'Indicative — the server enforces its own policy at the next step.',
      invalidPassword: 'Minimum 8 characters.',
      show: 'Show password',
      hide: 'Hide password',
      strength: { weak: 'Weak', medium: 'Okay', strong: 'Strong' },
    },
    recap: {
      title: 'Summary',
      subtitle: 'Review this information — the server will be configured with it.',
      hostname: 'Hostname',
      domain: 'Domain',
      dns: 'DNS',
      dnsAuto: 'Automatic via {{provider}}',
      dnsManual: 'Manual',
      account: 'Administrator',
      edit: 'Edit',
      submit: 'Configure the server',
      note: 'Stalwart will write its configuration, then restart.',
    },
    restart: {
      title: 'Configuring',
      subtitle: 'The server is writing its configuration and restarting. This usually takes less than a minute.',
      timeout: 'This is taking longer than expected. You can retry.',
      poll: 'getStep() · attempt {{n}}',
      restarting: 'restarting…',
      ready: 'ready — normal mode',
    },
  },
}
```

- [ ] **Step 2: Add a key-parity smoke test** in `src/i18n/resources.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { fr, en } from './resources'

function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keyPaths(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

describe('i18n resources', () => {
  it('fr and en have identical key paths', () => {
    expect(keyPaths(en)).toEqual(keyPaths(fr))
  })
  it('interpolation placeholders match between fr and en', () => {
    const frFlat = Object.fromEntries(keyPaths(fr).map((p) => [p, p]))
    // spot-check a couple of interpolated keys exist
    expect(frFlat['wizard.domain.ext']).toBeDefined()
    expect(fr.wizard.recap.dnsAuto).toContain('{{provider}}')
    expect(en.wizard.recap.dnsAuto).toContain('{{provider}}')
  })
})
```

- [ ] **Step 3: Run tests**

Run: `bun run test`
Expected: all pass (including the new parity test). `bun run typecheck` green (the `DeepRecord` type still holds).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/resources.ts src/i18n/resources.test.ts
git commit -m "feat(i18n): full collect-phase FR/EN strings for wizard redesign"
```

---

## Task 3: Theme cookie (server-side, SSR-seeded)

**Files:**
- Create: `src/server/setup-theme.ts`
- Test: `src/server/setup-theme.test.ts`

Mirror `src/server/setup-lang.ts` (read it first for the exact `getCookie` lazy-import pattern that avoids leaking server-only code into the client bundle).

- [ ] **Step 1: Write `src/server/setup-theme.ts`**

```ts
import { createServerFn } from '@tanstack/react-start'

export const THEME_COOKIE = 'stalmail_theme'
export type Theme = 'light' | 'dark'
export const DEFAULT_THEME: Theme = 'light'

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark'
}

/** Pure parser — extracts the theme from a Cookie header. Used in tests. */
export function parseThemeCookie(cookieHeader?: string): Theme {
  if (!cookieHeader) return DEFAULT_THEME
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === THEME_COOKIE) {
      const v = decodeURIComponent(rest.join('='))
      return isTheme(v) ? v : DEFAULT_THEME
    }
  }
  return DEFAULT_THEME
}

export const getServerTheme = createServerFn({ method: 'GET' }).handler(async () => {
  // Lazy import keeps @tanstack/react-start/server out of the client bundle.
  const { getCookie } = await import('@tanstack/react-start/server')
  const raw = getCookie(THEME_COOKIE)
  return { theme: isTheme(raw) ? raw : DEFAULT_THEME }
})
```

> Check `setup-lang.ts` for the exact `createServerFn` import path and shape; match it precisely (the project may use a slightly different import). Keep the server-fn return as `{ theme }`.

- [ ] **Step 2: Write `src/server/setup-theme.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { parseThemeCookie, isTheme, DEFAULT_THEME } from './setup-theme'

describe('parseThemeCookie', () => {
  it('returns the default when no header', () => {
    expect(parseThemeCookie(undefined)).toBe(DEFAULT_THEME)
  })
  it('reads a valid theme', () => {
    expect(parseThemeCookie('stalmail_theme=dark')).toBe('dark')
    expect(parseThemeCookie('foo=1; stalmail_theme=light; bar=2')).toBe('light')
  })
  it('falls back on an invalid value', () => {
    expect(parseThemeCookie('stalmail_theme=purple')).toBe(DEFAULT_THEME)
  })
})

describe('isTheme', () => {
  it('narrows valid themes', () => {
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('nope')).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests** — `bun run test` (new file passes), `bun run typecheck` green.

- [ ] **Step 4: Commit**

```bash
git add src/server/setup-theme.ts src/server/setup-theme.test.ts
git commit -m "feat(setup): SSR-seeded theme cookie (setup-theme)"
```

---

## Task 4: Core UI primitives

**Files:**
- Create: `src/components/setup/ui/icons.tsx`, `src/components/setup/ui/primitives.tsx`
- Test: `src/components/setup/ui/primitives.test.tsx`

Use **lucide-react** (already a dependency via shadcn — verify with `grep lucide-react package.json`; if absent, `bun add lucide-react`). Map design glyphs → lucide:
Mail, Globe, Server, Sun, Moon, Search, Pencil (Pen), Download, Check, Copy, Eye, EyeOff, ArrowRight, ArrowLeft, Info, TriangleAlert (AlertTriangle), Lock.

- [ ] **Step 1: `icons.tsx`** — thin re-exports so the rest of the wizard imports stable names:

```tsx
export {
  Mail as IconMail, Globe as IconGlobe, Server as IconServer, Sun as IconSun,
  Moon as IconMoon, Search as IconSearch, Pencil as IconPen, Download as IconDownload,
  Check as IconCheck, Copy as IconCopy, Eye as IconEye, EyeOff as IconEyeOff,
  ArrowRight as IconArrowR, ArrowLeft as IconArrowL, Info as IconInfo,
  TriangleAlert as IconAlert, Lock as IconLock,
} from 'lucide-react'
```

- [ ] **Step 2: `primitives.tsx`** — recreate these using the ported CSS classes (read `docs/design/wizard-handoff/project/wizard/ui.jsx` for exact markup/props). Typed TSX. Components:

  - `Spinner({ size=16 })` → `<span className="spinner" style={{width,height}} aria-label="loading" />`
  - `Button({ variant='primary', size='md', type='button', disabled, onClick, children, style })` → `className={"btn btn-"+variant+" btn-"+size}`. Variants: `primary | outline | ghost`. Sizes: `md | lg | sm`.
  - `Field({ label, htmlFor, help, error, optional, children })` → `.field` with `.label`/`.label-opt`, then children, then `.field-error` (if `error`) else `.help`.
  - `TextInput({ id, value, onChange, placeholder, type='text', invalid, mono, autoFocus, onEnter })` → `.input` (+`mono`,+`input-invalid`); `onChange(value)`; Enter → `onEnter`.
  - `PasswordInput({ id, value, onChange, invalid, showLabel, hideLabel, onEnter })` → `.pw-wrap` with a `TextInput` (mono, type toggles password/text) + `.pw-toggle` button rendering `IconEye`/`IconEyeOff`, `aria-label` = show/hide label.
  - `NativeSelect({ id, value, onChange, invalid, children })` → `.select-wrap` + `.select` + chevron (kept for completeness; the DNS step uses Combobox).
  - `Alert({ variant='info', title, children, action })` → `.alert .alert-{variant}`, icon by variant (`info`→IconInfo, `warning`/`destructive`→IconAlert, `success`→IconCheck), `.alert-body` with `.alert-title`, `.alert-desc`. `role="alert"`.
  - `Badge({ variant='neutral', pulse, children })` → `.badge .badge-{variant}` + `.badge-spinner` (if pulse) else `.badge-dot`.
  - `Separator()` → `.separator`.
  - `Progress({ value, indeterminate })` → `.progress` (+`progress-indeterminate`) with `.progress-bar` (width `value%` when not indeterminate).
  - `CopyButton({ text, label, copiedLabel, small })` → `.copy-btn` (+`copy-btn-sm`); on click `navigator.clipboard.writeText(text)`, flips to `IconCheck` + `copiedLabel` for ~1.6 s.
  - `StepHeader({ title, sub })` → `.step-header` with `.step-title` (h1) + `.step-sub`.
  - `StepNav({ onBack, onNext, backLabel, nextLabel, nextDisabled, busy, nextVariant })` → `.step-nav`: left = ghost Back (with `IconArrowL`) if `onBack` else spacer; right = Button (`busy`→Spinner, else `IconArrowR` after label).
  - `Brand({ size=24 })` / `BrandMark({ size })` → `.brand`/`.brandmark` (accent square with `IconMail`) + `.brand-name` "Stalmail".

  All text labels come from props (i18n is resolved by callers), not hardcoded.

- [ ] **Step 3: `primitives.test.tsx`** — cover the interactive ones:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PasswordInput, CopyButton, Alert } from './primitives'

describe('PasswordInput', () => {
  it('toggles visibility', () => {
    render(<PasswordInput id="p" value="secret" onChange={() => {}} showLabel="show" hideLabel="hide" />)
    const input = document.getElementById('p') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'show' }))
    expect(input.type).toBe('text')
  })
})

describe('Alert', () => {
  it('renders title + role=alert', () => {
    render(<Alert variant="warning" title="warn">body</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('warn')
    expect(screen.getByRole('alert')).toHaveTextContent('body')
  })
})

describe('CopyButton', () => {
  it('writes to clipboard on click', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyButton text="abc" label="Copy" copiedLabel="Copied" />)
    fireEvent.click(screen.getByRole('button'))
    expect(writeText).toHaveBeenCalledWith('abc')
  })
})
```

- [ ] **Step 4: Run tests** — `bun run test`, `bun run typecheck` green.

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/ui/icons.tsx src/components/setup/ui/primitives.tsx src/components/setup/ui/primitives.test.tsx package.json bun.lock
git commit -m "feat(wizard): core UI primitives (buttons, fields, inputs, alerts)"
```

---

## Task 5: Combobox (searchable provider select)

**Files:**
- Create: `src/components/setup/ui/Combobox.tsx`
- Test: `src/components/setup/ui/Combobox.test.tsx`

Port `Combobox` from `docs/design/wizard-handoff/project/wizard/ui.jsx` (lines ~95–204) to typed TSX. Props:

```ts
interface ComboboxProps {
  id: string
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  stickyOption?: { value: string; label: string; hint?: string }
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  invalid?: boolean
}
```

Behaviour to preserve exactly: accent/case-insensitive filtering (`normalize('NFD').replace(/[̀-ͯ]/g,'')`), pinned sticky option in `.combobox-footer` always visible, keyboard (↓/↑ move `active`, Enter selects active or the sole match, Escape closes), click-outside closes, search input autofocus on open, `IconCheck` on the selected item, `IconSearch` in the search row, `IconPen` in the sticky icon. Use `IconCheck`, `IconSearch`, `IconPen` from `./icons`.

- [ ] **Step 1: Write the component** (TSX port).

- [ ] **Step 2: Test** `Combobox.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Combobox } from './Combobox'

const opts = ['Cloudflare', 'Gandi', 'OVHcloud']

function open() {
  fireEvent.click(screen.getByRole('button', { expanded: false }))
}

describe('Combobox', () => {
  it('filters options by query (accent/case-insensitive)', () => {
    render(<Combobox id="c" value="" onChange={() => {}} options={opts}
      placeholder="Choose" searchPlaceholder="Search" emptyText="None" />)
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gan' } })
    expect(screen.getByText('Gandi')).toBeInTheDocument()
    expect(screen.queryByText('Cloudflare')).not.toBeInTheDocument()
  })

  it('selects an option on click', () => {
    const onChange = vi.fn()
    render(<Combobox id="c" value="" onChange={onChange} options={opts}
      placeholder="Choose" searchPlaceholder="Search" emptyText="None" />)
    open()
    fireEvent.click(screen.getByText('Cloudflare'))
    expect(onChange).toHaveBeenCalledWith('Cloudflare')
  })

  it('keeps the sticky option visible while filtering and selects it', () => {
    const onChange = vi.fn()
    render(<Combobox id="c" value="" onChange={onChange} options={opts}
      stickyOption={{ value: 'Manual', label: 'Manual setup', hint: 'self' }}
      placeholder="Choose" searchPlaceholder="Search" emptyText="None" />)
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })
    expect(screen.getByText('None')).toBeInTheDocument() // empty list
    fireEvent.click(screen.getByText('Manual setup')) // sticky still there
    expect(onChange).toHaveBeenCalledWith('Manual')
  })

  it('shows the empty text when nothing matches', () => {
    render(<Combobox id="c" value="" onChange={() => {}} options={opts}
      placeholder="Choose" searchPlaceholder="Search" emptyText="None found" />)
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })
    expect(screen.getByText('None found')).toBeInTheDocument()
  })
})
```

> If the trigger isn't matched by `{ expanded: false }` in your markup, query it by `id` instead; ensure `aria-expanded` and `aria-haspopup="listbox"` are on the trigger and `role="combobox"` is on the search input (matches the prototype).

- [ ] **Step 3: Run tests** — green.

- [ ] **Step 4: Commit**

```bash
git add src/components/setup/ui/Combobox.tsx src/components/setup/ui/Combobox.test.tsx
git commit -m "feat(wizard): searchable Combobox with pinned manual option"
```

---

## Task 6: StrengthMeter + StepperH

**Files:**
- Create: `src/components/setup/ui/StrengthMeter.tsx`, `src/components/setup/ui/StepperH.tsx`
- Test: `src/components/setup/ui/StrengthMeter.test.tsx`, `src/components/setup/ui/StepperH.test.tsx`

- [ ] **Step 1: `StrengthMeter.tsx`** — 4 bars, driven by the **existing** `scorePassword` (`weak|medium|strong`, do not change `password-strength.ts`). Mapping:

```ts
// weak → 1 bar / destructive ; medium → 2 bars / warning ; strong → 4 bars / success
const META = {
  weak:   { fill: 1, color: 'var(--destructive)', key: 'weak' },
  medium: { fill: 2, color: 'var(--warning)',     key: 'medium' },
  strong: { fill: 4, color: 'var(--success)',     key: 'strong' },
} as const
```

```tsx
interface Props { password: string; label: string } // label = already-translated strength label
export function StrengthMeter({ password, label }: Props) {
  const score = scorePassword(password) // from '../password-strength'
  const { fill, color } = META[score]
  return (
    <div className="strength" aria-hidden={!password}>
      <div className="strength-bars">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="strength-bar"
            style={{ background: password && i < fill ? color : 'var(--border)' }} />
        ))}
      </div>
      <span className="strength-label" style={{ color: password ? color : 'var(--muted-foreground)' }}>
        {password ? label : ' '}
      </span>
    </div>
  )
}
```

The caller passes `label = t(`wizard.account.strength.${scorePassword(pw)}`)`.

- [ ] **Step 2: `StepperH.tsx`** — grouped numbered stepper. Port from `ui.jsx` `StepperH`. Props:

```ts
interface Step { n: number; label: string; group: 'config' | 'activation' }
interface Props { steps: Step[]; current: number; groupLabels: { config: string; activation: string } }
```

Render two `.stepper-h-group` columns (config, activation; second has `.stepper-h-group-sep`), each with a `.stepper-h-glabel` (`.is-current` when `current` is in that group) and `.stepper-h-dots`. Each dot: `.step-dot` + `step-dot-done` (n<current) / `step-dot-current` (n===current) / nothing (todo); done shows `IconCheck`, else the number. `title={label}`.

- [ ] **Step 3: Tests**

`StrengthMeter.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { StrengthMeter } from './StrengthMeter'

describe('StrengthMeter', () => {
  it('renders 4 bars and shows the label when a password is present', () => {
    const { container, getByText } = render(<StrengthMeter password="Abcdef12!xyz" label="Strong" />)
    expect(container.querySelectorAll('.strength-bar')).toHaveLength(4)
    expect(getByText('Strong')).toBeInTheDocument()
  })
  it('hides the label region for empty password', () => {
    const { container } = render(<StrengthMeter password="" label="Strong" />)
    expect(container.querySelector('.strength')?.getAttribute('aria-hidden')).toBe('true')
  })
})
```

`StepperH.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { StepperH } from './StepperH'

const steps = [
  { n: 1, label: 'Welcome', group: 'config' as const },
  { n: 2, label: 'Domain', group: 'config' as const },
  { n: 6, label: 'Account', group: 'activation' as const },
]

describe('StepperH', () => {
  it('marks done/current dots', () => {
    const { container } = render(
      <StepperH steps={steps} current={2} groupLabels={{ config: 'Configuration', activation: 'Activation' }} />,
    )
    expect(container.querySelector('.step-dot-done')).toBeTruthy() // step 1
    expect(container.querySelector('.step-dot-current')).toBeTruthy() // step 2
  })
  it('highlights the active group label', () => {
    const { container } = render(
      <StepperH steps={steps} current={2} groupLabels={{ config: 'Configuration', activation: 'Activation' }} />,
    )
    expect(container.querySelector('.stepper-h-glabel.is-current')?.textContent).toBe('Configuration')
  })
})
```

- [ ] **Step 4: Run tests** — green.

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/ui/StrengthMeter.tsx src/components/setup/ui/StepperH.tsx \
  src/components/setup/ui/StrengthMeter.test.tsx src/components/setup/ui/StepperH.test.tsx
git commit -m "feat(wizard): strength meter + grouped stepper"
```

---

## Task 7: LangSelect + ThemeToggle

**Files:**
- Create: `src/components/setup/ui/LangSelect.tsx`, `src/components/setup/ui/ThemeToggle.tsx`
- Test: `src/components/setup/ui/LangSelect.test.tsx`, `src/components/setup/ui/ThemeToggle.test.tsx`

- [ ] **Step 1: `LangSelect.tsx`** — extensible language dropdown (header). Pulls languages from `SUPPORTED_LANGS` + i18n labels.

```tsx
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGS, LANG_COOKIE } from '@/i18n/i18n'
import { IconGlobe } from './icons'

export function LangSelect() {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage ?? SUPPORTED_LANGS[0]
  const setLang = (lng: string) => {
    void i18n.changeLanguage(lng)
    if (typeof document !== 'undefined') {
      const secure =
        typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${LANG_COOKIE}=${lng}; path=/; max-age=31536000; SameSite=Lax${secure}`
    }
  }
  return (
    <div className="lang-select">
      <IconGlobe size={13} style={{ opacity: 0.65 }} />
      <select className="lang-select-el" value={current} aria-label={t('wizard.welcome.language')}
        onChange={(e) => setLang(e.target.value)}>
        {SUPPORTED_LANGS.map((l) => (
          <option key={l} value={l}>{t(`wizard.langs.${l}`)}</option>
        ))}
      </select>
      <svg className="lang-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
}
```

> This is the single source of language switching (the WelcomeStep selector is removed in Task 8). The cookie-write logic is moved here verbatim from the current `WelcomeStep.tsx`.

- [ ] **Step 2: `ThemeToggle.tsx`** — controlled sun/moon button.

```tsx
import { useTranslation } from 'react-i18next'
import { THEME_COOKIE, type Theme } from '@/server/setup-theme'
import { IconSun, IconMoon } from './icons'

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const { t } = useTranslation()
  const dark = theme === 'dark'
  const title = dark ? t('wizard.theme.toLight') : t('wizard.theme.toDark')
  const toggle = () => {
    const next: Theme = dark ? 'light' : 'dark'
    onChange(next)
    if (typeof document !== 'undefined') {
      const secure =
        typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax${secure}`
    }
  }
  return (
    <button type="button" className="theme-toggle" onClick={toggle}
      title={title} aria-label={title} aria-pressed={dark}>
      {dark ? <IconMoon size={15} /> : <IconSun size={15} />}
    </button>
  )
}
```

> Importing the `THEME_COOKIE` *constant* and `Theme` *type* from `setup-theme.ts` is safe — they are not the server-fn handler, so no server-only code leaks to the client. (Do **not** import `getServerTheme` here.)

- [ ] **Step 3: Tests**

`LangSelect.test.tsx` — render inside an `I18nextProvider` (use `createI18n('fr')`), assert the `<select>` lists FR/EN labels and that changing it calls `i18n.changeLanguage` (spy) / writes the cookie (`document.cookie`).

`ThemeToggle.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { ThemeToggle } from './ThemeToggle'

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('en')}>{ui}</I18nextProvider>)
}

describe('ThemeToggle', () => {
  it('toggles light → dark', () => {
    const onChange = vi.fn()
    wrap(<ThemeToggle theme="light" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenCalledWith('dark')
  })
  it('reflects pressed state in dark', () => {
    wrap(<ThemeToggle theme="dark" onChange={() => {}} />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })
})
```

- [ ] **Step 4: Run tests** — green.

- [ ] **Step 5: Commit**

```bash
git add src/components/setup/ui/LangSelect.tsx src/components/setup/ui/ThemeToggle.tsx \
  src/components/setup/ui/LangSelect.test.tsx src/components/setup/ui/ThemeToggle.test.tsx
git commit -m "feat(wizard): header language selector + theme toggle"
```

---

## Task 8: WelcomeStep re-skin

**Files:**
- Modify: `src/components/setup/steps/WelcomeStep.tsx`
- Test: `src/components/setup/steps/WelcomeStep.test.tsx` (create/replace)

Props unchanged: `{ onNext: () => void }`. **Remove** the in-step language selector (now in the header) and the `LANG_COOKIE`/`SUPPORTED_LANGS` imports.

- [ ] **Step 1: Rewrite** using `BrandMark`, `StepHeader`, `Button`, `IconGlobe`, `IconServer`, `IconArrowR` (port `StepWelcome` from `steps-collect.jsx`):

```tsx
import { useTranslation } from 'react-i18next'
import { BrandMark, StepHeader, Button } from '../ui/primitives'
import { IconGlobe, IconServer, IconArrowR } from '../ui/icons'

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="step-body step-welcome">
      <BrandMark size={52} />
      <StepHeader title={t('wizard.welcome.title')} sub={t('wizard.welcome.subtitle')} />
      <div className="need-box">
        <p className="need-title">{t('wizard.welcome.needTitle')}</p>
        <p className="need-item"><IconGlobe size={14} />{t('wizard.welcome.need1')}</p>
        <p className="need-item"><IconServer size={14} />{t('wizard.welcome.need2')}</p>
      </div>
      <Button variant="primary" size="lg" onClick={onNext}>
        {t('wizard.welcome.start')}<IconArrowR size={16} />
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Test** — render inside `I18nextProvider`, assert the title and a `need-item` render, and that clicking the start button calls `onNext`.

- [ ] **Step 3: Run tests** — green. (The old WelcomeStep test, if it asserted on the FR/EN toggle buttons, must be updated — those buttons are gone.)

- [ ] **Step 4: Commit** — `refactor(wizard): re-skin WelcomeStep, drop in-step lang selector`.

---

## Task 9: DomainStep re-skin + external-zone warning

**Files:**
- Modify: `src/components/setup/steps/DomainStep.tsx`
- Test: `src/components/setup/steps/DomainStep.test.tsx`

Props unchanged: `{ defaults, onNext, onBack }`. Keep TanStack Form + `domainSchema`. Add the external-zone warning (pure client). **Do not** add a live A-record check (that was simulated in the prototype; no backend for it pre-bootstrap).

- [ ] **Step 1: Rewrite** with `Field`, `TextInput`, `StepHeader`, `StepNav`, `Alert`. Helper (port from `steps-collect.jsx`):

```ts
function isExternalHost(hostname: string, domain: string) {
  if (!hostname || !domain) return false
  return hostname !== domain && !hostname.endsWith('.' + domain)
}
function hostZone(hostname: string) {
  const parts = (hostname || '').split('.')
  return parts.length > 2 ? parts.slice(1).join('.') : hostname
}
```

Field wiring (keep `form.Field` + `FieldError`, but render label/help/error via the `Field` primitive — pass `error={!field.state.meta.isValid ? t('wizard.domain.invalidHostname') : undefined}`). Use `form.Subscribe` to read both values for the warning:

```tsx
<form.Subscribe selector={(s) => s.values} children={(v) =>
  isExternalHost(v.serverHostname, v.defaultDomain) ? (
    <Alert variant="warning" title={t('wizard.domain.extTitle')}>
      {t('wizard.domain.ext', { host: v.serverHostname, zone: hostZone(v.serverHostname), domain: v.defaultDomain })}
    </Alert>
  ) : null
} />
```

Domain field help uses interpolation: `t('wizard.domain.domainHelp', { domain: form value || 'exemple.fr' })`. Hostname uses `mono`. Submit via `StepNav onNext={() => void form.handleSubmit()} onBack={onBack}` with `backLabel={t('wizard.common.back')}` / `nextLabel={t('wizard.common.next')}`.

- [ ] **Step 2: Test** — assert: invalid hostname shows `invalidHostname` on submit; valid `mail.autre.fr` + `dupont.fr` shows the external-zone warning (`extTitle`); valid same-zone values call `onNext` with the values.

- [ ] **Step 3: Run tests** — green.

- [ ] **Step 4: Commit** — `refactor(wizard): re-skin DomainStep + external-zone warning`.

---

## Task 10: DnsProviderStep — Combobox + sticky Manual

**Files:**
- Modify: `src/components/setup/steps/DnsProviderStep.tsx`
- Test: `src/components/setup/steps/DnsProviderStep.test.tsx`

Props unchanged: `{ defaults, onNext, onBack }`. Keep TanStack Form + `dnsProviderSchema`. `DNS_PROVIDERS` (from `@/server/stalwart-dns`) includes `'Manual'`.

- [ ] **Step 1: Rewrite** — provider field is the `Combobox`; options = `DNS_PROVIDERS.filter((p) => p !== 'Manual')`; `stickyOption = { value: 'Manual', label: t('wizard.dns.manual'), hint: t('wizard.dns.manualHint') }`. On change set provider and clear secret. When a non-Manual provider is selected, show the secret `Field` (`TextInput type="password" mono`) with help `t('wizard.dns.secretHelp', { domain })` — read `domain` from `defaults.defaultDomain` (add it to the destructured defaults type as optional, or accept it via the existing `defaults` which already carries it through `WizardData`). When Manual, show an info `Alert` with `t('wizard.dns.manualNote')`.

  Initial value: keep `defaults.provider ?? 'Manual'`. Validation errors map to `t('wizard.dns.required')` (provider) / `t('wizard.dns.secretRequired')` (secret).

- [ ] **Step 2: Test** — assert: opening the combobox and picking `Cloudflare` reveals the secret field; picking Manual hides the secret and shows the manual note; submitting Manual calls `onNext` with `provider: 'Manual'`.

- [ ] **Step 3: Run tests** — green.

- [ ] **Step 4: Commit** — `refactor(wizard): DnsProviderStep combobox + manual option`.

---

## Task 11: AdminAccountStep re-skin

**Files:**
- Modify: `src/components/setup/steps/AdminAccountStep.tsx`
- Test: `src/components/setup/steps/AdminAccountStep.test.tsx`

Props unchanged: `{ defaults, domain, onNext, onBack }`. Keep TanStack Form + `adminAccountSchema`.

- [ ] **Step 1: Rewrite** with `Field`, `TextInput` (name, mono, autofocus, placeholder `t('wizard.account.namePlaceholder')`), derived email help `t('wizard.account.email', { email: `${name.trim() || 'admin'}@${domain}` })`, `PasswordInput` (showLabel/hideLabel from i18n), and `StrengthMeter` below the password field:

```tsx
<form.Field name="password" children={(field) => (
  <>
    <Field label={t('wizard.account.password')} htmlFor={field.name} help={t('wizard.account.passwordHelp')}
      error={!field.state.meta.isValid ? t('wizard.account.invalidPassword') : undefined}>
      <PasswordInput id={field.name} value={field.state.value}
        showLabel={t('wizard.account.show')} hideLabel={t('wizard.account.hide')}
        onChange={(v) => field.handleChange(v)} />
    </Field>
    <StrengthMeter password={field.state.value}
      label={t(`wizard.account.strength.${scorePassword(field.state.value)}`)} />
  </>
)} />
```

Name error → `t('wizard.account.invalidName')`. Submit via `StepNav`.

- [ ] **Step 2: Test** — assert: derived email reflects typed name; password < 8 shows `invalidPassword` on submit; strength label updates; valid input calls `onNext`.

- [ ] **Step 3: Run tests** — green.

- [ ] **Step 4: Commit** — `refactor(wizard): re-skin AdminAccountStep + strength meter`.

---

## Task 12: RecapStep — editable rows + inline error

**Files:**
- Modify: `src/components/setup/steps/RecapStep.tsx`, `src/components/setup/SetupWizard.tsx` (pass `goTo`)
- Test: `src/components/setup/steps/RecapStep.test.tsx`

This task touches both RecapStep (new `goTo` prop) and its single caller in `SetupWizard.tsx`, in one commit, to stay green.

- [ ] **Step 1: Rewrite RecapStep** — new prop `goTo: (screen: 'domain' | 'dns' | 'account') => void`. Render `.recap` with rows (label / value / `.recap-edit` → `goTo`). Rows:

```ts
const isManual = data.provider === 'Manual'
const rows = [
  { label: t('wizard.recap.hostname'), value: data.serverHostname, mono: true, to: 'domain' },
  { label: t('wizard.recap.domain'), value: data.defaultDomain, mono: true, to: 'domain' },
  { label: t('wizard.recap.dns'), value: isManual ? t('wizard.recap.dnsManual') : t('wizard.recap.dnsAuto', { provider: data.provider }), to: 'dns' },
  { label: t('wizard.recap.account'), value: `${data.name ?? ''}@${data.defaultDomain ?? ''}`, mono: true, to: 'account' },
] as const
```

Keep the existing submit/busy/error logic, but render the error as an `Alert variant="destructive"` with a `Retry` action, and the note as `.help` + `IconInfo`. Submit button via `StepNav` (`nextLabel={t('wizard.recap.submit')}`, `busy` state).

- [ ] **Step 2: Wire `goTo` in `SetupWizard.tsx`** — pass `goTo={(screen) => setScreen(screen)}` to `<RecapStep>` (the screen union already includes `'domain' | 'dns' | 'account'`).

- [ ] **Step 3: Test** — assert: rows render values; clicking "Edit" on the DNS row calls `goTo('dns')`; submit calls `onSubmit`; a rejected `onSubmit` renders the error alert + a working Retry.

- [ ] **Step 4: Run tests** — green.

- [ ] **Step 5: Commit** — `refactor(wizard): editable recap rows + inline error`.

---

## Task 13: RestartScreen re-skin

**Files:**
- Modify: `src/components/setup/RestartScreen.tsx`
- Test: `src/components/setup/RestartScreen.test.tsx`

Keep the **real** poll loop, interval, soft timeout, and `onReady(step)` contract exactly as today (read the current file). Only change presentation + add a visible poll log.

- [ ] **Step 1: Rewrite the render** to the design's `.step-restart`: `.restart-spinner` (`Spinner size={28}`), `StepHeader` (`restart.title` / `restart.subtitle`; on timeout swap subtitle to `restart.timeout` and add a Retry `Button` that re-arms the loop — e.g. by bumping a `key`/attempt state), an indeterminate `Progress`, and a `.poll-log` showing the last ~4 attempts:

```tsx
// maintain a counter of poll attempts in state; push a line per tick
<div className="poll-log mono" aria-live="polite">
  {lines.slice(-4).map((l) => (
    <p key={l.n} className={'poll-line' + (l.ready ? ' poll-line-ok' : '')}>
      {t('wizard.restart.poll', { n: l.n })} → {l.ready ? t('wizard.restart.ready') : t('wizard.restart.restarting')}
    </p>
  ))}
</div>
```

Increment the attempt counter inside the existing `tick()` (before/after each `poll()`), and mark the final line `ready` when `step !== 'collect'`.

- [ ] **Step 2: Test** — keep/adapt the existing test: a `poll` that returns `{ step: 'collect' }` then `{ step: 'account' }` eventually calls `onReady('account')`; a timeout path renders the timeout subtitle + Retry. Use fake timers as the current test does (check the existing test first).

- [ ] **Step 3: Run tests** — green.

- [ ] **Step 4: Commit** — `refactor(wizard): re-skin RestartScreen with poll log`.

---

## Task 14: SetupWizard shell + route wiring

**Files:**
- Modify: `src/components/setup/SetupWizard.tsx`, `src/routes/setup/index.tsx`
- Delete: `src/components/setup/Stepper.tsx`
- Test: `src/components/setup/SetupWizard.test.tsx`

- [ ] **Step 1: Rewrite `SetupWizard.tsx`** — add `initialTheme: Theme` to `Props`. Hold `theme` in state (seeded from `initialTheme`). Render the card shell (port `ShellCard` from `app.jsx`), wrapping everything in the scoped root:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brand } from './ui/primitives'
import { LangSelect } from './ui/LangSelect'
import { ThemeToggle } from './ui/ThemeToggle'
import { StepperH } from './ui/StepperH'
import type { Theme } from '@/server/setup-theme'
// …existing step imports, minus Stepper…
import './wizard.css'
```

Shell structure:

```tsx
<div className="stalmail-wizard" data-theme={theme}>
  <div className="shell shell-card">
    <div className="shell-card-col">
      <div className="shell-card-top">
        <Brand size={24} />
        <div className="shell-top-actions">
          <LangSelect />
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
      </div>
      <StepperH steps={steps} current={current} groupLabels={{ config: t('wizard.groups.config'), activation: t('wizard.groups.activation') }} />
      <div className="card shell-card-main">
        <div key={screen} className="step-anim">{content}</div>
      </div>
      <p className="shell-caption">{caption}</p>
    </div>
  </div>
</div>
```

Steps array (9, only 1–5 reachable):

```ts
const steps = [
  { n: 1, label: t('wizard.steps.welcome'), group: 'config' as const },
  { n: 2, label: t('wizard.steps.domain'), group: 'config' as const },
  { n: 3, label: t('wizard.steps.dnsProvider'), group: 'config' as const },
  { n: 4, label: t('wizard.steps.admin'), group: 'config' as const },
  { n: 5, label: t('wizard.steps.recap'), group: 'config' as const },
  { n: 6, label: t('wizard.steps.account'), group: 'activation' as const },
  { n: 7, label: t('wizard.steps.dnsRecords'), group: 'activation' as const },
  { n: 8, label: t('wizard.steps.ssl'), group: 'activation' as const },
  { n: 9, label: t('wizard.steps.done'), group: 'activation' as const },
]
```

Map `screen` → `current`: welcome=1, domain=2, dns=3, account=4, recap=5, restarting=6. `caption = t('wizard.common.stepOf', { n: current <= 5 ? current : 6 })` (or the activation group label during restart — keep it simple: show `stepOf` for collect, group label for restart). Keep the existing monitoring placeholder (`monitorStep`) branch but render it inside the same scoped shell. `content` is the existing `switch(screen)`; pass `goTo` to RecapStep as in Task 12.

- [ ] **Step 2: Wire the route** `src/routes/setup/index.tsx`:

```tsx
import { getStep, submitBootstrapFn } from '@/server/setup-actions'
import { getServerTheme } from '@/server/setup-theme'
// …
export const Route = createFileRoute('/setup/')({
  loader: async () => {
    const [{ step }, { theme }] = await Promise.all([getStep(), getServerTheme()])
    return { step, theme }
  },
  component: SetupPage,
  errorComponent: SetupError,
})

function SetupPage() {
  const { step, theme } = Route.useLoaderData()
  return (
    <SetupWizard
      initialStep={step}
      initialTheme={theme}
      submitBootstrap={(data) => submitBootstrapFn({ data }).then(() => undefined)}
      pollStep={() => getStep()}
    />
  )
}
```

Drop the old `<main className="… bg-muted/30 …">` wrapper (the `.stalmail-wizard` root now owns the full-viewport background). Keep `SetupError` (it can stay shadcn-styled, or wrap it in `.stalmail-wizard` for consistency — optional).

- [ ] **Step 3: Delete `Stepper.tsx`** and remove its import.

- [ ] **Step 4: Update `SetupWizard.test.tsx`** — render with `initialStep="collect"` + `initialTheme="light"` inside `I18nextProvider`; assert the welcome screen renders, the stepper shows 9 dots, the header has the lang select + theme toggle, and advancing works (the existing test's flow, adjusted to new markup). Add: `data-theme` flips when the theme toggle is clicked.

- [ ] **Step 5: Full gate** — `bun run test`, `bun run typecheck`, `bun run build` all green.

- [ ] **Step 6: Commit** — `feat(wizard): card shell with header, stepper, theme; wire route`.

---

## Task 15: Cleanup & full suite

**Files:** `src/i18n/resources.ts` (+ any leftover references)

- [ ] **Step 1: Remove orphaned legacy i18n keys** now that all steps are migrated: `wizard.welcome.language` (still used by `LangSelect` as the select's aria-label → KEEP if referenced; otherwise remove), `wizard.domain.hostnameHint`, `wizard.domain.domainHint`, `wizard.domain.dnsWarning`, `wizard.dns.secretHint`. Grep first:

```bash
grep -rn "hostnameHint\|domainHint\|dnsWarning\|dns.secretHint\|welcome.language" src/
```
Remove only keys with zero remaining references (update both `fr` and `en`). Re-run the parity test.

- [ ] **Step 2: Grep for dead imports / the old Stepper** — ensure `Stepper` and any removed key are gone:

```bash
grep -rn "components/setup/Stepper'" src/ ; grep -rn "from './Stepper'" src/
```

- [ ] **Step 3: Full suite** — `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` all green. Note the test count (was 113 before this plan; expect it higher).

- [ ] **Step 4: Commit** — `chore(wizard): remove legacy i18n keys and dead Stepper`.

---

## Task 16: Live verification

- [ ] **Step 1:** Confirm the dev stack is up (`docker compose -f compose.dev.yml ps`); if needed, recreate so the `app` container reloads (`docker compose -f compose.dev.yml up -d`). Vite HMR picks up changes from the bind mount.

- [ ] **Step 2:** Open `https://localhost/setup` and walk the full collect flow in both FR and EN, light and dark:
  - Header language selector switches strings live; theme toggle flips light/dark and persists across reload (cookie).
  - Welcome → need-box + Start. Domain → validation + external-zone warning for `mail.autre.fr` / `dupont.fr`. DNS → combobox search, sticky Manual, secret field for a real provider. Admin → derived email + strength meter. Recap → editable rows (Edit jumps back) → Configure → restart screen with poll log → reaches monitoring placeholder.
  - Verify visual fidelity against the prototype (`docs/design/wizard-handoff/project/Stalmail Setup Wizard.html`): card centering, accent blue, Geist fonts, stepper dots, spacing.

- [ ] **Step 3:** Report findings. Fix any visual gaps as small follow-up commits (re-run the gate each time).

- [ ] **Step 4:** Dispatch a final whole-branch code review; then use **superpowers:finishing-a-development-branch** to open the PR.

---

## Self-Review notes (author)

- **Spec coverage:** Welcome/Domain/DNS/Admin/Recap re-skinned (Tasks 8–12), restart screen (13), shell + header lang/theme + grouped stepper (14), design tokens/fonts/CSS (1), i18n full set (2), theme SSR (3), all primitives incl. Combobox/StrengthMeter (4–7). External-zone warning covered (9). Out-of-scope monitoring is explicitly deferred and represented as inert stepper dots — matches the chosen scope.
- **Type consistency:** `Theme` from `setup-theme.ts` used by `ThemeToggle` + `SetupWizard` + route loader. `scorePassword` (`weak|medium|strong`) reused unchanged; `StrengthMeter` maps it to 4 bars. `DNS_PROVIDERS` includes `'Manual'`; Combobox sticky value `'Manual'` matches the schema enum. Step prop contracts unchanged except RecapStep `goTo` (added on both sides in Task 12).
- **No live A-record check:** intentionally omitted (prototype-only simulation, no pre-bootstrap backend) — only the pure-client external-zone warning is kept.
- **Green intermediate commits:** i18n is additive (Task 2) with legacy keys retained until Task 15; steps keep stable external props; the only cross-file coordinated change (RecapStep `goTo`) lands in one task.
