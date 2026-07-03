# Stalmail — Gating DMARC de l'allowlist images + durcissements (#126) — Design Document

**Date :** 2026-07-03
**Statut :** validé en brainstorming, prêt pour le plan d'implémentation.
**Périmètre :** conditionner l'upgrade `sender-allowed` (auto-affichage des images d'un expéditeur de confiance) à l'authentification du message (verdict DMARC), avec exemption pour le courrier interne ; + 2 mineurs de la revue #70 (purge des prefs à la suppression de compte, rate-limit des mutations d'allowlist). Traite [#126](https://github.com/kkzakaria/stalmail/issues/126).
**Dépendances :** #70 livré (v0.1.42/0.1.43) : `image-prefs.ts` (`resolveImageDecision`/`applyImagePrefs`), `image-prefs-store.ts`, `buildReadThreadCalls`/`parseThreadDetail`/`readThreadFn`, `trustSenderFn`/`untrustSenderFn` ; patron `send-rate-limit.ts`.

## 1. Problème

L'allowlist « Toujours afficher les images de X » est keyée sur l'en-tête **From affiché** (`from[0].email`), falsifiable. Un mail usurpant l'adresse d'un expéditeur de confiance et passant les filtres déclenche l'**auto-chargement de ses images distantes** (pixels de tracking) sans clic. Risque accepté et documenté à la livraison de #70 (spec §8) ; ce cycle le ferme.

Impact borné : vie privée uniquement — aucune exécution JS possible (iframe sandbox sans `allow-scripts`, CSP `default-src 'none'`, seul `img-src` est élargi).

## 2. Faits établis (recherche doc)

- **Stalwart ajoute `Authentication-Results`** (résultats DMARC, DKIM, SPF, ARC, iprev) via `addAuthResultsHeader` — par défaut **uniquement `local_port == 25`** (SMTP entrant). `dmarcVerify` par défaut : `relaxed` sur port 25 (verdict reporté dans l'en-tête), `disable` ailleurs. Sources : doc Stalwart « DATA stage » et « DMARC ».
- **Conséquence** : le courrier **interne** (soumission authentifiée, ports 587/465) n'a **pas** d'`Authentication-Results` → pas de verdict. Politique dédiée requise (§3.3).
- **JMAP (RFC 8621 §4.1.2)** : tout en-tête est récupérable via `header:Authentication-Results:asText:all` — tableau de toutes les instances **dans l'ordre du message**. Sans `:all`, JMAP renvoie la **dernière** instance (la plus ancienne, les en-têtes étant préfixés à chaque saut) — piège à éviter.
- La doc Stalwart ne garantit **pas** la suppression des `Authentication-Results` entrants (forgeables). Anti-spoof par **ordre des instances** : sur le port 25 Stalwart préfixe le sien → la **première instance = la nôtre**, toute instance forgée est en dessous.

## 3. Décisions architecturales

### 3.1 Source du verdict : en-tête `Authentication-Results`, première instance

Approche retenue (vs re-vérifier DMARC nous-mêmes — redondant avec le MTA ; vs `dmarcVerify: strict` côté Stalwart — change la politique de réception de tout le serveur, hors de portée du webmail, mentionnable comme durcissement opérateur optionnel).

`buildReadThreadCalls` fetch en plus `"header:Authentication-Results:asText:all"`. Zéro appel réseau supplémentaire, zéro config Stalwart requise.

### 3.2 Parseur pur — `src/server/auth-results.ts`

```
parseDmarcVerdict(headers: string[] | null | undefined): "pass" | "fail" | "none"
```

- Prend `headers[0]` (**première instance**, ordre du message — la nôtre, cf. §2).
- Extrait la clause `dmarc=<résultat>` (RFC 8601) : insensible à la casse, tolérant aux commentaires parenthésés et aux espaces.
- `dmarc=pass` → `"pass"` ; toute autre valeur (`fail`, `none`, `temperror`, `permerror`…) → `"fail"` ; pas d'instance ou pas de clause `dmarc=` → `"none"`.
- **Pas de vérification d'authserv-id en v1** : la première instance est la nôtre par construction (port 25). Une **sonde sur un mail réel** (JMAP, boîte de prod) à l'implémentation confirme le format exact produit par Stalwart avant d'écrire les fixtures.

### 3.3 Politique « exemption locale » pour le courrier sans verdict

Décision utilisateur (option 1) :

| `authVerdict` | Upgrade `sender-allowed` (si expéditeur allowlisté) |
|---|---|
| `"pass"` | ✅ autorisé |
| `"fail"` | ❌ jamais |
| `"none"` (pas d'A-R) | ✅ **seulement si** domaine de `from[0]` === domaine du compte de session (`localDomain`) |

Justification : une usurpation **externe** d'une adresse locale arrive par le port 25 → reçoit notre A-R → nos domaines publient DMARC (créé par le wizard) → `fail` → bloquée. Contourner l'exemption exige une soumission authentifiée = déjà un compte du serveur.

Limites documentées :
- **Domaine expéditeur sans politique DMARC publiée** : l'A-R contient `dmarc=none` → mappé sur `"fail"` (§3.2) → jamais d'upgrade pour ces expéditeurs. Voulu : sans DMARC, rien ne protège contre l'usurpation de ce domaine, l'auto-affichage serait vide de sens. Le consentement **par-message** reste disponible pour eux.
- Serveur **multi-domaines** : un expéditeur interne d'un *autre* domaine hébergé retombe en fail-closed (`none` + domaine ≠ compte). Rare, direction sûre ; à élargir si besoin réel (liste des domaines via admin API + cache).
- **Résiduel** : un compte local malveillant usurpant le From d'un autre compte local via la soumission (Stalwart impose normalement l'alignement expéditeur en soumission). Accepté.

### 3.4 Types et flux

- `AppMessage.authVerdict?: "pass" | "fail" | "none"` — posé par `parseThreadDetail` (depuis le header fetché), consommé par `resolveImageDecision`. Exposé au client : informatif, sans risque (pourrait servir à un badge plus tard). Absent (factories de test) ⇒ traité comme `"none"`.
- `resolveImageDecision(prefs, message)` : `prefs` devient `{ allowedSenders: string[]; localDomain: string }` (type `ImagePrefs` étendu). `localDomain` = domaine de l'`accountName` de `requireSession()`, fourni par `readThreadFn` — jamais du client.
- La logique d'upgrade (§3.3) vit dans `resolveImageDecision` (pur, testé en matrice). `applyImagePrefs` inchangé dans sa forme (passe `prefs` enrichi).
- Le **keyword par-message** (`stalmail_showimages`) est **inchangé** : consentement explicite par message, non gouverné par le verdict.

### 3.5 UI : aucune modification

« Toujours afficher pour X » reste cliquable même sur un mail `fail` — le trust s'enregistre et s'appliquera aux mails **authentifiés** de X (comportement correct). Un badge/explication éventuel = itération future (le champ `authVerdict` exposé le permet).

### 3.6 Mineur A — purge des prefs à la suppression de compte : constat

**Aucun flux de suppression de compte n'existe dans l'app** (gestion des comptes = Stalwart admin ; `logoutAllForAccount` n'a aucun appelant, et y câbler la purge serait faux — les prefs doivent survivre au logout, c'est la feature). Résolution : commentaire sur `deleteAllForAccount` (image-prefs-store) désignant le futur flux de gestion de comptes comme point de câblage ; pas de code mort ajouté. Le point reste tracé pour la phase settings/admin.

### 3.7 Mineur B — rate-limit des mutations d'allowlist

Nouveau `src/server/image-prefs-rate-limit.ts`, **calqué sur `send-rate-limit.ts`** (fenêtre glissante en mémoire, par compte, `consumeSlot` atomique, `__resetForTest`) : `MAX_PREFS_MUTATIONS = 60` par fenêtre de `60 min`. Appliqué en tête de `trustSenderFn` **et** `untrustSenderFn` (avant tout `await`), dépassement → erreur générique existante (« mail action failed »). Les fns keyword (`showImagesOnceFn`/`hideImagesFn`) ne sont **pas** limitées ici (bornées par JMAP/Stalwart, pas d'écriture disque locale).

## 4. Fonctions pures (testées isolément)

- `parseDmarcVerdict` (§3.2) — nouveau module `auth-results.ts`.
- `resolveImageDecision` (matrice verdict × allowlist × domaine local) — signature étendue.
- `senderDomain(email: string): string` (extraction du domaine, lowercase — helper dans `image-prefs.ts`).
- Rate-limit : fonctions pures/isolées du module (miroir de `send-rate-limit`).

## 5. Sécurité

- **Anti-spoof** : première instance A-R uniquement (les forgées sont en dessous de la nôtre) ; fixture de test dédiée « header forgé en 2ᵉ position ignoré ».
- **Fail-closed** partout : verdict illisible/absent → `none` → exemption locale stricte sinon pas d'upgrade ; `authVerdict` absent → `none`.
- `localDomain` dérivé de la session côté serveur, jamais du client.
- Rate-limit consommé atomiquement avant tout `await` (même raison que `consumeSendSlot`, cf. CodeRabbit #7 historique).
- Revue sécurité de branche au cycle, comme d'habitude.

## 6. Tests

- `auth-results.test.ts` : pass/fail/none ; casse mixte ; commentaires RFC 8601 ; clause dmarc absente ; tableau vide/null ; **multi-instances → première seule** ; **forgée en 2ᵉ position ignorée** ; fixtures alignées sur le format réel constaté par la sonde.
- `image-prefs.test.ts` : matrice `resolveImageDecision` (pass+allowlisté ✅ ; fail+allowlisté ❌ ; none+même domaine ✅ ; none+domaine externe ❌ ; non-allowlisté ❌ quel que soit le verdict ; précédence keyword inchangée) ; `senderDomain`.
- `mail-actions.test.ts` : property `header:Authentication-Results:asText:all` présente dans `buildReadThreadCalls` ; `parseThreadDetail` pose `authVerdict`.
- `image-prefs-rate-limit.test.ts` : miroir de `send-rate-limit.test.ts` (cap, fenêtre, atomicité, reset).
- Handler : `trustSenderFn` refuse au-delà du cap (erreur générique).

## 7. Hors périmètre

- Badge UI « authentifié / non authentifié » (le champ `authVerdict` le permet plus tard).
- Élargissement multi-domaines de l'exemption locale (liste admin + cache) — si besoin réel.
- `dmarcVerify: strict` côté Stalwart (durcissement opérateur, hors webmail).
- Sanitisation transverse des logs serveur (chore séparé, cf. skip CodeRabbit #128).
