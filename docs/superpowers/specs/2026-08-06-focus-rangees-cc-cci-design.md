# Focus et repli des rangées Cc/Cci — Design

**Date** : 2026-08-06
**Origine** : vérification navigateur de la prod v0.1.48 (compte de test,
`getstalmail.com`). Le repli livré en v0.1.48 ne se déclenche que si le champ
a reçu le focus ; or l'ouverture par la bascule ne le donne jamais.
**Statut** : validé en brainstorming.
**Remplace** : `2026-07-08-refermeture-cc-cci-vides-design.md` (décisions 1 et 4).

## Le défaut

Mesuré sur la prod, deux parcours au comportement divergent :

| Parcours | Observé |
| --- | --- |
| Ouvrir Cci, **cliquer dans le champ**, le laisser vide, aller à l'éditeur | rangée refermée ✅ |
| Ouvrir Cci, **ne jamais y cliquer**, aller à l'éditeur | rangée vide ouverte indéfiniment ❌ |

Cause : le repli est porté par le `onBlur` de l'input (`quick-reply.tsx:138`
et `152`, `composer.tsx:111` et `125`), mais aucun focus n'est donné à
l'ouverture. Le bouton bascule qui portait le focus est démonté au moment même
où il révèle la rangée : `document.activeElement` retombe sur `BODY`. Sans
focus, pas de blur ; sans blur, pas de repli.

Le second parcours est celui du retour d'utilisation d'origine (« on ouvre Cc,
on change d'avis, on va rédiger »), et c'est aussi un défaut d'accessibilité :
un utilisateur au clavier qui appuie sur Tab après avoir activé « Cc » repart
du haut du document.

Les tests existants (`quick-reply.test.tsx:334`, `composer.test.tsx:112`)
appellent `fireEvent.blur()` directement sur le champ. Ils valident le
*gestionnaire*, jamais le *parcours* — d'où le trou.

## Décisions

1. **Focus automatique à l'ouverture par la bascule.** Le curseur entre dans
   le champ révélé : on saisit l'adresse sans second clic, le focus clavier
   n'est plus perdu, et le blur redevient atteignable.

2. **La règle de repli passe du champ à la zone.** Un unique gestionnaire
   `onBlur` (focusout, qui remonte en React) sur un conteneur englobant la
   rangée « À » et les rangées Cc/Cci :

   > si le focus sort de la zone destinataires
   > (`!e.currentTarget.contains(e.relatedTarget)`), toute rangée Cc/Cci restée
   > vide se referme.

   Ceci **révise la décision 1 du design du 2026-07-08**, qui écartait
   `relatedTarget` comme fragile : le grief visait un test par champ, où un
   `null` inattendu annule le repli. Au niveau de la zone, `relatedTarget` ne
   sert qu'à distinguer sortie et circulation interne, et le cas `null` est
   traité explicitement (décision 4).

3. **Circuler dans la zone ne referme rien.** Passer de Cc à Cci, ou d'un champ
   à une bascule, laisse les rangées en place. Ceci **révise la décision 4 du
   design du 2026-07-08**, qui assumait la fermeture de Cc lors de l'ouverture
   de Cci.

   Cette exemption ne peut pas être implémentée champ par champ : elle
   *diffère* la décision au lieu de l'annuler. Si Cc vide était simplement
   exemptée lors du passage à Cci, plus rien ne la réévaluerait ensuite et le
   défaut d'origine réapparaîtrait par ce chemin. La règle de zone la traite
   sans cas particulier : à la sortie, **toutes** les rangées vides se
   referment d'un coup.

4. **`relatedTarget === null` ne referme rien.** Ce cas correspond à la perte
   de focus de la fenêtre (alt-tab). Refermer alors la rangée pendant que
   l'utilisateur va chercher une adresse ailleurs serait hostile. Le repli
   n'agit que sur une sortie vers un élément identifié — ce qui couvre le cas
   rapporté (sujet, corps du message, bouton Envoyer sont tous focalisables).

5. **Inchangé depuis le design du 2026-07-08** : « vide » signifie vide ou
   espaces uniquement (`value.trim() === ""`) ; le repli touche la visibilité,
   jamais les valeurs du brouillon.

## Portée

- **Grand Composer** (`src/components/mail/composer.tsx`) : zone = rangée « À »
  (avec ses bascules) + rangées Cc/Cci ; le sujet et le corps sont dehors. Le
  focus automatique doit être **restreint aux ouvertures par bascule** :
  `showCc` est initialisé à `initial.cc !== ""` (`composer.tsx:20`), donc une
  réponse à tous arrive avec la rangée Cc déjà ouverte et remplie — lui donner
  le focus au montage volerait le curseur à l'ouverture du composeur.
- **Réponse rapide** (`src/components/mail/quick-reply.tsx`) : même zone
  (en-tête « À » + bascules, puis les rangées). Les rangées y démarrent
  toujours fermées, donc tout montage est une ouverture par bascule : le focus
  automatique y est inconditionnel. Le reset par `draftKey` reste le mécanisme
  inter-brouillons.

## Contrainte de rendu

Le conteneur doit être un vrai élément DOM, or `composer-body-wrap` est une
colonne flex : un `<div>` intercalaire casserait l'espacement des rangées. Le
conteneur portera `display: contents`, qui fournit la frontière d'événements
sans participer à la mise en page. Même précaution côté réponse rapide.

## Tests

Les cas actuels basés sur `fireEvent.blur()` d'un champ jamais focalisé sont
remplacés par des tests de parcours, par composeur :

- Ouverture par la bascule → le champ révélé porte le focus
  (`document.activeElement`).
- Focus déplacé hors zone, champ vide → rangée refermée, bascule de retour.
- Focus déplacé hors zone, champ rempli → rangée conservée, valeur intacte.
- Champ ne contenant que des espaces → refermé.
- Circulation interne (Cc vide → bascule Cci) → **aucune** rangée refermée.
- Détour puis sortie : Cc ouverte vide, Cci ouverte et remplie, focus vers
  l'éditeur → Cc refermée, Cci conservée. *(Le parcours qui échouait.)*
- `relatedTarget` nul → aucune rangée refermée.
- Grand Composer : Cc pré-remplie (replyAll) ne prend pas le focus au montage ;
  vidée puis focus sorti de la zone → refermée.
- Non-régression : bascules indépendantes, garde `forward` de la réponse
  rapide, reset `draftKey`.

## Hors périmètre

- Toute modification des valeurs du brouillon au repli.
- Le comportement d'ouverture des bascules lui-même (quelles rangées existent,
  dans quel mode) — inchangé.
- L'indicateur de focus visuel des inputs du grand Composer (pattern à
  harmoniser avec `.qr-field`, noté au backlog).
