# Champs destinataires de la réponse rapide — Design

**Date** : 2026-07-08
**Origine** : retour d'utilisation prod v0.1.46 — dans le transfert, la zone de
saisie du destinataire est difficile à identifier (input sans label ni
bordure) ; il manque les options Cc et Cci.
**Statut** : validé en brainstorming.

## Problème

L'éditeur de réponse rapide (`src/components/mail/quick-reply.tsx`) place le
champ destinataire (`.qr-to`) dans son en-tête sous forme d'input **sans
label, sans bordure, sans fond** (`mail.css` : `border: none; background:
none`) — invisible tant qu'on ne clique pas dessus. Et il n'expose ni Cc ni
Cci, alors que `ComposerDraft.cc`/`bcc` existent et que la chaîne d'envoi les
parse et les valide déjà.

## Décisions

1. **Champ À identifiable dans les trois modes** (reply, replyAll, forward) :
   label « À » visible + champ avec fond/bordure/focus, dans l'en-tête.
2. **Cc/Cci en mode transfert uniquement** (décision utilisateur) : bascules
   dans l'en-tête révélant des rangées labelées sous l'en-tête. Reply et
   Répondre à tous gardent l'en-tête épuré, sans bascules.
3. **Conséquence assumée** : en « Répondre à tous », le `cc` pré-rempli par
   `buildReplyContext` continue d'être envoyé sans être affiché (comportement
   actuel, inchangé).
4. Disposition « hybride » retenue : À reste dans l'en-tête (compacité) ;
   seules les rangées Cc/Cci s'ajoutent sous l'en-tête à la demande.
   L'alternative « rangées labelées pour tout, comme le grand Composer » a
   été écartée (une ligne de plus en permanence).

## Maquette (mode transfert)

```
│ ↪ Transférer   À [____________]  Cc  Cci   ✕ │
├──────────────────────────────────────────────┤
│ Cc  [_______________________]   (si activé)  │
│ Cci [_______________________]   (si activé)  │
│ [puces PJ] / éditeur…                        │
```

Reply / Répondre à tous : même en-tête sans les boutons Cc/Cci.

## UI (`quick-reply.tsx`)

- **En-tête** : icône mode + titre + label « À » (clé existante
  `mail.compose.to`, rattaché à l'input par `htmlFor`/`id`) + input `.qr-to`
  restylé + `{mode === "forward"}` → boutons bascules **Cc** et **Cci**
  (pattern exact du grand Composer : bascules indépendantes, boutons texte
  `icon-btn sm`, clés existantes `mail.compose.cc`/`mail.compose.bcc`,
  masqués une fois leur rangée ouverte) + bouton fermer.
- **Rangées révélées** (forward uniquement) : une rangée par champ activé —
  label (Cc/Cci) + input relié (`htmlFor`/`id`), branchée sur
  `onPatch({ cc })` / `onPatch({ bcc })`.
- **États** : `showCc`/`showBcc` en état local du composant (comme
  `showFormat`), réinitialisés à **chaque ouverture** de brouillon via le
  compteur `draftKey` exposé par le hook (incrémenté par `openReply`/
  `openForward`, jamais par les patchs). Le composant reste monté et une
  nouvelle cible peut remplacer l'ancienne sans passer par une fermeture —
  `draftKey` couvre ce cas, contrairement au reset historique sur
  `draft` devenant `null` (retour de revue PR #142). Cci n'est jamais
  pré-rempli. (En forward, `cc` arrive toujours vide de
  `buildForwardContext` — pas de règle d'ouverture automatique nécessaire.)
- **Seule extension** au hook `useQuickReplyDraft` : l'exposition de
  `draftKey` (incrémenté par `openReply`/`openForward`). `ComposerDraft` et
  la chaîne d'envoi restent inchangés : `draft.cc`/`draft.bcc` existent,
  `useComposer.send` les parse (`parseAddressList`) et `sendMailSchema` les
  valide déjà.

## Styles (`mail.css`)

- `.qr-to` : fond `var(--surface-2)`, bordure `1px solid var(--line)`,
  border-radius, padding horizontal, focus `border-color: var(--accent)` —
  mêmes tokens que les inputs du Composer/`.dc-field`. L'affordance visuelle
  est le cœur du correctif.
- `.qr-head label` : style discret aligné sur les labels du Composer.
- Nouvelles rangées `.qr-field` : label court + input, padding horizontal
  aligné sur `qr-head`, séparateur bas cohérent.
- Breakpoint mobile (`@container app (max-width: 639px)`) : mêmes ajustements
  compacts que les règles quick-reply existantes.

## Tests (`quick-reply.test.tsx`)

- Le champ À est requêtable par son label (`getByLabelText`) et éditable —
  dans les trois modes.
- Forward : les bascules Cc/Cci sont présentes ; cliquer Cc révèle la rangée
  et la saisie part dans `onSend` (`draft.cc`) ; idem Cci (`draft.bcc`) ; une
  bascule ouverte masque son bouton.
- Reply et replyAll : **aucun** bouton Cc/Cci rendu.
- Fermeture (`onClose`) puis réouverture : les rangées Cc/Cci sont refermées
  (états réinitialisés).
- Non-régression : envoi, puces de pièces jointes, absence de bouton
  Transférer dans la barre.

## Hors périmètre

- Autocomplétion d'adresses, validation visuelle en cours de frappe (la
  validation reste à l'envoi, comportement actuel).
- Le grand Composer (déjà conforme).
- Affichage du `cc` pré-rempli en Répondre à tous (décision : non affiché).
