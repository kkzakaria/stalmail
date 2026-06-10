# Stalmail Setup Wizard UI — Design (Plan 2b)

> Suite du **Plan 2a** (backend, mergé en v0.1.3). Construit l'UI React du wizard
> par-dessus les server functions et modules `src/server/` existants.
> Références : `2026-06-09-setup-wizard-design.md` (design fonctionnel),
> `2026-06-09-stalwart-api-capture.md` (API v0.16), et le repérage 2b ci-dessous.

## 1. Périmètre

Construire le wizard de configuration first-run (les 9 écrans), l'i18n FR/EN, la
validation de formulaires, et les server functions restantes qui pilotent Stalwart
en mode normal (compte, DNS, ACME, finalisation). **Hors scope :** webmail, auth
OAuth utilisateur (Plans 3/4).

Le plan est **scindé en deux** à la frontière du redémarrage Stalwart :
- **2b-i** — fondations (i18n, TanStack Form/Zod, composants shadcn) + shell wizard
  + 5 étapes de collecte + submit Bootstrap + écran de redémarrage.
- **2b-ii** — phase monitoring (compte, DNS + grille, SSL) + Terminé + server
  functions restantes + durcissement recovery-admin.

## 2. Repérage 2b (faits vérifiés empiriquement, v0.16.8)

- **Aucun statut DNS natif par-record.** L'enum `DnsPublishStatus` existe mais n'est
  exposé sur **aucun champ interrogeable**. → La grille par-record (étape 7) est
  reconstruite côté BFF avec `parseZoneFile` + `resolveRecordStatus` (déjà livrés au
  2a), complétée par le statut **global** de la task `DnsManagement`.
