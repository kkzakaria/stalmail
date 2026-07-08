# Champs destinataires de la réponse rapide — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le champ destinataire de la réponse rapide clairement identifiable (label « À » + champ bordé, trois modes) et ajouter les bascules/rangées Cc et Cci en mode transfert uniquement.

**Architecture:** Spec `docs/superpowers/specs/2026-07-08-destinataires-reponse-rapide-design.md`. Chantier purement UI dans `quick-reply.tsx` (composant présentationnel) + `mail.css` : aucun changement au hook `useQuickReplyDraft`, à `ComposerDraft` ni à la chaîne d'envoi — `draft.cc`/`draft.bcc` existent et sont déjà parsés (`parseAddressList`) et validés (`sendMailSchema`). Les bascules Cc/Cci reprennent le pattern du grand Composer (`composer.tsx:19-125`) ; l'input À stylé reprend les tokens du pattern `.dc-field` (`mail.css:342-348`).

**Tech Stack:** React 19, vitest + @testing-library/react (harnais hook+composant existant), CSS vanilla, Bun.

## Global Constraints

- Bun uniquement (`bun run test -- <fichier>`, `bun run typecheck`) ; pre-commit lint+typecheck+tests, jamais de `--no-verify`. Flaky connus sensibles à la charge : `login.test.tsx` « navigates to the inbox », `DnsStep` « auto path » — relancer en isolation avant de conclure à une régression.
- Commits conventionnels en anglais, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- i18n : clés EXISTANTES uniquement — `mail.compose.to` (« À »), `mail.compose.cc` (« Cc »), `mail.compose.bcc` (« Cci »). Aucune nouvelle clé.
- Cc/Cci : **mode forward uniquement** (décision utilisateur) ; reply/replyAll gardent l'en-tête sans bascules. Le `cc` pré-rempli de replyAll reste envoyé sans affichage (comportement actuel, assumé par la spec).
- Cci jamais pré-rempli ; bascules réinitialisées quand le brouillon se ferme.
- Aucun changement à `use-quick-reply-draft.ts`, `use-composer.ts`, `composer.tsx`, ni au serveur.
- Branche : `feat/quick-reply-recipients` (existante, contient la spec).

---

### Task 1: Champ À identifiable (label + input stylé, trois modes)

**Files:**

- Modify: `src/components/mail/quick-reply.tsx:70-89` (bloc `qr-head`)
- Modify: `src/components/mail/mail.css:779-781` (règles `.qr-to`)
- Test: `src/components/mail/quick-reply.test.tsx`

**Interfaces:**

- Consumes: `QuickReplyProps` existant (inchangé), clé i18n `mail.compose.to`, tokens CSS `--surface-2`/`--line`/`--accent`.
- Produces: input `#qr-to` relié à un `<label>` visible — l'accessible name vient du label (l'`aria-label` redondant disparaît). Les tests existants qui font `getByLabelText("mail.compose.to")` continuent de fonctionner (le mock i18n rend les clés brutes).

- [ ] **Step 1: Écrire le test qui échoue**

Dans `src/components/mail/quick-reply.test.tsx` (harnais `Harness` existant, mock i18n identité), ajouter :

