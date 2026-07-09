# Refermeture des rangées Cc/Cci vides — Design

**Date** : 2026-07-08
**Origine** : retour d'utilisation prod v0.1.47 — dans les composeurs, une
rangée Cc ou Cci révélée puis laissée vide reste ouverte quand on passe à
l'éditeur de message ; elle doit revenir à son état initial (bouton bascule).
**Statut** : validé en brainstorming.

## Décisions

1. **Déclencheur : perte de focus du champ vide** (blur), quelle que soit la
   destination du focus — éditeur, autre champ, bouton. Couvre le cas
   rapporté (« passer à l'éditeur ») et reste prévisible partout. Les
   alternatives écartées : détection de la destination du blur via
   `relatedTarget` (fragile, `null` selon navigateur/cible) ; refermeture à
   l'envoi seulement (ne répond pas au retour — la rangée encombre pendant
   la rédaction).
2. **« Vide » = vide ou espaces uniquement** (`value.trim() === ""`).
3. **Visibilité seulement, jamais les valeurs** : un champ non vide reste
   ouvert ; aucun `onBlur` ne modifie `draft.cc`/`draft.bcc` (un résidu
   d'espaces masqué est inoffensif — `parseAddressList` ignore les segments
   vides à l'envoi).
4. **Effet de bord assumé** : ouvrir la bascule Cci pendant que le champ Cc
   est vide referme la rangée Cc (le clic fait perdre le focus au champ
   vide) — cohérent avec la règle.

## Portée (les deux composeurs)

- **Grand Composer** (`src/components/mail/composer.tsx`) : `onBlur` sur les
  inputs `#cmp-cc` et `#cmp-bcc` → `setShowCc(false)` / `setShowBcc(false)`
  si la valeur est vide. L'initialisation existante
  (`showCc = initial.cc !== ""`, Cc pré-rempli du replyAll) est inchangée ;
  vider ce Cc pré-rempli puis quitter le champ referme la rangée (champ
  vide → règle générale).
- **Réponse rapide** (`src/components/mail/quick-reply.tsx`) : `onBlur` sur
  `#qr-cc` et `#qr-bcc`, même règle. Le reset par `draftKey` (nouvelle
  ouverture de brouillon) reste le mécanisme inter-brouillons ; celui-ci
  agit pendant la saisie d'un même brouillon.

## Implémentation

Quatre handlers d'une ligne, symétriques :

```tsx
onBlur={() => {
  if (draft.cc.trim() === "") setShowCc(false)
}}
```

Zéro CSS, zéro i18n, zéro changement au hook `useQuickReplyDraft`, à
`ComposerDraft` ou au serveur.

## Tests

Par composeur (`composer.test.tsx`, `quick-reply.test.tsx`) :

- Rangée révélée + blur du champ vide → rangée refermée, bouton bascule de
  retour.
- Rangée révélée + saisie d'une valeur + blur → rangée reste ouverte, valeur
  intacte.
- Blur avec espaces uniquement → refermée.
- Grand Composer : Cc pré-rempli (mode replyAll) vidé puis blur → refermé.
- Non-régression : bascules indépendantes, garde forward de la réponse
  rapide, reset `draftKey`.

## Hors périmètre

- Toute modification des valeurs au blur (nettoyage des espaces, etc.).
- Le comportement d'ouverture (bascules, pré-remplissage) — inchangé.
