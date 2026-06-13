# Stalmail Plan 4a — Mail List — Revue du design (§2 Décisions architecturales)

**Date :** 2026-06-12
**Document revu :** `2026-06-12-plan-4a-mail-list-design.md`
**Périmètre de la revue :** §2.1 Stack de données, §2.3 Fenêtrage à index absolu, §2.5 Alternatives écartées.
**Verdict global :** ✅ Architecture saine, décisions correctement tracées. Aucun blocant. 5 remarques (2 à traiter avant implémentation, 3 à tracer pour 4d), 1 recommandation de trajectoire pour 4d.

---

## 1. Synthèse

Le choix du **fenêtrage à index absolu** (`useQueries` par plage + `useVirtualizer` sur le total) est le bon modèle pour ce périmètre, et le document évite le piège classique de `useInfiniteQuery` avec un raisonnement correct (mémoire non bornée, pas de saut arbitraire, dérive d'offset). Points forts confirmés :

- **Batch JMAP avec back-references** (`Email/query` → `Email/get` → `Thread/get` en un POST) : idiomatique RFC 8621, optimal en round-trips.
- **Promotion de `@tanstack/react-query` en dépendance directe** : hygiène de lockfile correcte.
- **Intégration SSR via `setupRouterSsrQueryIntegration`** plutôt qu'un `QueryClientProvider` nu : évite double-fetch et mismatches d'hydratation.
- **Écart du local-first pour raison de modèle de menace** (IndexedDB en clair sur un produit dont l'argument est la confidentialité) : argument le plus solide du document, avec conditions de réouverture explicites.
- **`use-windowed-threads` comme couche d'isolation** : exactement la bonne abstraction pour la couture 4d (cf. §3 de cette revue).

Le seul risque résiduel structurel est la **fenêtre temporelle 4a→4d** : la liste est vivante dès 4a, mais la stabilité n'arrive qu'en 4d.

---

## 2. Remarques détaillées

### R1 — La dérive d'offset n'est pas éliminée, juste réduite 🟡 *(à tracer dans le doc, mitigations dès 4a)*

Le §2.5 reproche à l'infinite scroll la dérive sur liste vivante, mais le fenêtrage retenu reste du `position`/`limit` serveur : entre 4a et 4d (sans `Email/queryChanges`), un mail entrant décale toutes les positions. Deux plages fetchées à 30 s d'intervalle (`staleTime: 30_000`) peuvent montrer un **doublon ou un trou à la frontière de plage**.

C'est moins grave qu'en append-only — les plages s'auto-corrigent au refetch/éviction, pas d'accumulation d'état incohérent — et acceptable en read-only. Mais :

- Le tableau §2.5 note la 2a « 🟡 stable » : être explicite que **la stabilité réelle n'arrive qu'en 4d**.
- Mitigations peu coûteuses dès 4a : `refetchOnWindowFocus: true` sur les queries de plages, et invalidation de `['threads', folder]` au changement de dossier.

### R2 — `PROVISIONAL_COUNT` : utiliser `mailbox.totalEmails` ✅ *(amélioration simple, avant implémentation)*

La sidebar charge `Mailbox/get` avec `totalEmails` **avant** la liste. Utiliser `mailbox.totalEmails` comme `count` provisoire du virtualizer plutôt qu'une estimation arbitraire :

- C'est une **borne supérieure exacte** (avec `collapseThreads`, le total threads sera ≤ totalEmails).
- Le recalage à l'arrivée de la première plage sera minime, au lieu d'un saut visible de la scrollbar.
- Cas particulier : dossiers virtuels (`starred`) sans mailbox → conserver une estimation par défaut.

### R3 — Tempête de requêtes au fling-scroll 🟡 *(à noter en §7.3, trancher en intégration)*

Avec `count = total` sur 100k threads, un saut ou un scroll rapide fait traverser des dizaines de plages au virtualizer → `neededPages` monte/démonte des queries en rafale. React-query déduplique en cache, mais les requêtes déjà parties partent quand même vers Stalwart. Deux gardes peu coûteuses :

1. **Debounce ~100–150 ms** sur le calcul de `neededPages`.
2. Ne fetcher que les plages **stables après arrêt du scroll** (les skeletons couvrent l'intervalle pendant le mouvement).

### R4 — `queryState` par plage : politique de cohérence à définir pour 4d 🟡 *(une ligne dans §2.3 suffit)*

Le contrat capture `queryState` par page — bien. Mais deux plages fetchées à des moments différents porteront des `queryState` **différents**. La couture `queryChanges` (4d) devra définir une politique : state de référence = le plus récent, mismatch entre plages → invalidation globale du dossier. À tracer dès maintenant dans le §2.3 « couture pour le live » pour ne pas le redécouvrir en 4d.

### R5 — Favoris : `$flagged` inclut corbeille et spam 🔵 *(décision produit, pas forcément 4a)*

`{ hasKeyword: "$flagged" }` seul remontera les mails flaggés situés en corbeille et en indésirables. Gmail les exclut ; c'est l'attente utilisateur dominante. Filtre plus conforme :

```json
{ "operator": "AND", "conditions": [
  { "hasKeyword": "$flagged" },
  { "operator": "NOT", "conditions": [
    { "inMailbox": "<trash-id>" },
    { "inMailbox": "<spam-id>" }
  ]}
]}
```

À trancher comme décision produit ; le coût d'implémentation est marginal (les ids trash/spam sont déjà connus via `mailboxesFn`).

---

## 3. Recommandation de trajectoire — l'index d'ids client comme cible 4d

### 3.1 Le constat

Il n'existe pas d'alternative meilleure **au même niveau de complexité** pour le périmètre 4a. Mais il existe une alternative crédible, utilisée par les clients JMAP matures (Fastmail) : **l'index d'ids côté client** (snapshot de la liste).

**Principe :** récupérer la liste complète des ids du dossier (`Email/query` seul, par chunks si le serveur cappe), la garder en mémoire (~20 octets/id → 100k mails ≈ 2 Mo), et résoudre `index → id → Email/get` uniquement pour la fenêtre visible.

| Critère | Fenêtrage offset (2a retenue) | Index d'ids client |
|---|---|---|
| Complexité | ⭐⭐ | ⭐⭐⭐ |
| Dérive sur liste vivante | 🟡 jusqu'à 4d (mitigée) | ✅ **zéro par construction** (snapshot cohérent à un `queryState`) |
| `total` | Ambigu (`calculateTotal` × `collapseThreads`, à valider) | ✅ exact : `ids.length` |
| `Email/queryChanges` (4d) | Invalidation de plages offset (laborieux) | ✅ **trivial** : `added`/`removed` avec positions = le delta conçu pour maintenir ce snapshot |
| Coût initial | Aucun | Chargement de l'index par chunks, gestion d'index partiel, politique de rafraîchissement |
| Saut arbitraire / mémoire bornée | ✅ / ✅ | ✅ / ✅ |
| Cap serveur sur l'id-list | ✅ indépendant | 🟡 redevient un sujet (chunking) |

### 3.2 La recommandation

- **4a : conserver la 2a telle quelle.** Pour une liste read-only sans live, l'index d'ids ferait payer maintenant un coût (moitié « moteur de sync » du local-first, sans IndexedDB donc sans le problème de sécurité, mais avec la logique d'invalidation) dont le bénéfice n'est encaissé qu'en 4d.
- **4d : viser l'index d'ids maintenu par `queryChanges`**, pas `queryChanges` + invalidation de plages offset — qui est la version laborieuse de la même chose. L'architecture l'a déjà prévu : `use-windowed-threads` isole exactement la résolution `index → données` ; la bascule « plage offset fetchée » → « index d'ids maintenu » se fait **derrière cette interface**, sans toucher `ThreadList` ni `ThreadRow`.

### 3.3 Modifications suggérées au document de design

1. **§2.3 « Couture pour le live »** : remplacer l'hypothèse implicite *« 4d = queryChanges sur les plages »* par *« 4d = bascule de la couche de résolution vers un index d'ids maintenu par queryChanges »*.
2. **§2.5 tableau** : ajouter la ligne « **Index d'ids client (snapshot)** | ⭐⭐⭐ | ✅ bornée | ✅ natif (queryChanges) | ✅ | ❌ | **Différée — cible 4d** » pour figer la trajectoire et éviter qu'elle soit re-litiguée ou ignorée en 4d.

### 3.4 Note sur `anchor`/`anchorOffset`

Pas de troisième voie : l'ancrage JMAP (`anchor`/`anchorOffset`) supprime la dérive autour d'un point connu, mais il est **incompatible avec le saut arbitraire à la scrollbar** (il faut connaître l'id d'ancrage avant de fetcher). Il ne convient donc pas au modèle de virtualisation sur `count = total`.

---

## 4. Récapitulatif des actions

| # | Action | Quand | Où |
|---|---|---|---|
| R1 | Expliciter « stabilité réelle en 4d » + `refetchOnWindowFocus` + invalidation au changement de dossier | 4a | §2.5, §7.3 |
| R2 | `count` provisoire = `mailbox.totalEmails` (fallback estimation pour dossiers virtuels) | 4a | §7.3 |
| R3 | Debounce `neededPages` / fetch après arrêt du scroll | 4a (intégration) | §7.3 |
| R4 | Politique de cohérence inter-plages du `queryState` | Tracer en 4a, implémenter 4d | §2.3 |
| R5 | Exclure trash/spam du dossier Favoris | Décision produit | §2.2, §6 |
| T1 | Figer la cible 4d = index d'ids + queryChanges | 4a (doc) | §2.3, §2.5 |
