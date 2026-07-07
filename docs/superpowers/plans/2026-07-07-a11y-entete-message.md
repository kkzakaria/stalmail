# En-tête de message accessible — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le div `role="button"` de l'en-tête de message par deux vrais boutons frères (toggle de repli avec `aria-expanded` + bouton ↪ Transférer hors du toggle), sans changement visuel.

**Architecture:** Spec `docs/superpowers/specs/2026-07-07-a11y-entete-message-design.md`. Refactor localisé : `message-item.tsx` (markup), `mail.css` (le padding migre du `.msg-head` vers un nouveau `.msg-toggle` avec reset de bouton), `message-item.test.tsx` (migration du test de repli, nouveaux tests `aria-expanded` et non-imbrication). Aucun changement de comportement fonctionnel.

**Tech Stack:** React 19, vitest + @testing-library/react (pas de user-event), CSS vanilla (`mail.css`), Bun.

## Global Constraints

- Bun uniquement (`bun run test -- <fichier>`, `bun run typecheck`) ; pre-commit lint+typecheck+tests, jamais de `--no-verify`.
- Commits conventionnels en anglais, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Rendu **identique au pixel** (spec) ; seule exception d'aire cliquable assumée : la bande `padding-right` du conteneur ne toggle plus.
- Focus visible : outline accent (`--accent`), convention `.qr-to`.
- i18n : clés existantes uniquement (`mail.reader.to`, `mail.compose.forwardMessage`) — aucune nouvelle clé.
- Branche de travail : `refactor/a11y-message-header` (existante, contient la spec).
- **Écart de spec acté ici** (à documenter en Task 2) : pas de test clavier unitaire — jsdom n'implémente pas l'activation Enter/Espace native d'un `<button>` et `@testing-library/user-event` n'est pas une dépendance du projet. La garantie clavier EST le refactor (vrai bouton natif) ; la vérification clavier réelle appartient à la passe visuelle utilisateur.

---

### Task 1: Deux boutons frères dans l'en-tête (markup + CSS + tests)

**Files:**

- Modify: `src/components/mail/message-item.tsx:91-131` (bloc `.msg-head`)
- Modify: `src/components/mail/mail.css:720` (bloc `.msg-head`) et `:1151` (breakpoint mobile)
- Test: `src/components/mail/message-item.test.tsx`

**Interfaces:**

- Consumes: `MessageItem` actuel (memo, props inchangées), clés i18n existantes, classes CSS `.who`/`.nm`/`.to`/`.when` (sélecteurs descendants `.msg-head …` qui restent valides, le toggle vivant dans `.msg-head`).
- Produces: bouton `.msg-toggle` (`aria-expanded`), bouton ↪ frère — aucune API modifiée, aucun consommateur à adapter (`reader.tsx` intact).

- [ ] **Step 1: Migrer et ajouter les tests (échec attendu)**

Dans `src/components/mail/message-item.test.tsx` :

a) Remplacer le test « replie le corps au clic sur l'en-tête » (l.64-69) — le clic cible désormais le bouton toggle par son rôle (nom accessible = son contenu, qui commence par l'expéditeur) :

```tsx
it("replie le corps au clic sur le bouton d'en-tête", () => {
  wrap(<MessageItem message={msg()} defaultOpen />)
  expect(screen.getByText("corps en clair")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /^Bob/ }))
  expect(screen.queryByText("corps en clair")).not.toBeInTheDocument()
})
```

b) Ajouter après lui les deux nouveaux tests :

```tsx
it("le toggle expose aria-expanded selon l'état ouvert/replié", () => {
  wrap(<MessageItem message={msg()} defaultOpen />)
  const toggle = screen.getByRole("button", { name: /^Bob/ })
  expect(toggle).toHaveAttribute("aria-expanded", "true")
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute("aria-expanded", "false")
})

it("le bouton Transférer n'est pas imbriqué dans le toggle (a11y)", () => {
  wrap(<MessageItem message={msg()} defaultOpen onForward={() => {}} />)
  const fwd = screen.getByRole("button", { name: /Transférer le message/ })
  const toggle = screen.getByRole("button", { name: /^Bob/ })
  expect(toggle.contains(fwd)).toBe(false)
})
```

Note matchers : quand `onForward` est passé, deux boutons contiennent « Bob » — `/^Bob/` (nom accessible du toggle : « Bob … ») et `/Transférer le message/` les départagent sans ambiguïté. Les tests existants du bouton Transférer (l.145-189) et le test « le clic sur Transférer ne replie pas le message » (l.162-172) restent inchangés.

- [ ] **Step 2: Vérifier l'échec**

