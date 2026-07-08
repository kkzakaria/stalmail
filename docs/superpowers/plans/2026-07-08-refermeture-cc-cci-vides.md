# Refermeture des rangées Cc/Cci vides — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans les deux composeurs, une rangée Cc/Cci révélée mais vide (ou espaces seuls) se referme quand son champ perd le focus — le bouton bascule réapparaît.

**Architecture:** Spec `docs/superpowers/specs/2026-07-08-refermeture-cc-cci-vides-design.md`. Quatre handlers `onBlur` d'une ligne, symétriques : deux dans `composer.tsx` (`#cmp-cc`/`#cmp-bcc`), deux dans `quick-reply.tsx` (`#qr-cc`/`#qr-bcc`). Visibilité uniquement — aucune valeur modifiée, aucun changement CSS/i18n/hook/serveur.

**Tech Stack:** React 19, vitest + @testing-library/react (`fireEvent.blur`), Bun.

## Global Constraints

- Bun uniquement (`bun run test -- <fichier>`, `bun run typecheck`) ; pre-commit lint+typecheck+tests, jamais de `--no-verify`. Flaky connus : `login.test.tsx` « navigates to the inbox », `DnsStep` « auto path » — relancer en isolation avant de conclure à une régression.
- Commits conventionnels en anglais, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- « Vide » = `value.trim() === ""` ; le handler ne modifie JAMAIS `draft.cc`/`draft.bcc` (visibilité seulement).
- Comportements d'ouverture inchangés : bascules, `showCc = initial.cc !== ""` du grand Composer, reset `draftKey` de la réponse rapide.
- Branche : `fix/composer-empty-cc-collapse` (existante, contient la spec).

---

### Task 1: Grand Composer — refermeture au blur

**Files:**

- Modify: `src/components/mail/composer.tsx` (inputs `#cmp-cc` ~l.106 et `#cmp-bcc` ~l.117)
- Test: `src/components/mail/composer.test.tsx`

**Interfaces:**

- Consumes: état interne existant du Composer (`draft`, `set`, `showCc`/`setShowCc`, `showBcc`/`setShowBcc`), fixture `initial` du fichier de test (mock i18n identité, requêtes `getByRole("textbox"/"button", { name: "mail.compose.cc" })`).
- Produces: comportement de refermeture — rien d'exporté.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/components/mail/composer.test.tsx`, après le test des bascules indépendantes :

```tsx
it("referme la rangée Cc vide au blur (bouton bascule de retour)", () => {
  render(
    <Composer initial={initial} sending={false} onSend={() => {}} onClose={() => {}} />
  )
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
  const cc = screen.getByRole("textbox", { name: "mail.compose.cc" })
  fireEvent.blur(cc)
  expect(screen.queryByRole("textbox", { name: "mail.compose.cc" })).toBeNull()
  expect(
    screen.getByRole("button", { name: "mail.compose.cc" })
  ).toBeInTheDocument()
})

it("garde la rangée Cc ouverte au blur quand elle a une valeur", () => {
  render(
    <Composer initial={initial} sending={false} onSend={() => {}} onClose={() => {}} />
  )
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
  const cc = screen.getByRole("textbox", { name: "mail.compose.cc" })
  fireEvent.change(cc, { target: { value: "bob@x.fr" } })
  fireEvent.blur(cc)
  expect(
    screen.getByRole("textbox", { name: "mail.compose.cc" })
  ).toHaveValue("bob@x.fr")
})

it("referme la rangée Cci au blur avec des espaces seuls", () => {
  render(
    <Composer initial={initial} sending={false} onSend={() => {}} onClose={() => {}} />
  )
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
  const bcc = screen.getByRole("textbox", { name: "mail.compose.bcc" })
  fireEvent.change(bcc, { target: { value: "   " } })
  fireEvent.blur(bcc)
  expect(screen.queryByRole("textbox", { name: "mail.compose.bcc" })).toBeNull()
})

it("referme la rangée Cc pré-remplie (replyAll) une fois vidée puis quittée", () => {
  render(
    <Composer
      initial={{ ...initial, mode: "replyAll", cc: "bob@x.fr" }}
      sending={false}
      onSend={() => {}}
      onClose={() => {}}
    />
  )
  const cc = screen.getByRole("textbox", { name: "mail.compose.cc" }) // ouverte d'emblée
  fireEvent.change(cc, { target: { value: "" } })
  fireEvent.blur(cc)
  expect(screen.queryByRole("textbox", { name: "mail.compose.cc" })).toBeNull()
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/components/mail/composer.test.tsx`
Expected: FAIL — les rangées restent ouvertes au blur (3 des 4 tests échouent ; celui « garde la valeur » passe déjà).

- [ ] **Step 3: Implémentation**

Dans `src/components/mail/composer.tsx`, sur l'input `#cmp-cc`, ajouter après `onChange` :

