# En-tête de message accessible (refactor a11y) — Design

**Date** : 2026-07-07
**Origine** : suivi différé de la PR #138 (transfert véritable, issue #79). Finding
CodeRabbit (bot + CLI, accepté en report) : le bouton ↪ « Transférer » est un
contrôle interactif imbriqué dans un div `role="button"` — anti-pattern ARIA,
support incohérent par les technologies d'assistance.
**Statut** : validé en brainstorming.

## Problème

L'en-tête de chaque message du fil (`src/components/mail/message-item.tsx`,
`.msg-head`) est un div cliquable `role="button"` + `tabIndex` + `onKeyDown`
manuel qui replie/déplie le message. Depuis la PR #138, il contient aussi le
bouton ↪ de transfert — un bouton dans un bouton. Les mitigations en place
(`stopPropagation` clic + clavier, nom accessible unique par message) rendent
le comportement correct, mais la structure reste un anti-pattern ARIA.

Le refactor avait été reporté parce qu'il touche l'alignement flex de
l'en-tête : il exige une passe visuelle, pas un changement en aveugle.

## Décisions

1. **Zone cliquable du toggle = avatar + nom/destinataires + date** (le bouton
   ↪ devient un frère hors du toggle). L'alternative « toute la ligne » via
   stretched-link (bouton invisible étendu en `::after`, ↪ au-dessus en
   z-index) a été écartée : CSS plus fragile pour un gain marginal (seuls les
   pixels autour du ↪ cessent de toggler).
2. **Passe visuelle par l'utilisateur en dev** après implémentation, avant PR :
   ouvert/repli, focus clavier visible, alignement du ↪ avec la date,
   breakpoint mobile.

## Structure cible (`message-item.tsx`)

```tsx
<div className="msg-head">
  <button
    type="button"
    className="msg-toggle"
    aria-expanded={open}
    onClick={() => setOpen((o) => !o)}
  >
    <Avatar name={leadName} email={senderEmail} />
    <div className="who">…nom, destinataires (si open)…</div>
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

Simplifications obtenues :

- `role="button"`, `tabIndex={0}` et le `onKeyDown` manuel (Enter/Espace)
  disparaissent — un vrai `<button>` gère le clavier nativement.
- Les deux `stopPropagation` du bouton ↪ disparaissent — plus de parent
  interactif à isoler.
- **Gain sémantique** : `aria-expanded={open}` sur le toggle (pattern
  disclosure standard, absent du div actuel).

## CSS (`mail.css`)

Contrainte directrice : **rendu identique au pixel** ; aire cliquable du
toggle identique à une exception près, assumée : la bande du `padding-right`
(16px, portée par le conteneur) ne toggle plus — cohérent avec la décision
produit (la zone du ↪ ne toggle pas non plus).

- Le padding actuel de `.msg-head` (`13px 16px` ; `12px 13px` au breakpoint
  mobile ~l.1151) **migre vers `.msg-toggle`** pour que toute la zone
  aujourd'hui cliquable le reste. `.msg-head` devient un conteneur flex avec
  `padding-right: 16px` (13px au breakpoint mobile) — c'est lui qui donne au
  bouton ↪ son retrait droit ; le `.msg-toggle` porte
  `padding: 13px 0 13px 16px` (le retrait droit reste au conteneur, jamais
  doublé). Contrainte de sortie : identité visuelle au pixel dans les deux
  états, ↪ présent ou non.
- `.msg-toggle` = reset complet de bouton + propriétés flex actuelles du
  head : `display:flex; align-items:center; gap:12px; flex:1; min-width:0;
  border:none; background:none; font:inherit; color:inherit; text-align:left;
  cursor:pointer;` (gap `10px` au breakpoint mobile).
- Focus : `.msg-toggle:focus-visible { outline: 2px solid var(--accent);
  outline-offset: -2px; }` — cohérent avec la convention `.qr-to` existante.
- Les styles descendants (`.who`, `.nm`, `.to`, `.when`) sont aujourd'hui
  scopés `.msg-head .who` etc. — ils restent valables (le toggle est dans
  `.msg-head`), aucun changement attendu.

## Tests (`message-item.test.tsx`)

- Les tests de repli/dépli ciblent le bouton toggle par son rôle (nom
  accessible = contenu, ex. `getByRole("button", { name: /Alice/ })`).
- Nouveau test : `aria-expanded` vaut `true` ouvert, `false` replié.
- Un test clavier (Enter et Espace replient/déplient via le toggle) est
  **présent à l'issue de la tâche** — conservé s'il existe, ajouté sinon. Il
  documente le comportement natif du bouton et protège contre une régression
  future de structure.
- Le test de non-régression « le clic sur ↪ ne replie pas le message » est
  conservé tel quel.
- Les tests du bouton ↪ (présence quand ouvert, `onForward(message)`, nom
  accessible unique) restent inchangés.

## Validation

1. `bun run lint && bun run typecheck && bun run test` verts.
2. **Passe visuelle utilisateur en dev** (bloquante avant PR) : état ouvert et
   replié, focus clavier visible sur le toggle et le ↪, alignement du ↪ avec
   la date, breakpoint mobile.
3. PR avec double revue CodeRabbit habituelle — le bot avait offert de
   re-regarder ce refactor (« happy to take another look »).

## Hors périmètre

- Aucun changement de comportement fonctionnel (repli, transfert).
- Bandeaux d'images, corps du message, pièces jointes : intacts.
- Le pattern « toute la ligne cliquable » (stretched-link) — écarté.