- **ACME = objets explicites.** Aucun `AcmeProvider` par défaut après bootstrap. Le
  wizard doit :
  1. créer un **`x:AcmeProvider`** : `directory` (URL ACME, ex. Let's Encrypt),
     `contact`, `challengeType` (`TlsAlpn01` | `Dns01` | `Http01` | `DnsPersist01`),
     `renewBefore` ;
  2. mettre **`Domain.certificateManagement = { @type: "Automatic", acmeProviderId,
     subjectAlternativeNames: [hostname] }`** (variante `Automatic` =
     `x:CertificateManagementProperties`).
  Cela planifie une task **`AcmeRenewal`** (statut `Pending`/`Retry`/`Failed`),
  monitorée via `x:Task`. `Domain.certificateManagement` vaut `Manual` par défaut.

## 3. Ajouts de stack

- **`@tanstack/react-form` + `zod`** : un schéma zod par étape, réutilisé pour le
  `.validator()` des server functions (corrige le validateur trivial relevé par
  CodeRabbit au 2a).
- **i18n : `i18next` + `react-i18next`** (+ détecteur de langue). Bundles JSON
  **FR (défaut) + EN**, langue persistée en **cookie** (`stalmail_lang`), init
  SSR-aware côté TanStack Start (la langue est résolue avant le rendu pour éviter le
  flash d'hydratation). Sélecteur de langue à l'étape 1.
- **Composants shadcn** à générer : `input`, `label`, `card`, `select`, `alert`,
  `badge`, `separator`, `progress`, `skeleton`. (Le wizard utilise des erreurs
  inline, pas de toast.)

## 4. Architecture du wizard

- **Route unique `/setup`** (le shell `src/routes/setup/index.tsx` actuel est
  remplacé). Un composant `<SetupWizard>` :
  - charge l'étape via la server function `getStep()` (autorité = état réel Stalwart) ;
  - tient un `currentStep` interne qui avance à chaque succès d'étape ;
  - rend le composant d'étape actif (`switch(step)`).
- **Indicateur de progression** (stepper) reflétant les 9 étapes, regroupées en
  « Configuration » (collecte) et « Activation » (monitoring).
- **Composants d'étape isolés** : chacun reçoit ses données + un callback `onNext`
  (et `onBack` pour les étapes de collecte). Un composant = une responsabilité.

### Gestion d'erreur (le backend lève sur erreur JMAP)

- Chaque appel de server function est encapsulé. Une erreur (`JmapError`,
  `WeakPasswordError`, réseau) affiche un **panneau `alert` inline** dans l'étape,
  avec le message et un bouton **Réessayer** ; l'étape ne progresse pas.
- Un `errorComponent` au niveau de la route `/setup` attrape l'inattendu (écran
  d'erreur générique + rechargement).
- `WeakPasswordError` (étape 4) → message dédié sous le champ mot de passe.

### Écran de redémarrage (transition bootstrap → mode normal)

Après le submit Bootstrap (fin de l'étape 5), Stalwart écrit la config et le BFF
déclenche le redémarrage du process. L'UI affiche un écran **« Configuration en
cours — redémarrage du serveur… »** qui *poll* `getStep()` toutes les ~2 s. Quand
l'étape dérivée passe de `collect` à `account`, le wizard continue automatiquement.
Timeout doux ~90 s → message + bouton Réessayer (le poll est idempotent).

## 5. Les 9 étapes

### Phase collecte (aucune mutation Stalwart ; validation locale zod)

| # | Écran | Contenu |
|---|---|---|
| 1 | Bienvenue | Sélecteur de langue (FR/EN), titre, bouton Commencer. |
| 2 | Domaine | `serverHostname` + `defaultDomain` (zod : format hostname). Vérification A-record **optionnelle, non bloquante** (warning si le hostname ne résout pas vers ce serveur). |
| 3 | Provider DNS | `select` parmi les 70 providers (`DNS_PROVIDERS`) + **Manuel**. Si provider : champ `secret` (clé API). |
| 4 | Compte admin | `name` (local-part) + email affiché (dérivé) + mot de passe avec **mètre de force** (indicatif ; le serveur tranche). |
| 5 | Récap | Récapitulatif → bouton **Configurer** → `submitBootstrapFn` → écran redémarrage. |

### Phase monitoring (mode normal)

| # | Écran | Contenu |
|---|---|---|
| 6 | Compte admin | `createAdminAccountFn(name, domainId, password)`. `WeakPasswordError` → retour saisie. |
| 7 | DNS | **Mode automatique** : `createDnsServerFn(provider, secret)` puis `setDnsManagementFn(domainId, dnsServerId, origin)` → **grille par-record live** (`dnsGridStatusFn` : parse `dnsZoneFile` + `resolveRecordStatus`, polling ~5 s) + statut global task. **Mode Manuel** : affichage de `dnsZoneFile` à copier (bouton copier), pas de `DnsServer`. |
| 8 | SSL | `configureAcmeFn(domainId, hostname, contactEmail)` : crée `AcmeProvider` (Let's Encrypt) + `certificateManagement=Automatic`. `acmeStatusFn` *poll* la task `AcmeRenewal`. **Non-bloquant** : bouton **Continuer** actif même si `Pending`/`Failed` (Stalwart réessaie ; `:8080/admin` reste accessible). |
| 9 | Terminé | Récap (domaine, SSL, compte). Rappel backup `stalmail-data`. `finishSetupFn` → `markSetupComplete()`. Bouton **Ouvrir ma boîte mail** → `/login`. |

## 6. Server functions à ajouter

Toutes co-localisées dans `src/server/setup-actions.ts` (extension du 2a), avec un
**validateur zod** chacune. La logique sous-jacente existe déjà (modules 2a).

| Server function | Backend appelé (2a) |
|---|---|
| `getStep` / `submitBootstrapFn` | existants |
| `createAdminAccountFn` | `createAdminAccount` |
| `createDnsServerFn` | `createDnsServer` (+ `DNS_PROVIDERS`) |
| `setDnsManagementFn` | `setDnsManagementAutomatic` |
| `dnsGridStatusFn` | `getPrimaryDomain` (`dnsZoneFile`) → `parseZoneFile` → `resolveRecordStatus` |
| `configureAcmeFn` | nouveau module `stalwart-acme.ts` (`x:AcmeProvider/set` + `x:Domain/set certificateManagement`) |
| `acmeStatusFn` | nouveau : `x:Task/query`+`get` filtré `AcmeRenewal` |
| `finishSetupFn` | `markSetupComplete` |

`configureAcmeFn`/`acmeStatusFn` ajoutent un petit module `src/server/stalwart-acme.ts`
(testé en unitaire avec jmap mocké, comme les autres modules 2a).

## 7. Tests

- **Server functions / `stalwart-acme.ts`** : unitaires, jmap mocké (pattern 2a,
  `importActual` + `expectResult`).
- **Composants d'étape** : `@testing-library/react` (déjà présent) — validation zod,
  transitions `onNext`/`onBack`, états d'erreur (`alert` + Réessayer), `WeakPasswordError`.
- **Wizard shell** : rendu de l'étape selon `getStep`, écran de redémarrage (poll
  mocké), `errorComponent`.
- **i18n** : smoke que les clés FR/EN se résolvent (pas de clé manquante).

## 8. Durcissement recovery-admin (2b-ii)

Le credential `STALWART_RECOVERY_ADMIN` ne doit pas rester exposé indéfiniment (note
sécurité du 2a). Mécanisme retenu : **l'entrypoint n'exporte le recovery-admin que
si le flag `.stalmail-configured` est absent**. Pendant tout le wizard (flag absent)
le BFF garde l'accès management ; une fois `finishSetupFn` exécutée (flag posé), au
**prochain redémarrage** du container Stalwart n'est plus joignable en recovery-admin
sur `:8080`. (L'accès management post-setup relèvera de l'auth OAuth — Plan 3 ; le
webmail n'en a pas besoin.) Conséquence : aucune coupure pendant le wizard, le
durcissement prend effet au redémarrage suivant.

## 9. Découpage des plans

**Plan 2b-i — Fondations & collecte**
- i18n (i18next/react-i18next, bundles FR/EN, cookie, SSR init, sélecteur).
- TanStack Form + Zod ; composants shadcn ; `<SetupWizard>` shell + stepper +
  `errorComponent` + écran de redémarrage.
- Étapes 1–5 (collecte) + intégration `getStep`/`submitBootstrapFn`.
- Livrable testable : collecte → submit Bootstrap → écran redémarrage atteignant le
  mode normal à l'étape `account`.

**Plan 2b-ii — Monitoring & finalisation**
- Server functions restantes + `stalwart-acme.ts`.
- Étapes 6 (compte), 7 (DNS + grille live), 8 (SSL non-bloquant), 9 (Terminé).
- Durcissement recovery-admin (entrypoint gate sur le flag).
- Livrable testable : wizard complet de bout en bout (idéalement validé par le smoke
  image du 2a étendu).

## 10. Hors scope

Webmail (Sidebar/Liste/Lecteur/Composer), auth OAuth utilisateur, calendrier/contacts
— Plans 3/4. Le wizard se termine sur un redirect vers `/login` (shell existant).
