# Design — Surfaçage de l'échec de publication `DnsManagement` dans le wizard (#62)

Date : 2026-06-30 · Réf. issue : #62 · Modèle : #59 (ACME `AcmeRenewal`).

## Problème

À l'étape DNS du wizard (chemin auto), `DnsStep` enchaîne
`createDnsServer → setDnsManagement(Automatic) → grille`, puis valide **uniquement
par résolution DNS live** (`dnsGridStatusHandler` → `resolveRecordStatus`). Cette
validation est satisfiable par du **cache DNS** ou des enregistrements pré-existants.
Le statut réel de la tâche `DnsManagement` de Stalwart n'est **jamais** contrôlé.

Conséquence (constatée en validation réelle) : avec un **token Cloudflare invalide**,
Stalwart ne publie rien (tâche `DnsManagement` = `Failed`), mais la grille affiche
« verified » (via cache des enregistrements statiques déterministes tout juste
supprimés ; seul le DKIM, à clé fraîchement régénérée, dénote). L'opérateur croit la
config réussie alors que rien n'est publié — ça casse à l'expiration du cache.

C'est le même angle mort que celui corrigé pour l'ACME dans #59.

## Vérification empirique (probe live, getstalmail.com, 2026-06-30)

Probe en pilotant le recovery-admin JMAP (`x:Task/query`+`/get`), token valide puis
invalide. Résultats (consignés en mémoire `stalwart-dnsmanagement-task-schema`) :

- La tâche `DnsManagement` a un `status` **enveloppe `{"@type": …}`** (pas une string
  plate) :
  - `Pending` : `{ "@type":"Pending", createdAt, due }`
  - `Failed`  : `{ "@type":"Failed", createdAt, failedAt, failedAttemptNumber,
    failureReason }`. `failureReason` est riche (token invalide → `HTTP 403 … "Invalid
    access token"`).
- **Latence worker ~60-90s** : après `setDnsManagement(Automatic)`, la tâche reste
  `Pending` (~80s observés) avant de basculer `Failed` (ou de disparaître si succès).
  Un poll court la rate.
- **Succès = tâche absente** : la tâche d'une publication réussie **disparaît** de la
  liste (records publiés, confirmé sur le DNS autoritatif Cloudflare). Seule une
  tâche en échec **persiste** avec `status.@type === "Failed"`.

→ Mapping : tâche absente → `published` · `Failed` → `failed` · `Pending`/`Retry` →
`pending`.

## Conception

### Côté serveur — calque de `stalwart-acme.ts` (#59)

**Helper pur** `classifyDnsManagement(task)` dans `src/server/stalwart-dns.ts` (regroupe
création DnsServer + statut de publication). Contrairement à `classifyAcmeRenewal`,
**pas de fenêtre temporelle** (publication one-shot, pas de cycle de renouvellement) →
pure sur la tâche seule, sans `nowMs` :

```ts
export type DnsManagementStatus = "pending" | "failed" | "published"

export interface DnsManagementTask {
  "@type"?: string
  status?: { "@type"?: string }
  due?: string
}

export function classifyDnsManagement(
  task: DnsManagementTask | undefined
): DnsManagementStatus {
  if (!task) return "published" // tâche absente → publiée + nettoyée
  if (task.status?.["@type"] === "Failed") return "failed"
  return "pending" // Pending / Retry → en cours
}
```

**Lecture** `getDnsManagementStatus()` : copie ligne à ligne de `getAcmeStatus` —
batch `x:Task/query`+`x:Task/get`, `find(t["@type"] === "DnsManagement")`, →
`classifyDnsManagement`.

**Server-fn** `dnsManagementStatusFn` (GET) dans `setup-actions.ts`, calquée sur
`acmeStatusFn` (lecture non gardée, comme `acmeStatusHandler`) :

```ts
export async function dnsManagementStatusHandler(): Promise<{ status: DnsManagementStatus }> {
  const { getDnsManagementStatus } = await import("./stalwart-dns")
  return { status: await getDnsManagementStatus() }
}
export const dnsManagementStatusFn = createServerFn({ method: "GET" }).handler(
  dnsManagementStatusHandler
)
```