```tsx
it("le champ À porte un label visible relié (trois modes)", () => {
  render(<Harness detail={detail} onSend={() => {}} />)
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.reply" }))
  const input = screen.getByLabelText("mail.compose.to")
  expect(input).toBeInstanceOf(HTMLInputElement)
  // le label est un élément <label> rendu (pas un aria-label invisible)
  expect(
    document.querySelector('label[for="qr-to"]')?.textContent
  ).toBe("mail.compose.to")
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/components/mail/quick-reply.test.tsx`
Expected: FAIL — pas de `<label for="qr-to">` (le nom accessible vient d'un `aria-label`).

- [ ] **Step 3: Implémentation markup**

Dans `src/components/mail/quick-reply.tsx`, remplacer le bloc input de l'en-tête (l.74-79) :

```tsx
        <label className="qr-label" htmlFor="qr-to">
          {t("mail.compose.to")}
        </label>
        <input
          id="qr-to"
          className="qr-to"
          value={draft.to}
          onChange={(e) => onPatch({ to: e.target.value })}
        />
```

(l'`aria-label` disparaît : le `<label>` relié porte le nom accessible). Mettre à jour le commentaire de l'en-tête : « mode + label À + destinataire éditable + fermer à droite ».

- [ ] **Step 4: Implémentation CSS**

Dans `src/components/mail/mail.css`, remplacer les deux règles `.qr-to` (l.779-781) :

```css
/* destinataire éditable inline dans l'en-tête — champ IDENTIFIABLE (retour prod
   v0.1.46) : label visible + fond/bordure, focus accent (convention .dc-field) */
.quick-reply .qr-label { flex: none; font-size: 12.5px; color: var(--muted); }
.quick-reply .qr-to { flex: 1; min-width: 0; font-family: inherit; font-size: 13.5px; color: var(--ink); background: var(--surface-2); border: 1px solid var(--line); border-radius: 7px; padding: 5px 10px; outline: none; }
.quick-reply .qr-to:focus { border-color: var(--accent); }
```

(l'ancienne règle `:focus-visible` à outline disparaît — remplacée par le focus par bordure accent, convention `.dc-field:focus` du fichier).

- [ ] **Step 5: Vérifier que tout passe**

Run: `bun run test -- src/components/mail/quick-reply.test.tsx && bun run typecheck`
Expected: PASS — y compris les tests existants qui requêtent le champ par `getByLabelText`/aria (le label relié fournit le même nom accessible).

- [ ] **Step 6: Commit**

```bash
git add src/components/mail/quick-reply.tsx src/components/mail/quick-reply.test.tsx src/components/mail/mail.css
git commit -m "feat(reader): visible labelled To field in quick-reply header"
```

---

### Task 2: Bascules et rangées Cc/Cci en mode transfert

**Files:**

- Modify: `src/components/mail/quick-reply.tsx` (imports, états locaux, en-tête, rangées après `qr-head`)
- Modify: `src/components/mail/mail.css` (règles `.qr-field`, après le bloc `.qr-to`)
- Test: `src/components/mail/quick-reply.test.tsx`

**Interfaces:**

- Consumes: Task 1 livrée (`.qr-label`/`#qr-to` en place) ; `ForwardHarness` existant du fichier de test (ouvre un brouillon forward via `useQuickReplyDraft.openForward`) ; clés `mail.compose.cc`/`mail.compose.bcc` ; `onPatch({ cc })`/`onPatch({ bcc })` du contrat `QuickReplyProps` existant.
- Produces: inputs `#qr-cc`/`#qr-bcc` avec labels reliés, rendus uniquement en forward quand leur bascule est active.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `src/components/mail/quick-reply.test.tsx` :

```tsx
it("forward : la bascule Cc révèle une rangée reliée et la saisie patch draft.cc", () => {
  render(<ForwardHarness detail={detail} />)
  fireEvent.click(screen.getByText("fwd"))
  // bascules visibles, rangées absentes
  expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
  // la rangée apparaît, le bouton bascule disparaît
  const cc = screen.getByLabelText("mail.compose.cc")
  expect(
    screen.queryByRole("button", { name: "mail.compose.cc" })
  ).not.toBeInTheDocument()
  fireEvent.change(cc, { target: { value: "bob@x.fr" } })
  expect((screen.getByLabelText("mail.compose.cc") as HTMLInputElement).value).toBe(
    "bob@x.fr"
  )
})

it("forward : la bascule Cci révèle sa rangée (indépendante de Cc)", () => {
  render(<ForwardHarness detail={detail} />)
  fireEvent.click(screen.getByText("fwd"))
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
  expect(screen.getByLabelText("mail.compose.bcc")).toBeInTheDocument()
  expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
})

it("reply et replyAll : aucune bascule Cc/Cci", () => {
  render(<Harness detail={detailWithCc} onSend={() => {}} />)
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.replyAll" }))
  expect(
    screen.queryByRole("button", { name: "mail.compose.cc" })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "mail.compose.bcc" })
  ).not.toBeInTheDocument()
})

it("fermer puis rouvrir : les rangées Cc/Cci sont refermées", () => {
  render(<ForwardHarness detail={detail} />)
  fireEvent.click(screen.getByText("fwd"))
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
  expect(screen.getByLabelText("mail.compose.cc")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "mail.compose.close" }))
  fireEvent.click(screen.getByText("fwd"))
  expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: "mail.compose.cc" })
  ).toBeInTheDocument()
})
```

(Adapter les noms `Harness`/`ForwardHarness`/`detail`/`detailWithCc` aux fixtures réelles du fichier ; si `detailWithCc` n'existe plus, construire une fixture avec `cc` non vide sur le message.)

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/components/mail/quick-reply.test.tsx`
Expected: FAIL — pas de bouton `mail.compose.cc`.

- [ ] **Step 3: Implémentation**

Dans `src/components/mail/quick-reply.tsx` :

a) Imports et états (les hooks restent AVANT l'early return `if (!draft)`) :

```tsx
import { useEffect, useState } from "react"
```

```tsx
  const [showFormat, setShowFormat] = useState(false)
  // Bascules INDÉPENDANTES Cc/Cci (pattern du grand Composer), forward uniquement.
  // Réinitialisées à la fermeture du brouillon (le composant reste monté).
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  useEffect(() => {
    if (!draft) {
      setShowCc(false)
      setShowBcc(false)
    }
  }, [draft])
```

b) Dans l'en-tête, entre l'input `#qr-to` et le bouton fermer :

```tsx
        {draft.mode === "forward" && !showCc && (
          <button
            type="button"
            className="icon-btn sm"
            aria-label={t("mail.compose.cc")}
            title={t("mail.compose.cc")}
            onClick={() => setShowCc(true)}
          >
            {t("mail.compose.cc")}
          </button>
        )}
        {draft.mode === "forward" && !showBcc && (
          <button
            type="button"
            className="icon-btn sm"
            aria-label={t("mail.compose.bcc")}
            title={t("mail.compose.bcc")}
            onClick={() => setShowBcc(true)}
          >
            {t("mail.compose.bcc")}
          </button>
        )}
```

c) Immédiatement après le `</div>` de `qr-head` (avant les puces) :

```tsx
      {draft.mode === "forward" && showCc && (
        <div className="qr-field">
          <label htmlFor="qr-cc">{t("mail.compose.cc")}</label>
          <input
            id="qr-cc"
            value={draft.cc}
            onChange={(e) => onPatch({ cc: e.target.value })}
          />
        </div>
      )}
      {draft.mode === "forward" && showBcc && (
        <div className="qr-field">
          <label htmlFor="qr-bcc">{t("mail.compose.bcc")}</label>
          <input
            id="qr-bcc"
            value={draft.bcc}
            onChange={(e) => onPatch({ bcc: e.target.value })}
          />
        </div>
      )}
```

d) CSS, dans `src/components/mail/mail.css` juste après la règle `.qr-to:focus` :

```css
/* rangées Cc/Cci révélées à la demande (transfert) — pattern .composer-field */
.quick-reply .qr-field { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--line); }
.quick-reply .qr-field label { font-size: 12.5px; color: var(--muted); flex: none; }
.quick-reply .qr-field input { flex: 1; min-width: 0; border: none; background: none; outline: none; font-family: inherit; font-size: 13.5px; color: var(--ink); }
```

- [ ] **Step 4: Vérifier que tout passe**

Run: `bun run test -- src/components/mail/quick-reply.test.tsx && bun run typecheck`
Expected: PASS (nouveaux + existants — envoi, puces, barre sans Transférer).

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/quick-reply.tsx src/components/mail/quick-reply.test.tsx src/components/mail/mail.css
git commit -m "feat(reader): Cc and Bcc fields for quick-reply forward mode"
```

---

### Task 3: Vérification finale + passe visuelle

**Files:** aucun (vérification).

**Interfaces:**

- Consumes: Tasks 1-2 livrées.
- Produces: branche prête pour la passe visuelle utilisateur puis la PR.

- [ ] **Step 1: Suite complète**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS intégral (flaky connus : relancer en isolation si besoin).

- [ ] **Step 2: Passe visuelle (bloquante avant PR)**

Stack dev : `docker compose -f compose.dev.yml up -d` puis **`docker compose -f compose.dev.yml restart app`** (le Vite du conteneur ne voit pas les changements git côté hôte — inotify ne traverse pas le bind mount WSL2). Vérifier sur http://localhost:3443 :

1. Transfert : le champ À est immédiatement identifiable (label + fond/bordure), focus accent à la saisie ; boutons Cc et Cci dans l'en-tête ; chaque bascule révèle sa rangée ; envoi avec Cc/Cci vers le compte de test aboutit.
2. Répondre / Répondre à tous : champ À identifiable, PAS de boutons Cc/Cci, alignement de l'en-tête intact.
3. Fermer puis rouvrir un transfert : rangées refermées.

La PR (double revue CodeRabbit habituelle) n'est ouverte qu'après le feu vert visuel.

---

## Auto-revue du plan

- **Couverture spec** : champ À labelé + stylé trois modes (Task 1), bascules/rangées forward-only + états réinitialisés (Task 2), aucune bascule en reply/replyAll (Task 2 Step 1, test dédié), Cci jamais pré-rempli (rien ne l'alimente — aucun code ne touche au hook), aucune modif hook/draft/serveur (aucune tâche n'ouvre ces fichiers), mobile : aucun ajout requis (aucune règle quick-reply n'existe dans le bloc ≤639px — vérifié), validation à l'envoi inchangée.
- **Placeholders** : aucun.
- **Cohérence** : ids `qr-to`/`qr-cc`/`qr-bcc` et classes `.qr-label`/`.qr-field` uniques et utilisés à l'identique dans markup/CSS/tests ; `QuickReplyProps` inchangé.
- **Note d'exécution** : les tests existants utilisent peut-être `getByLabelText("mail.compose.to")` via l'ancien `aria-label` — après Task 1 le `<label>` relié fournit le même nom accessible, aucun test existant ne doit être réécrit pour ça.
