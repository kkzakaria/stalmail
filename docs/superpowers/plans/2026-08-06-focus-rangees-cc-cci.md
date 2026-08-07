# Focus et repli des rangées Cc/Cci — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une rangée Cc/Cci ouverte prend le focus, et toute rangée restée vide se referme dès que le focus quitte la zone destinataires — dans les deux composeurs.

**Architecture :** le repli quitte le `onBlur` de chaque input pour un unique `onBlur` (focusout, qui remonte en React) posé sur un conteneur `.recip-zone` englobant la rangée « À » et les rangées Cc/Cci. Le handler ne referme que si le focus sort de la zone (`!e.currentTarget.contains(e.relatedTarget)`), ce qui rend la circulation interne inoffensive et rattrape les rangées vides oubliées en chemin. Le focus automatique à l'ouverture par bascule complète le dispositif : il rend le champ immédiatement utilisable et supprime la perte de focus clavier.

**Tech Stack :** React 19, TypeScript, vitest + @testing-library/react (jsdom), CSS dans `src/components/mail/mail.css`.

**Spec :** `docs/superpowers/specs/2026-08-06-focus-rangees-cc-cci-design.md` (commit `fbbdf71`).
**Branche :** `fix/cc-bcc-row-focus` (déjà créée depuis `origin/main` à `c500da6`).

## Global Constraints

- **Bun uniquement** : `bun run lint`, `bun run typecheck`, `bun run test`. Jamais npm/yarn/pnpm.
- Le hook pre-commit (`lint && typecheck && test`) **ne doit jamais être contourné** (pas de `--no-verify`).
- Commits **conventionnels en anglais** ; commentaires de code et libellés de test **en français**, comme le reste du fichier.
- **i18n** : aucune clé nouvelle n'est nécessaire. Ne jamais écrire de texte en dur.
- Ne pas toucher aux valeurs du brouillon (`draft.cc`, `draft.bcc`) : le repli agit sur la **visibilité** seulement.
- Ne pas inclure la modification non commitée de `.gitignore` (ajout de `serveur-test.txt`) dans les commits de ce plan : `git add` doit toujours nommer les fichiers explicitement.

## Faits établis par sonde jsdom (ne pas re-découvrir)

Ces quatre points ont été mesurés dans ce dépôt avant rédaction du plan. Ils
déterminent l'écriture des tests :

1. `autoFocus` sur un input monté conditionnellement **fonctionne** en jsdom :
   `document.activeElement` est bien le champ révélé.
2. Un `onBlur` React posé sur un conteneur en `display: contents` **reçoit** le
   focusout de ses enfants, `relatedTarget` intact.
3. `fireEvent.blur(el)` (utilisé par les tests actuels) atteint bien ce handler
   **mais avec `relatedTarget === null`** → sous la décision 4 de la spec, il ne
   referme rien. **Les tests existants basés sur `fireEvent.blur` deviennent donc
   faux et doivent être remplacés**, pas conservés. Le nouvel outil est
   `fireEvent.focusOut(el, { relatedTarget: <élément> })`.
4. `e.currentTarget` doit être lu **synchroniquement** dans le handler. Lu dans
   un callback différé (updater de `setState`), il vaut `null` et lève
   `Cannot read properties of null (reading 'contains')`.
5. **Aucune règle ESLint n'interdit `autoFocus`** dans ce dépôt : le plugin
   `jsx-a11y` n'est pas installé et `eslint --print-config` ne remonte aucune
   règle `no-autofocus`. Ne pas ajouter de `eslint-disable` « au cas où ».

## File Structure

| Fichier | Rôle dans ce plan |
| --- | --- |
| `src/components/mail/recipients-zone.ts` | **Créé.** Prédicat pur `leavesZone(zone, related)` — la règle « le focus sort-il de la zone ? », testée isolément (convention du projet), partagée par les deux composeurs. |
| `src/components/mail/recipients-zone.test.ts` | **Créé.** Tests unitaires du prédicat. |
| `src/components/mail/mail.css` | Ajout de `.recip-zone { display: contents }` — frontière d'événements sans effet de mise en page. Une seule règle, partagée par les deux composeurs. |
| `src/components/mail/quick-reply.tsx` | Zone destinataires + focus auto inconditionnel (les rangées y démarrent toujours fermées). Retrait des deux `onBlur` d'input. |
| `src/components/mail/composer.tsx` | Même zone, focus auto **restreint aux ouvertures par bascule** (`showCc` peut être vrai dès le montage). Retrait des deux `onBlur` d'input. |
| `src/components/mail/quick-reply.test.tsx` | Remplace les 3 tests `fireEvent.blur` (l. 334-365) par des tests de parcours. |
| `src/components/mail/composer.test.tsx` | Remplace les 4 tests `fireEvent.blur` (l. 112-183) par des tests de parcours. |

Aucun changement serveur, aucun changement de type, aucune clé i18n.

---

### Task 1 : Réponse rapide — zone destinataires et focus auto

**Files:**
- Create: `src/components/mail/recipients-zone.ts`
- Create: `src/components/mail/recipients-zone.test.ts`
- Modify: `src/components/mail/mail.css` (ajouter une règle près de la section `.quick-reply`, vers l. 786)
- Modify: `src/components/mail/quick-reply.tsx:1` (import), `:83-157` (structure JSX + handler)
- Test: `src/components/mail/quick-reply.test.tsx:334-365` (bloc remplacé)

**Interfaces:**
- Consumes : rien (première tâche).
- Produces : la classe CSS `.recip-zone` et la fonction pure
  `leavesZone(zone: HTMLElement, related: Element | null): boolean`, toutes deux
  réutilisées telles quelles par la Task 2 — qui ne doit ni les redéfinir ni les
  dupliquer.

- [ ] **Step 1 : Écrire le test du prédicat pur**