### Côté client — `DnsStep`

Nouvelle phase `"verifying"` insérée dans le chemin auto :
`createDnsServer → setDnsManagement → verifying → grid | error | (timeout → continuer)`.

Effet de poll keyé sur la phase `"verifying"` (calque `SslStep` monitor), intervalle
5s, **deadline 180s** (latence worker ~80-100s observée, variable + rate-limit 429 sur
token invalide → marge) :

- `failed`    → `setErrorCode("SETUP-DNS-PUBLISH-FAILED")` + phase `error`. Le `retry()`
  auto **existant** vide déjà le secret et renvoie au formulaire → ressaisie token.
- `published` → phase `grid`.
- `pending` avant la deadline → continuer à sonder.
- `pending` **au-delà de la deadline (180s)** → `timeout` : on **ne déclare PAS le
  succès** (un timeout n'est pas une publication — sinon on recrée le faux-succès que
  #62 corrige). On pose un état `verifyTimedOut` qui révèle un message « prend plus de
  temps que prévu » + un bouton **« Continuer quand même »** (choix conscient de
  l'opérateur), **et le poll continue** (la tâche reste la source de vérité : elle peut
  encore basculer `failed`/`published`). Jamais de bascule automatique vers la grille.

Le helper pur `nextVerifyPhase` renvoie `"error" | "grid" | "timeout" | "wait"` en
conséquence.

UI phase `verifying` : avant timeout, `inline-status` spinner + « Publication des
enregistrements en cours… (jusqu'à 3 min) » ; après timeout, `Alert` (warning) +
`Button` « Continuer quand même » → `phase = grid`.

La résolution live (`gridStatus`) **reste un complément** (propagation), elle ne
déclare plus le succès à elle seule.

### Câblage & i18n

- `SetupWizard.tsx` : prop `dnsManagementStatus: () => Promise<{ status: DnsManagementStatus }>`,
  ref + wrapper stable `withReauth` (façon `acmeStatus`), passée à `DnsStep`.
- `routes/setup/index.tsx` : `dnsManagementStatus={() => dnsManagementStatusFn()}`.
- `error-code.ts` : ajouter `"SETUP-DNS-PUBLISH-FAILED"` à `KNOWN_CODES`.
- `i18n/resources.ts` (FR) : `wizard.error.codes.SETUP-DNS-PUBLISH-FAILED` = « La
  publication DNS a échoué — vérifiez votre token API et réessayez. » + clé du libellé
  `verifying`.

## Tests (TDD)

**Fonctions pures** (`stalwart-dns.test.ts`, façon `stalwart-acme.test.ts`) :
- `classifyDnsManagement` : `undefined`→`published` ; `status.@type Failed`→`failed` ;
  `Pending`→`pending` ; `Retry`→`pending` ; `status` manquant→`pending`.
- `getDnsManagementStatus` : `jmapCall` mocké renvoyant une liste mixte de tâches → la
  `DnsManagement` est isolée et classifiée.

**Composant** (`DnsStep.test.tsx`) :
- auto + `dnsManagementStatus`→`failed` : affiche `SetupErrorBox` ; `retry` revient au
  formulaire avec secret vidé.
- auto + `published` : affiche la grille.
- auto + `pending` puis timeout (fake timers) : passe à la grille.
- chemin manuel inchangé.

**Handler** (`setup-actions.test.ts`) : `dnsManagementStatusHandler` renvoie le statut
de `getDnsManagementStatus`.

## Hors scope

- Parser/afficher le `failureReason` Cloudflare brut (message générique + ressaisie
  suffisent). *Enhancement* possible ultérieur.
- Chemin manuel (`setDnsManagementManual`) inchangé.
- Logique `dnsGridStatusHandler` / `resolveRecordStatus` inchangée (reste complément).

## Sécurité

- Nouvelle server-fn = **lecture** de tâche admin ; aucun secret/token exposé au client,
  aucun nouveau secret introduit. Calque le profil d'`acmeStatus`. Revue sécurité légère.

## Cycle

Spec (ce document) → plan (`writing-plans`) → TDD → PR + CodeRabbit + revue. Réf. #59.