```tsx
                // Rangée vide quittée → retour à la bascule (retour prod v0.1.47).
                onBlur={() => {
                  if (draft.cc.trim() === "") setShowCc(false)
                }}
```

Et sur l'input `#cmp-bcc` :

```tsx
                onBlur={() => {
                  if (draft.bcc.trim() === "") setShowBcc(false)
                }}
```

(le commentaire une seule fois, sur le premier ; ne rien changer d'autre).

- [ ] **Step 4: Vérifier que tout passe**

Run: `bun run test -- src/components/mail/composer.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/composer.tsx src/components/mail/composer.test.tsx
git commit -m "fix(composer): collapse empty Cc/Bcc rows on blur"
```

---

### Task 2: Réponse rapide — refermeture au blur + vérification finale

**Files:**

- Modify: `src/components/mail/quick-reply.tsx` (inputs `#qr-cc` et `#qr-bcc`)
- Test: `src/components/mail/quick-reply.test.tsx`

**Interfaces:**

- Consumes: états `showCc`/`setShowCc`, `showBcc`/`setShowBcc` existants du composant ; harnais `ForwardHarness` du fichier de test (bouton « fwd A » qui ouvre un brouillon forward), mock i18n identité.
- Produces: comportement de refermeture — rien d'exporté.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/components/mail/quick-reply.test.tsx`, près des tests de bascules forward :

```tsx
it("forward : referme la rangée Cc vide au blur (bascule de retour)", () => {
  render(<ForwardHarness detail={detail} />)
  fireEvent.click(screen.getByText("fwd A"))
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
  fireEvent.blur(screen.getByLabelText("mail.compose.cc"))
  expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: "mail.compose.cc" })
  ).toBeInTheDocument()
})

it("forward : garde la rangée Cci ouverte au blur quand elle a une valeur", () => {
  render(<ForwardHarness detail={detail} />)
  fireEvent.click(screen.getByText("fwd A"))
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
  const bcc = screen.getByLabelText<HTMLInputElement>("mail.compose.bcc")
  fireEvent.change(bcc, { target: { value: "bob@x.fr" } })
  fireEvent.blur(bcc)
  expect(screen.getByLabelText<HTMLInputElement>("mail.compose.bcc").value).toBe(
    "bob@x.fr"
  )
})

it("forward : referme la rangée Cc au blur avec des espaces seuls", () => {
  render(<ForwardHarness detail={detail} />)
  fireEvent.click(screen.getByText("fwd A"))
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
  const cc = screen.getByLabelText<HTMLInputElement>("mail.compose.cc")
  fireEvent.change(cc, { target: { value: "  " } })
  fireEvent.blur(cc)
  expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
})
```

(Adapter les noms `ForwardHarness`/`detail`/« fwd A » aux fixtures réelles du fichier.)

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/components/mail/quick-reply.test.tsx`
Expected: FAIL — les rangées restent ouvertes au blur (2 des 3 échouent).

- [ ] **Step 3: Implémentation**

Dans `src/components/mail/quick-reply.tsx`, sur l'input `#qr-cc`, ajouter après `onChange` :

```tsx
            // Rangée vide quittée → retour à la bascule (retour prod v0.1.47).
            onBlur={() => {
              if (draft.cc.trim() === "") setShowCc(false)
            }}
```

Et sur l'input `#qr-bcc` :

```tsx
            onBlur={() => {
              if (draft.bcc.trim() === "") setShowBcc(false)
            }}
```

- [ ] **Step 4: Vérifier que tout passe + suite complète**

Run: `bun run test -- src/components/mail/quick-reply.test.tsx && bun run lint && bun run typecheck && bun run test`
Expected: PASS intégral (dont non-régression bascules indépendantes, garde forward, reset draftKey).

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/quick-reply.tsx src/components/mail/quick-reply.test.tsx
git commit -m "fix(reader): collapse empty Cc/Bcc rows on blur in quick reply"
```

---

## Auto-revue du plan

- **Couverture spec** : déclencheur blur (Steps 3 des deux tâches), vide = trim (les 2 handlers), espaces seuls testés (les 2 tâches), valeurs jamais modifiées (handlers visibilité seule), Cc pré-rempli replyAll vidé → refermé (Task 1 test 4), les deux composeurs couverts, comportements d'ouverture intacts (aucune ligne d'ouverture touchée). Effet de bord « ouvrir Cci referme Cc vide » : découle mécaniquement du blur, pas de test dédié (le test « blur vide → refermé » le couvre).
- **Placeholders** : aucun.
- **Cohérence** : mêmes noms d'états que les composants réels (`showCc`/`showBcc`, `draft.cc`/`draft.bcc`).
- **Passe visuelle** : comportement entièrement couvert par les tests composants ; un contrôle rapide en dev avant PR reste conseillé (10 secondes : ouvrir Cc, cliquer dans l'éditeur, voir la rangée se refermer) — rappel : `docker compose -f compose.dev.yml restart app` après checkout.