Créer `src/components/mail/recipients-zone.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { leavesZone } from "./recipients-zone"

describe("leavesZone", () => {
  const zone = document.createElement("div")
  const interne = document.createElement("input")
  zone.appendChild(interne)
  const externe = document.createElement("input")

  it("relatedTarget nul (fenêtre qui perd le focus) : on ne sort pas", () => {
    expect(leavesZone(zone, null)).toBe(false)
  })

  it("cible interne à la zone : on ne sort pas", () => {
    expect(leavesZone(zone, interne)).toBe(false)
  })

  it("la zone elle-même compte comme interne", () => {
    expect(leavesZone(zone, zone)).toBe(false)
  })

  it("cible hors zone : on sort", () => {
    expect(leavesZone(zone, externe)).toBe(true)
  })
})
```

- [ ] **Step 2 : Lancer le test pour le voir échouer**

```bash
bun run vitest run src/components/mail/recipients-zone.test.ts
```

Attendu : FAIL — le module `./recipients-zone` n'existe pas.

- [ ] **Step 3 : Écrire le prédicat pur**

Créer `src/components/mail/recipients-zone.ts` :

```ts
/**
 * Le focus quitte-t-il la zone destinataires ?
 *
 * Règle partagée par les deux composeurs (design 2026-08-06) : une rangée
 * Cc/Cci vide ne se referme qu'en SORTANT de la zone — circuler entre ses
 * champs et ses bascules ne referme rien.
 */
export function leavesZone(
  zone: HTMLElement,
  related: Element | null
): boolean {
  // relatedTarget nul = la fenêtre a perdu le focus (alt-tab) : ne rien
  // refermer, l'utilisateur va probablement chercher une adresse ailleurs.
  if (related === null) return false
  return !zone.contains(related)
}
```

- [ ] **Step 4 : Lancer le test pour le voir passer**

```bash
bun run vitest run src/components/mail/recipients-zone.test.ts
```

Attendu : 4/4 PASS.

- [ ] **Step 5 : Écrire les tests de parcours**

Dans `src/components/mail/quick-reply.test.tsx`, **supprimer** les trois `it(...)` des lignes 334 à 365 (`forward : referme la rangée Cc vide au blur`, `forward : garde la rangée Cci ouverte au blur quand elle a une valeur`, `forward : referme la rangée Cc au blur avec des espaces seuls`) — ils s'appuient sur `fireEvent.blur`, qui ne referme plus rien (fait établi n°3).

Ajouter ce bloc à la fin du fichier, après le `describe` existant :

```tsx
describe("QuickReply — zone destinataires : focus et repli", () => {
  // Ouvre un transfert puis révèle la rangée Cc par sa bascule.
  const ouvrirCc = () => {
    render(<ForwardHarness detail={detail} />)
    fireEvent.click(screen.getByText("fwd A"))
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
  }
  // Cible hors zone : l'éditeur de message (le parcours rapporté en prod).
  const horsZone = () => screen.getByLabelText("mail.compose.body")

  it("la bascule Cc donne le focus au champ révélé", () => {
    ouvrirCc()
    expect(document.activeElement).toBe(
      screen.getByLabelText("mail.compose.cc")
    )
  })

  it("sortir de la zone referme la rangée Cc vide", () => {
    ouvrirCc()
    fireEvent.focusOut(screen.getByLabelText("mail.compose.cc"), {
      relatedTarget: horsZone(),
    })
    expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })

  it("sortir de la zone garde la rangée Cc remplie", () => {
    ouvrirCc()
    const cc = screen.getByLabelText<HTMLInputElement>("mail.compose.cc")
    fireEvent.change(cc, { target: { value: "bob@x.fr" } })
    fireEvent.focusOut(cc, { relatedTarget: horsZone() })
    expect(
      screen.getByLabelText<HTMLInputElement>("mail.compose.cc").value
    ).toBe("bob@x.fr")
  })

  it("des espaces seuls comptent comme vide", () => {
    ouvrirCc()
    const cc = screen.getByLabelText<HTMLInputElement>("mail.compose.cc")
    fireEvent.change(cc, { target: { value: "   " } })
    fireEvent.focusOut(cc, { relatedTarget: horsZone() })
    expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
  })

  it("circuler dans la zone ne referme rien (Cc vide → bascule Cci)", () => {
    ouvrirCc()
    fireEvent.focusOut(screen.getByLabelText("mail.compose.cc"), {
      relatedTarget: screen.getByRole("button", { name: "mail.compose.bcc" }),
    })
    expect(screen.getByLabelText("mail.compose.cc")).toBeInTheDocument()
  })

  it("détour par Cci puis sortie : la Cc vide oubliée se referme aussi", () => {
    // Le parcours qui échouait : sans la règle de zone, Cc exemptée au passage
    // vers Cci n'était plus jamais réévaluée.
    ouvrirCc()
    fireEvent.focusOut(screen.getByLabelText("mail.compose.cc"), {
      relatedTarget: screen.getByRole("button", { name: "mail.compose.bcc" }),
    })
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
    const bcc = screen.getByLabelText<HTMLInputElement>("mail.compose.bcc")
    fireEvent.change(bcc, { target: { value: "bob@x.fr" } })
    fireEvent.focusOut(bcc, { relatedTarget: horsZone() })
    expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
    expect(
      screen.getByLabelText<HTMLInputElement>("mail.compose.bcc").value
    ).toBe("bob@x.fr")
  })

  it("relatedTarget nul (fenêtre qui perd le focus) ne referme rien", () => {
    ouvrirCc()
    fireEvent.blur(screen.getByLabelText("mail.compose.cc"))
    expect(screen.getByLabelText("mail.compose.cc")).toBeInTheDocument()
  })
})
```