Run: `bun run test -- src/components/mail/message-item.test.tsx`
Expected: FAIL — pas de bouton au nom `/^Bob/` (l'en-tête actuel est un div `role="button"` dont le nom inclut aussi le bouton ↪ imbriqué), pas d'`aria-expanded`.

- [ ] **Step 3: Restructurer le markup**

Dans `src/components/mail/message-item.tsx`, remplacer le bloc `.msg-head` (l.91-131) :

```tsx
      <div className="msg-head">
        <button
          type="button"
          className="msg-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Avatar name={leadName} email={senderEmail} />
          <div className="who">
            <div className="nm">{leadName}</div>
            {open && message.to.length > 0 && (
              <div className="to">
                {t("mail.reader.to")}{" "}
                {message.to.map((r) => r.name || r.email).join(", ")}
              </div>
            )}
          </div>
          <div className="when">{formatThreadDate(message.receivedAt)}</div>
        </button>
        {open && onForward && (
          <button
            type="button"
            className="icon-btn sm"
            aria-label={t("mail.compose.forwardMessage", { sender: leadName })}
            title={t("mail.compose.forwardMessage", { sender: leadName })}
            onClick={() => onForward(message)}
          >
            <Icon name="forward" size={16} />
          </button>
        )}
      </div>
```

Disparaissent : `role="button"`, `tabIndex={0}`, le `onKeyDown` manuel du div (Enter/Espace natifs sur `<button>`), les deux `stopPropagation` du bouton ↪ et leur commentaire (plus de parent interactif). Un commentaire français bref au-dessus du `<button className="msg-toggle">` : deux vrais boutons frères — le toggle porte la sémantique disclosure (`aria-expanded`), le ↪ vit hors du toggle (anti-pattern ARIA du contrôle imbriqué levé, suivi #138).

- [ ] **Step 4: Migrer le CSS**

Dans `src/components/mail/mail.css`, remplacer la ligne 720 :

```css
.msg-head { display: flex; align-items: center; gap: 12px; padding-right: 16px; }
.msg-toggle { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; padding: 13px 0 13px 16px; border: none; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.msg-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
```

(le `padding` horizontal/vertical de l'ancien `.msg-head` migre vers le toggle, le retrait droit du ↪ reste au conteneur ; `cursor: pointer` suit le toggle ; reset complet de bouton pour un rendu identique).

Au breakpoint mobile (l.~1151), remplacer `.msg-head { gap: 10px; padding: 12px 13px; }` par :

```css
  .msg-head { gap: 10px; padding-right: 13px; }
  .msg-toggle { gap: 10px; padding: 12px 0 12px 13px; }
```

Les sélecteurs descendants existants (`.msg-head .who`, `.msg-head .when`, etc.) restent valides sans modification.

- [ ] **Step 5: Vérifier que tout passe**

Run: `bun run test -- src/components/mail/message-item.test.tsx src/components/mail/reader.test.tsx && bun run typecheck`
Expected: PASS (reader.test.tsx en sentinelle d'intégration — il rend des MessageItem).

- [ ] **Step 6: Commit**

```bash
git add src/components/mail/message-item.tsx src/components/mail/message-item.test.tsx src/components/mail/mail.css
git commit -m "refactor(reader): accessible message header with sibling toggle and forward buttons"
```

---

### Task 2: Vérification finale + note de spec + passe visuelle

**Files:**

- Modify: `docs/superpowers/specs/2026-07-07-a11y-entete-message-design.md` (section Tests)

**Interfaces:**

- Consumes: Task 1 livrée.
- Produces: branche prête pour la passe visuelle utilisateur puis la PR.

- [ ] **Step 1: Suite complète**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: PASS intégral. (Flaky connus sensibles à la charge : `login.test.tsx` « navigates to the inbox » et `DnsStep` « auto path » — relancer en isolation en cas d'échec pour confirmer la flakiness avant de conclure à une régression.)

- [ ] **Step 2: Mettre la spec à jour (écart clavier)**

Dans la section « Tests » de la spec, remplacer le point « Un test clavier (Enter et Espace replient/déplient via le toggle) est **présent à l'issue de la tâche** — conservé s'il existe, ajouté sinon. … » par :

```markdown
- Pas de test clavier unitaire (décision d'implémentation) : jsdom
  n'implémente pas l'activation Enter/Espace native d'un `<button>` et
  `@testing-library/user-event` n'est pas une dépendance du projet. La
  garantie clavier est structurelle — c'est précisément le refactor (vrai
  `<button>` natif + test de non-imbrication) — et l'activation réelle est
  vérifiée à la passe visuelle (navigateur).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-07-a11y-entete-message-design.md
git commit -m "docs(specs): record native-button keyboard coverage decision"
```

- [ ] **Step 4: Demander la passe visuelle (bloquante avant PR)**

Demander à l'utilisateur de vérifier en dev (`bun run dev`) : état ouvert et replié identiques à avant, focus clavier visible sur le toggle puis le ↪ (Tab), activation Enter/Espace du toggle, alignement du ↪ avec la date, breakpoint mobile. La PR (double revue CodeRabbit — le bot avait proposé de re-regarder ce refactor) n'est ouverte qu'après son feu vert.

---

## Auto-revue du plan

- **Couverture spec** : structure cible (Task 1 Step 3, markup conforme à la spec), CSS avec répartition padding conteneur/toggle figée (Step 4, conforme à la décision de la spec), focus `:focus-visible` accent (Step 4), tests migrés + `aria-expanded` + non-imbrication (Step 1), test « ↪ ne replie pas » conservé (explicite Step 1), passe visuelle bloquante (Task 2 Step 4). Écart clavier documenté (Global Constraints + Task 2 Step 2).
- **Placeholders** : aucun.
- **Cohérence** : `.msg-toggle` unique nouveau nom, utilisé à l'identique dans markup, CSS et spec ; aucun changement d'API de `MessageItem`.
- **Hors périmètre confirmé** : CSS mort `.to-toggle`/`.recip-detail`/`.msg.collapsed .preview` (aucun consommateur `.tsx`) — non touché, à signaler dans la PR comme nettoyage futur éventuel.