- [ ] **Step 6 : Lancer les tests pour les voir échouer**

```bash
bun run vitest run src/components/mail/quick-reply.test.tsx
```

Attendu : `la bascule Cc donne le focus au champ révélé` échoue (`document.activeElement` est `<body>`), `circuler dans la zone ne referme rien` échoue (l'`onBlur` d'input actuel referme la rangée), `détour par Cci puis sortie` échoue (la Cc reste ouverte), `relatedTarget nul` échoue (l'`onBlur` actuel referme sans regarder `relatedTarget`). Les autres peuvent passer par accident — c'est normal.

- [ ] **Step 7 : Ajouter la règle CSS**

Dans `src/components/mail/mail.css`, juste après la ligne `.quick-reply .qr-field input:focus { ... }` (l. 789) :

```css
/* Zone destinataires (les deux composeurs) : frontière d'événements pour le
   repli des rangées Cc/Cci vides. `contents` = aucune incidence sur la mise en
   page, la colonne flex parente continue de voir les rangées directement. */
.recip-zone { display: contents; }
```

- [ ] **Step 8 : Implémenter dans `quick-reply.tsx`**

Ligne 1, élargir l'import React, et importer le prédicat créé au Step 3 :

```tsx
import { useEffect, useState, type FocusEvent } from "react"
```

puis, avec les autres imports locaux (après `import { Icon } from "./mail-icons"`) :

```tsx
import { leavesZone } from "./recipients-zone"
```

Juste avant le `return (` de la l. 83 (donc après le calcul de `modeLabel`), ajouter le handler :

```tsx
  // Repli au niveau de la ZONE : une rangée vide ne se referme qu'en SORTANT
  // de la zone destinataires. Circuler entre champs et bascules ne referme
  // rien, et toute rangée vide oubliée en chemin est rattrapée à la sortie
  // (design 2026-08-06, décisions 2 à 4).
  const collapseEmptyRows = (e: FocusEvent<HTMLDivElement>) => {
    // currentTarget est lu ICI, pas dans un callback différé : React le remet
    // à null dès que le handler a rendu la main (fait établi n°4).
    if (!leavesZone(e.currentTarget, e.relatedTarget)) return
    if (draft.cc.trim() === "") setShowCc(false)
    if (draft.bcc.trim() === "") setShowBcc(false)
  }
```

Envelopper l'en-tête et les deux rangées sans toucher à leur contenu. Insérer
cette ligne d'ouverture **juste avant** `<div className="qr-head">` (l. 86) :

```tsx
      <div className="recip-zone" onBlur={collapseEmptyRows}>
```

et cette ligne de fermeture **juste après** l'accolade fermante du bloc
`{draft.mode === "forward" && showBcc && ( … )}` (l. 157), donc avant le
commentaire `{/* Puces des pièces jointes … */}` (l. 158) :

```tsx
      </div>
```

Ré-indenter d'un cran le contenu ainsi enveloppé — Prettier s'en charge au
commit, mais l'indentation manuelle évite un diff bruyant.

Sur l'input `#qr-cc` (l. 133-141) : **supprimer** le `onBlur` et son commentaire,
**ajouter** `autoFocus` :

```tsx
          <input
            id="qr-cc"
            // Focus à l'ouverture : la rangée est utilisable sans second clic,
            // et le focus clavier ne retombe plus sur <body>. Inconditionnel
            // ici — dans la réponse rapide les rangées démarrent fermées, donc
            // tout montage est une ouverture par bascule.
            autoFocus
            value={draft.cc}
            onChange={(e) => onPatch({ cc: e.target.value })}
          />
```

Même traitement pour `#qr-bcc` (l. 147-155) : `onBlur` supprimé, `autoFocus`
ajouté, `value={draft.bcc}` et `onChange` inchangés.

- [ ] **Step 9 : Lancer les tests pour les voir passer**

```bash
bun run vitest run src/components/mail/quick-reply.test.tsx
```

Attendu : PASS, y compris les tests de non-régression déjà présents
(`fermer puis rouvrir`, `transférer A … transférer B`, bascules indépendantes).

- [ ] **Step 10 : Vérifier la suite complète et les contrôles**

```bash
bun run test && bun run lint && bun run typecheck
```

Attendu : tout vert. Si `reader.test.tsx` ou d'autres tests montant la réponse
rapide échouent sur un focus inattendu, c'est un vrai signal : le focus auto
change `document.activeElement`. Corriger le test concerné, pas le composant.

- [ ] **Step 11 : Commit**

```bash
git add src/components/mail/recipients-zone.ts src/components/mail/recipients-zone.test.ts src/components/mail/quick-reply.tsx src/components/mail/quick-reply.test.tsx src/components/mail/mail.css
git commit -m "fix(reader): focus revealed Cc/Bcc row and collapse empty rows on zone exit"
```

---

### Task 2 : Grand Composer — même règle, focus restreint aux ouvertures par bascule

**Files:**
- Modify: `src/components/mail/composer.tsx:1` (import), `:16-24` (refs), `:70-130` (structure JSX + handler)
- Test: `src/components/mail/composer.test.tsx:112-183` (bloc remplacé)

**Interfaces:**
- Consumes : la classe CSS `.recip-zone` et
  `leavesZone(zone: HTMLElement, related: Element | null): boolean`, exportée
  par `src/components/mail/recipients-zone.ts` (Task 1) — les importer, ne
  jamais les redéfinir ni les recopier.
- Produces : rien pour les tâches suivantes.

**Différence unique avec la Task 1 :** `showCc` est initialisé à
`initial.cc !== ""` (`composer.tsx:20`), donc une réponse à tous arrive avec la
rangée Cc **déjà ouverte et remplie**. Un `autoFocus` inconditionnel volerait le
curseur à l'ouverture du composeur. Le focus est donc conditionné à un drapeau
posé par la bascule.

- [ ] **Step 1 : Écrire les tests de parcours**

Dans `src/components/mail/composer.test.tsx`, **supprimer** les quatre `it(...)`
des lignes 112 à 183 (`referme la rangée Cc vide au blur`, `garde la rangée Cc
ouverte au blur quand elle a une valeur`, `referme la rangée Cci au blur avec
des espaces seuls`, `referme la rangée Cc pré-remplie (replyAll) une fois vidée
puis quittée`) — même raison qu'en Task 1 : ils reposent sur `fireEvent.blur`.

Ajouter à leur place :

```tsx
  // Cible hors zone : le champ Sujet, juste sous les rangées destinataires.
  const horsZone = () => screen.getByLabelText("mail.compose.subject")

  it("la bascule Cc donne le focus au champ révélé", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    )
  })

  it("une rangée Cc pré-remplie (replyAll) ne prend PAS le focus au montage", () => {
    render(
      <Composer
        initial={{ ...initial, mode: "replyAll", cc: "bob@x.fr" }}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    expect(document.activeElement).not.toBe(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    )
  })

  it("sortir de la zone referme la rangée Cc vide", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    fireEvent.focusOut(
      screen.getByRole("textbox", { name: "mail.compose.cc" }),
      { relatedTarget: horsZone() }
    )
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.cc" })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })

  it("sortir de la zone garde la rangée Cc remplie", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    const cc = screen.getByRole("textbox", { name: "mail.compose.cc" })
    fireEvent.change(cc, { target: { value: "bob@x.fr" } })
    fireEvent.focusOut(cc, { relatedTarget: horsZone() })
    expect(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    ).toHaveValue("bob@x.fr")
  })

  it("des espaces seuls comptent comme vide", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
    const bcc = screen.getByRole("textbox", { name: "mail.compose.bcc" })
    fireEvent.change(bcc, { target: { value: "   " } })
    fireEvent.focusOut(bcc, { relatedTarget: horsZone() })
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.bcc" })
    ).toBeNull()
  })

  it("circuler dans la zone ne referme rien (Cc vide → bascule Cci)", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    fireEvent.focusOut(
      screen.getByRole("textbox", { name: "mail.compose.cc" }),
      { relatedTarget: screen.getByRole("button", { name: "mail.compose.bcc" }) }
    )
    expect(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })

  it("détour par Cci puis sortie : la Cc vide oubliée se referme aussi", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    fireEvent.focusOut(
      screen.getByRole("textbox", { name: "mail.compose.cc" }),
      { relatedTarget: screen.getByRole("button", { name: "mail.compose.bcc" }) }
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.bcc" }))
    const bcc = screen.getByRole("textbox", { name: "mail.compose.bcc" })
    fireEvent.change(bcc, { target: { value: "bob@x.fr" } })
    fireEvent.focusOut(bcc, { relatedTarget: horsZone() })
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.cc" })
    ).toBeNull()
    expect(
      screen.getByRole("textbox", { name: "mail.compose.bcc" })
    ).toHaveValue("bob@x.fr")
  })

  it("la rangée Cc pré-remplie vidée se referme en sortant de la zone", () => {
    render(
      <Composer
        initial={{ ...initial, mode: "replyAll", cc: "bob@x.fr" }}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    const cc = screen.getByRole("textbox", { name: "mail.compose.cc" })
    fireEvent.change(cc, { target: { value: "" } })
    fireEvent.focusOut(cc, { relatedTarget: horsZone() })
    expect(
      screen.queryByRole("textbox", { name: "mail.compose.cc" })
    ).toBeNull()
  })

  it("relatedTarget nul (fenêtre qui perd le focus) ne referme rien", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    fireEvent.blur(screen.getByRole("textbox", { name: "mail.compose.cc" }))
    expect(
      screen.getByRole("textbox", { name: "mail.compose.cc" })
    ).toBeInTheDocument()
  })
```

- [ ] **Step 2 : Lancer les tests pour les voir échouer**

```bash
bun run vitest run src/components/mail/composer.test.tsx
```

Attendu : les tests de focus, de circulation interne, de détour et de
`relatedTarget` nul échouent. `une rangée Cc pré-remplie ne prend PAS le focus`
passe déjà (aucun `autoFocus` n'existe encore) — c'est un garde-fou pour la
suite, pas une régression.

- [ ] **Step 3 : Implémenter dans `composer.tsx`**

Ligne 1, et l'import du prédicat partagé avec les autres imports locaux :

```tsx
import { useRef, useState, type FocusEvent } from "react"
```

```tsx
import { leavesZone } from "./recipients-zone"
```

Après la déclaration de `showBcc` (l. 21), ajouter les drapeaux :

```tsx
  // Le focus n'est donné qu'aux rangées ouvertes PAR LA BASCULE : showCc/showBcc
  // peuvent être vrais dès le montage (replyAll avec Cc pré-rempli), et voler le
  // curseur à l'ouverture du composeur serait une régression.
  const ccOpenedByUser = useRef(false)
  const bccOpenedByUser = useRef(false)
```

Après la déclaration de `set` (l. 25-26), ajouter le handler. Il **réutilise**
le prédicat `leavesZone` créé en Task 1 — ne pas le réécrire ni le recopier :

```tsx
  // Repli au niveau de la ZONE : une rangée vide ne se referme qu'en SORTANT
  // de la zone destinataires (design 2026-08-06, décisions 2 à 4).
  const collapseEmptyRows = (e: FocusEvent<HTMLDivElement>) => {
    // currentTarget est lu ICI, pas dans un callback différé : React le remet
    // à null dès que le handler a rendu la main.
    if (!leavesZone(e.currentTarget, e.relatedTarget)) return
    if (draft.cc.trim() === "") setShowCc(false)
    if (draft.bcc.trim() === "") setShowBcc(false)
  }
```

Les deux bascules posent leur drapeau avant d'ouvrir (l. 84 et l. 95) :

```tsx
                onClick={() => {
                  ccOpenedByUser.current = true
                  setShowCc(true)
                }}
```

```tsx
                onClick={() => {
                  bccOpenedByUser.current = true
                  setShowBcc(true)
                }}
```

Envelopper la rangée « À » et les deux rangées Cc/Cci. Insérer cette ligne
d'ouverture **juste avant** le `<div className="composer-field">` de la l. 70
(celui qui porte le label `cmp-to`) :

```tsx
          <div className="recip-zone" onBlur={collapseEmptyRows}>
```

et cette ligne de fermeture **juste après** l'accolade fermante du bloc
`{showBcc && ( … )}` (l. 130). Le `<div className="composer-field">` du champ
Sujet (l. 132) doit rester **dehors** — c'est lui qui sert de cible « hors
zone » dans les tests :

```tsx
          </div>
```

Sur l'input `#cmp-cc` (l. 105-114) : **supprimer** le `onBlur` et son
commentaire, **ajouter** le focus conditionnel :

```tsx
              <input
                id="cmp-cc"
                aria-label={t("mail.compose.cc")}
                autoFocus={ccOpenedByUser.current}
                value={draft.cc}
                onChange={(e) => set({ cc: e.target.value })}
              />
```

Même traitement pour `#cmp-bcc` (l. 120-128) avec `autoFocus={bccOpenedByUser.current}`.

- [ ] **Step 4 : Lancer les tests pour les voir passer**

```bash
bun run vitest run src/components/mail/composer.test.tsx
```

Attendu : PASS, y compris `une rangée Cc pré-remplie ne prend PAS le focus au
montage` — c'est ce test qui prouve que le drapeau fait son travail.

- [ ] **Step 5 : Vérifier la suite complète et les contrôles**

```bash
bun run test && bun run lint && bun run typecheck
```

- [ ] **Step 6 : Commit**

```bash
git add src/components/mail/composer.tsx src/components/mail/composer.test.tsx
git commit -m "fix(composer): focus revealed Cc/Bcc row and collapse empty rows on zone exit"
```

---

### Task 3 : Vérification navigateur des deux parcours réels

Les tests unitaires ont laissé passer le défaut d'origine parce qu'ils
simulaient un blur que l'utilisateur ne pouvait pas produire. Cette tâche ferme
la boucle sur un vrai navigateur.

**Files:** aucun (vérification seule).

**Interfaces:**
- Consumes : les Tasks 1 et 2, commitées.

- [ ] **Step 1 : S'assurer que la stack de dev sert le code de la branche**

```bash
docker compose -f compose.dev.yml up -d
docker compose -f compose.dev.yml restart app
```

Le `restart` n'est pas facultatif : sous WSL2, inotify ne traverse pas le bind
mount, donc Vite ne voit pas les changements venus de git.

- [ ] **Step 2 : Parcours n°1 — la réponse rapide, transfert**

Ouvrir un message, cliquer le bouton ↪ de l'en-tête, puis vérifier dans l'ordre :

1. cliquer « Cc » → le curseur est **dans** le champ Cc (vérifiable par
   `document.activeElement.id === "qr-cc"`) ;
2. cliquer « Cci » sans rien saisir → la rangée Cc est **toujours là** ;
3. saisir une adresse en Cci, puis cliquer dans le corps du message → la rangée
   Cc (vide) a disparu, la rangée Cci (remplie) est restée.

- [ ] **Step 3 : Parcours n°2 — le grand composeur**

Cliquer « Nouveau message », puis :

1. cliquer « Cc » → curseur dans le champ (`document.activeElement.id === "cmp-cc"`) ;
2. cliquer dans le champ Sujet sans rien saisir → la rangée Cc a disparu,
   la bascule « Cc » est revenue.

- [ ] **Step 4 : Parcours n°3 — le clic avalé par le décalage**

Danger propre à tout repli déclenché par le focus : le focus part au
**mousedown**, donc les rangées se referment **avant le mouseup**. Tout ce qui
est sous les rangées remonte de ~44 px entre les deux, et le navigateur
n'émet un `click` que si mousedown et mouseup partagent la même cible.

Dans la réponse rapide, ouvrir Cc sans rien saisir, puis cliquer **directement**
sur « Envoyer » :

- si le message part → aucun problème, consigner le résultat ;
- si le clic est avalé → **ne pas corriger dans cette PR**. Le vérifier d'abord
  sur la prod v0.1.48 (le défaut serait alors antérieur, hérité du `onBlur`
  d'input), puis ouvrir une issue dédiée avec les deux mesures.

> **Arbitrage ultérieur** : consigne d'origine ci-dessus non suivie — le
> partenaire humain a arbitré l'inverse. La Task 4 ci-dessous corrige
> effectivement le clic avalé dans cette même PR (décision 6 de la spec),
> plutôt que d'ouvrir une issue dédiée.

- [ ] **Step 5 : Consigner le résultat**

Reporter les deux parcours dans la description de la PR (ce sont eux qui
manquaient à la v0.1.48). En cas d'écart entre le navigateur et les tests,
c'est le test qui ment : reproduire l'écart dans un test avant de corriger.

---

## Après le plan

1. Ouvrir la PR depuis `fix/cc-bcc-row-focus` (base `main`), en anglais, en
   liant la spec et en décrivant les deux parcours vérifiés.
2. Double revue CodeRabbit (bot sur la PR + `coderabbit review --agent --base main`
   depuis la branche), triage argumenté, skips motivés en commentaire.
3. Merge `--squash --admin --delete-branch` sur accord explicite, puis
   release-please.

## Hors périmètre (backlog, ne pas traiter ici)

- L'indicateur de focus visuel des inputs du grand Composer (`.composer-field
  input` n'a pas l'équivalent du `outline` de `.qr-field input:focus`).
- Le CSS mort `.to-toggle` / `.recip-detail`.
- Issue #141 (mode lecture mobile non câblé).

---

### Task 4 : Différer le repli jusqu'à la fin du geste pointeur (issue #147)

Corrige le clic avalé mesuré en Task 3. Applique la **décision 6** de la spec.

**Files:**
- Create: `src/components/mail/use-gesture-safe-collapse.ts`
- Create: `src/components/mail/use-gesture-safe-collapse.test.tsx`
- Modify: `src/components/mail/quick-reply.tsx` (hook + handler)
- Modify: `src/components/mail/composer.tsx` (hook + handler)
- Test: `src/components/mail/quick-reply.test.tsx`, `src/components/mail/composer.test.tsx` (un test de parcours chacun)

**Interfaces:**
- Consumes : `leavesZone` (Task 1) et les handlers `collapseEmptyRows` des Tasks 1 et 2.
- Produces : `useGestureSafeCollapse(): (collapse: () => void) => void`.

**Faits établis par sonde jsdom (mesurés avant rédaction, ne pas re-découvrir) :**
1. `fireEvent.pointerDown` / `fireEvent.pointerUp` sont bien dispatchés en jsdom et atteignent un écouteur `document` en capture.
2. Le report du repli au `pointerup` puis en `setTimeout(…, 0)` fonctionne tel quel.
3. **`vi.runAllTimers()` doit être enveloppé dans `act(...)`** (importé de `@testing-library/react`), sinon la mise à jour d'état déclenchée par le timer n'est pas répercutée dans le DOM et l'assertion échoue à tort.

- [ ] **Step 1 : Écrire le test du hook**

Créer `src/components/mail/use-gesture-safe-collapse.test.tsx` :

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { useState } from "react"
import { useGestureSafeCollapse } from "./use-gesture-safe-collapse"

function Harness() {
  const [ouverte, setOuverte] = useState(true)
  const collapseAfterGesture = useGestureSafeCollapse()
  return (
    <div>
      <button
        type="button"
        onClick={() => collapseAfterGesture(() => setOuverte(false))}
      >
        replier
      </button>
      <button type="button">cible</button>
      <span data-testid="etat">{ouverte ? "ouverte" : "fermée"}</span>
    </div>
  )
}

// Harnais démontable : expose le `collapse` différé pour vérifier qu'il n'est
// pas appelé si le composant démonte avant la fin du geste.
function HarnaisAvecEspion({ collapse }: { collapse: () => void }) {
  const collapseAfterGesture = useGestureSafeCollapse()
  return (
    <div>
      <button type="button" onClick={() => collapseAfterGesture(collapse)}>
        replier
      </button>
      <button type="button">cible</button>
    </div>
  )
}

describe("useGestureSafeCollapse", () => {
  it("hors geste : replie immédiatement", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "replier" }))
    expect(screen.getByTestId("etat")).toHaveTextContent("fermée")
  })

  it("geste en cours : ne replie pas avant le relâchement", () => {
    vi.useFakeTimers()
    try {
      render(<Harness />)
      const cible = screen.getByRole("button", { name: "cible" })
      fireEvent.pointerDown(cible)
      fireEvent.click(screen.getByRole("button", { name: "replier" }))
      expect(screen.getByTestId("etat")).toHaveTextContent("ouverte")
      fireEvent.pointerUp(cible)
      act(() => {
        vi.runAllTimers()
      })
      expect(screen.getByTestId("etat")).toHaveTextContent("fermée")
    } finally {
      vi.useRealTimers()
    }
  })

  it("geste annulé (pointercancel) : replie quand même", () => {
    vi.useFakeTimers()
    try {
      render(<Harness />)
      const cible = screen.getByRole("button", { name: "cible" })
      fireEvent.pointerDown(cible)
      fireEvent.click(screen.getByRole("button", { name: "replier" }))
      fireEvent.pointerCancel(cible)
      act(() => {
        vi.runAllTimers()
      })
      expect(screen.getByTestId("etat")).toHaveTextContent("fermée")
    } finally {
      vi.useRealTimers()
    }
  })

  it("composant démonté pendant le geste : le repli différé ne s'exécute pas (fuite d'écouteur)", () => {
    vi.useFakeTimers()
    try {
      const collapse = vi.fn()
      const { unmount } = render(<HarnaisAvecEspion collapse={collapse} />)
      const cible = screen.getByRole("button", { name: "cible" })
      fireEvent.pointerDown(cible)
      fireEvent.click(screen.getByRole("button", { name: "replier" }))
      // Démonté AVANT le pointerup attendu : le report doit être annulé, pas
      // laissé en attente sur `document`.
      unmount()
      // Dispatché sur `document`, pas sur `cible` : `cible` est détachée du
      // document après unmount() et ne remonte plus jusqu'à l'écouteur
      // global — seul un dispatch sur `document` lui-même est discriminant.
      fireEvent.pointerUp(document)
      act(() => {
        vi.runAllTimers()
      })
      expect(collapse).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
```

- [ ] **Step 2 : Lancer le test pour le voir échouer**

```bash
bun run vitest run src/components/mail/use-gesture-safe-collapse.test.tsx
```

Attendu : FAIL — le module `./use-gesture-safe-collapse` n'existe pas.

- [ ] **Step 3 : Écrire le hook**

Créer `src/components/mail/use-gesture-safe-collapse.ts` :

```ts
import { useCallback, useEffect, useRef } from "react"

/**
 * Renvoie une fonction qui exécute `collapse` tout de suite, ou — si un geste
 * pointeur est en cours — juste APRÈS la délivrance du clic.
 *
 * Pourquoi : le focus part au mousedown. Replier une rangée à cet instant fait
 * remonter tout ce qui est en dessous avant le mouseup, et le navigateur n'émet
 * un `click` que si mousedown et mouseup partagent une cible — le clic sur
 * « Envoyer » était avalé (issue #147, design 2026-08-06 décision 6).
 */
export function useGestureSafeCollapse(): (collapse: () => void) => void {
  const pointerDown = useRef(false)
  // Reports en attente (geste en cours, `collapse` pas encore exécuté) : un
  // retrait par report, pour tout annuler si le composant démonte avant le
  // pointerup/pointercancel attendu (sinon l'écouteur reste posé sur
  // `document` et déclenche un `collapse` périmé plus tard, ailleurs).
  const pending = useRef<Set<() => void>>(new Set())

  useEffect(() => {
    const down = () => {
      pointerDown.current = true
    }
    const up = () => {
      pointerDown.current = false
    }
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("pointerup", up, true)
    document.addEventListener("pointercancel", up, true)
    // Capturé ICI (pas relu via pending.current dans le cleanup) : la ref
    // n'est jamais réassignée, donc la même instance de Set reste valable
    // jusqu'au démontage — et exhaustive-deps ne réclame pas `pending` en
    // dépendance de cet effet.
    const pendingReports = pending.current
    return () => {
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("pointerup", up, true)
      document.removeEventListener("pointercancel", up, true)
      // Annule les gestes en cours : retire leurs écouteurs globaux et
      // empêche tout `collapse` différé de s'exécuter après démontage.
      for (const cancel of pendingReports) cancel()
      pendingReports.clear()
    }
  }, [])

  return useCallback((collapse: () => void) => {
    if (!pointerDown.current) {
      collapse()
      return
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      document.removeEventListener("pointerup", finish, true)
      document.removeEventListener("pointercancel", finish, true)
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      pending.current.delete(cancel)
    }
    const finish = () => {
      document.removeEventListener("pointerup", finish, true)
      document.removeEventListener("pointercancel", finish, true)
      // pointerup, mouseup et click appartiennent à la même tâche : une
      // macrotâche s'exécute donc après la délivrance du clic.
      timeoutId = setTimeout(() => {
        pending.current.delete(cancel)
        collapse()
      }, 0)
    }
    pending.current.add(cancel)
    document.addEventListener("pointerup", finish, true)
    document.addEventListener("pointercancel", finish, true)
  }, [])
}
```

> **Note** : version en vigueur depuis la correction post-revue (commit
> `593d4a9`) — le registre `pending` annule les reports encore actifs au
> démontage. La version initialement rédigée ici ne suivait pas ce chemin ;
> voir le test de démontage ajouté au Step 1.

- [ ] **Step 4 : Lancer le test pour le voir passer**

```bash
bun run vitest run src/components/mail/use-gesture-safe-collapse.test.tsx
```

Attendu : 4/4 PASS.

- [ ] **Step 5 : Brancher le hook dans les deux composeurs**

Dans `quick-reply.tsx`, avec les autres hooks (donc **avant** le `if (!draft)`) :

```tsx
  const collapseAfterGesture = useGestureSafeCollapse()
```

et l'import correspondant avec les autres imports locaux :

```tsx
import { useGestureSafeCollapse } from "./use-gesture-safe-collapse"
```

Puis envelopper le corps du handler existant :

```tsx
  const collapseEmptyRows = (e: FocusEvent<HTMLDivElement>) => {
    if (!leavesZone(e.currentTarget, e.relatedTarget)) return
    collapseAfterGesture(() => {
      if (draft.cc.trim() === "") setShowCc(false)
      if (draft.bcc.trim() === "") setShowBcc(false)
    })
  }
```

Appliquer exactement la même transformation dans `composer.tsx` (mêmes noms
d'état, `set` inchangé).

- [ ] **Step 6 : Ajouter un test de parcours par composeur**

Dans `quick-reply.test.tsx`, à la fin du `describe` « zone destinataires » :

```tsx
  it("clic en cours : le repli attend la fin du geste (issue #147)", () => {
    vi.useFakeTimers()
    try {
      ouvrirCc()
      const cible = horsZone()
      fireEvent.pointerDown(cible)
      fireEvent.focusOut(screen.getByLabelText("mail.compose.cc"), {
        relatedTarget: cible,
      })
      // Rien ne bouge tant que le pointeur est enfoncé : sinon le clic serait
      // avalé par le décalage de la mise en page.
      expect(screen.getByLabelText("mail.compose.cc")).toBeInTheDocument()
      fireEvent.pointerUp(cible)
      act(() => {
        vi.runAllTimers()
      })
      expect(screen.queryByLabelText("mail.compose.cc")).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
```

Ajouter `act` à l'import `@testing-library/react` du fichier, et `vi` à
l'import `vitest` s'il n'y est pas déjà.

Dans `composer.test.tsx`, le même test, adapté aux sélecteurs du composeur
(`screen.getByRole("textbox", { name: "mail.compose.cc" })`, cible hors zone
`horsZone()` = le champ Sujet), avec le même titre.

- [ ] **Step 7 : Vérifier la suite complète et les contrôles**

```bash
bun run test && bun run lint && bun run typecheck
```

- [ ] **Step 8 : Commit**

```bash
git add src/components/mail/use-gesture-safe-collapse.ts src/components/mail/use-gesture-safe-collapse.test.tsx src/components/mail/quick-reply.tsx src/components/mail/composer.tsx src/components/mail/quick-reply.test.tsx src/components/mail/composer.test.tsx
git commit -m "fix(composer): defer empty-row collapse until the pointer gesture ends

Closes #147"
```

---

### Task 5 : Supprimer les drapeaux permanents au profit d'un focus impératif consommé

Corrige le défaut relevé par la revue finale (M1) : `ccOpenedByUser` /
`bccOpenedByUser` ne sont jamais remis à `false`. Ils expriment « cette rangée a
déjà été ouverte par la bascule au moins une fois », alors que la question posée
au montage est « ce montage-ci résulte-t-il d'un clic sur la bascule ? ».

Conséquence mesurable : `composer.tsx` démonte tout le corps en mode réduit
(`{mode !== "min" && (…)}`). Réduire puis restaurer avec une rangée **remplie**
la remonte avec `autoFocus` encore à `true` — le curseur saute dans Cc au lieu de
rester où il était. (Une rangée vide, elle, se referme au clic sur « réduire » :
ce bouton est hors zone, la règle de repli s'applique.)

**Files:**
- Modify: `src/components/mail/composer.tsx:29-30` (refs), `:106-123` (bascules), `:133-151` (inputs)
- Test: `src/components/mail/composer.test.tsx`

**Interfaces:**
- Consumes : rien de nouveau.
- Produces : rien — changement interne au composeur.

**Périmètre :** `quick-reply.tsx` **n'est pas touché**. Ses rangées démarrent
toujours fermées et le panneau entier est démonté à la fermeture, donc tout
montage y résulte d'un clic sur la bascule : l'`autoFocus` inconditionnel y est
correct. Un commentaire d'une ligne le dira sur place, pour qu'on ne prenne pas
la divergence entre les deux fichiers pour un oubli.

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `src/components/mail/composer.test.tsx`, ajouter au `describe("Composer")` :

```tsx
  it("réduire puis restaurer ne vole pas le curseur à une rangée remplie", () => {
    render(
      <Composer
        initial={initial}
        sending={false}
        onSend={() => {}}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.cc" }))
    fireEvent.change(screen.getByRole("textbox", { name: "mail.compose.cc" }), {
      target: { value: "bob@x.fr" },
    })
    // Le corps du composeur est démonté en mode réduit puis remonté : ce
    // remontage n'est PAS une ouverture par bascule.
    fireEvent.click(
      screen.getByRole("button", { name: "mail.compose.minimize" })
    )
    fireEvent.click(screen.getByRole("button", { name: "mail.compose.expand" }))
    const cc = screen.getByRole("textbox", { name: "mail.compose.cc" })
    expect(cc).toHaveValue("bob@x.fr")
    expect(document.activeElement).not.toBe(cc)
  })
```

- [ ] **Step 2 : Lancer le test pour le voir échouer**

```bash
bun run vitest run src/components/mail/composer.test.tsx
```

Attendu : ÉCHEC sur `expect(document.activeElement).not.toBe(cc)` — le drapeau
permanent redonne `autoFocus={true}` au remontage. Si le test passe déjà,
**arrête-toi et signale-le** : le défaut ne serait pas celui décrit.

- [ ] **Step 3 : Remplacer les drapeaux par une intention consommée**

Dans `composer.tsx`, remplacer les deux refs (l. 29-30) par une seule :

```tsx
  // Quelle rangée doit recevoir le focus à son PROCHAIN montage. L'intention est
  // consommée au montage : `autoFocus` ne sait pas distinguer une ouverture par
  // bascule d'un simple remontage (retour du mode réduit), et un drapeau
  // permanent y volerait le curseur.
  const pendingFocus = useRef<"cc" | "bcc" | null>(null)
```

Les deux bascules posent l'intention (l. 106-109 et 120-123) :

```tsx
                  onClick={() => {
                    pendingFocus.current = "cc"
                    setShowCc(true)
                  }}
```

```tsx
                  onClick={() => {
                    pendingFocus.current = "bcc"
                    setShowBcc(true)
                  }}
```

Les deux inputs perdent `autoFocus` et gagnent une ref de rappel qui consomme
l'intention (`#cmp-cc`, l. 133-139) :

```tsx
                <input
                  id="cmp-cc"
                  aria-label={t("mail.compose.cc")}
                  ref={(el) => {
                    if (el && pendingFocus.current === "cc") {
                      pendingFocus.current = null
                      el.focus()
                    }
                  }}
                  value={draft.cc}
                  onChange={(e) => set({ cc: e.target.value })}
                />
```

Idem pour `#cmp-bcc` (l. 145-151) avec `"bcc"`, `draft.bcc` et `set({ bcc: … })`.

La ref de rappel ne doit **rien renvoyer** : en React 19 une valeur de retour est
interprétée comme fonction de nettoyage. Le corps entre accolades ci-dessus
renvoie bien `undefined`.

- [ ] **Step 4 : Documenter la divergence côté réponse rapide**

Dans `quick-reply.tsx`, au-dessus de l'`autoFocus` de `#qr-cc`, compléter le
commentaire existant par une phrase :

```tsx
            // Inconditionnel ici, contrairement au grand Composer : le panneau
            // entier est démonté à la fermeture et les rangées démarrent
            // fermées, donc tout montage résulte d'un clic sur la bascule.
```

- [ ] **Step 5 : Lancer les tests pour les voir passer**

```bash
bun run vitest run src/components/mail/composer.test.tsx src/components/mail/quick-reply.test.tsx
```

Attendu : PASS, y compris les deux tests existants qui encadrent le comportement
— « la bascule Cc donne le focus au champ révélé » et « une rangée Cc pré-remplie
(replyAll) ne prend PAS le focus au montage ».

- [ ] **Step 6 : Vérifier la suite complète et les contrôles**

```bash
bun run test && bun run lint && bun run typecheck
```

- [ ] **Step 7 : Commit**

```bash
git add src/components/mail/composer.tsx src/components/mail/composer.test.tsx src/components/mail/quick-reply.tsx
git commit -m "fix(composer): consume the focus intent instead of latching it"
```
