# Refactor du wizard de setup — modèle « collecte + exécution par étape »

> Design validé en brainstorming le 2026-06-23. Cycle : spec → plan → implémentation → revue.

## 1. Contexte & problème

Le wizard de setup actuel suit un modèle **« tout collecter puis tout exécuter »** :

- **Phase « config » (étapes 1-5)** : Welcome, Domaine, **DNS Provider**, Admin, Récap — saisies stockées en **état client** (`data`).
- **Phase « activation » (étapes 6-9)** : Account, **DNS Records**, SSL, Done — exécution des appels JMAP et monitoring.

Ce découpage a un défaut structurel, révélé en validation réelle : le **token DNS** est saisi à l'étape 3 (config, en mémoire client) mais consommé à l'étape 7 (activation). À tout rechargement de page — ou après le redémarrage Stalwart bootstrap→normal — l'état client est **perdu**, la reprise (`deriveSetupStep`) atterrit à l'étape 7 **sans token**, et l'utilisateur doit **repartir de l'étape 3**. La création du DnsServer ne peut pas être ré-tentée là où on reprend.

Plus largement, collecter en masse avant d'exécuter empêche un retour d'erreur **au point de saisie** : un échec d'exécution (ex. le bug du secret DnsServer) survient loin de l'écran où l'utilisateur a saisi la donnée fautive.

## 2. Objectif

Refondre le wizard en **machine linéaire pilotée par l'état serveur**, où **chaque étape collecte SA saisie puis l'exécute** avant de passer à la suivante, en **marche avant** (pas de retour-édition sur une étape exécutée), avec **ré-exécution idempotente** à la reprise. **Configurer l'infrastructure (DNS puis SSL) d'abord, et créer le compte admin en dernière étape de saisie** (juste avant l'écran final).

### Non-objectifs

- Pas de support des providers DNS **multi-credentials** (Route53/Lightsail : `accessKeyId`+`secretAccessKey` ; Tsig : `host`/`keyName`/`key`/algorithme) — le wizard reste sur les providers **à secret unique**. Limite préexistante, évolution UI séparée.
- Pas de modification du backend Stalwart ni des server functions JMAP existantes (mêmes `createDnsServer`, `setDnsManagement`, `createAdminAccount`, `configureAcme`, `finishSetup`) — seul leur **orchestrage** et l'**ordre** changent.
- Pas de retour-arrière éditable sur une étape déjà exécutée (cf. §5).

## 3. Approche retenue (A — pilotée par l'état serveur)

L'étape courante est **toujours dérivée de l'état réel de Stalwart** via `deriveSetupStep`. Chaque étape :

1. **collecte** sa saisie (formulaire local à l'étape, pas d'état global) ;
2. **exécute** son appel JMAP au clic « Suivant » ;
3. en cas de succès, **re-dérive** l'étape → avance ; en cas d'échec, **reste sur l'étape** avec message d'erreur inline + « Réessayer ».

La **reprise** (rechargement, retour après redémarrage) = simple re-dérivation au chargement : aucune donnée sensible n'est conservée côté client entre deux étapes. L'**idempotence** est garantie par construction — une étape ne s'affiche que si sa **précondition serveur** n'est pas remplie.

Approches écartées : **B** (orchestration client, exécution au « Suivant » mais reprise faible) ; **C** (fusion minimale DnsProvider+DnsStep sans généraliser le modèle).

## 4. Séquence cible & contrat par étape

```
Welcome → Domaine [submit → REDÉMARRAGE] → DNS → SSL → Compte → Done
```

| Étape | Collecte | Exécute (au « Suivant ») | Précondition de reprise (`deriveSetupStep`) |
|---|---|---|---|
| **Welcome** | — (intro) | — (avance client) | `bootstrap` |
| **Domaine** | domaine + hostname | `submitBootstrap` → redémarrage Stalwart | `bootstrap` |
| **DNS** | provider + token (ou *Manuel*) | `createDnsServer` + `setDnsManagement` (auto) ; *Manuel* : marque le choix + grille | DNS pas configuré |
| **SSL** | — | `configureAcme` + suivi `acmeStatus` (non bloquant) | DNS ok, `certificateManagement` pas `Automatic` |
| **Compte** | identifiants admin | `createAdminAccount` | pas de compte utilisateur admin |
| **Done** | — | `finishSetup` | tout configuré, setup pas finalisé |

Changements vs aujourd'hui :
- **Récap supprimé** : plus de saisies accumulées non exécutées à récapituler ; le contrôle se fait à chaque étape.
- **Welcome conservé** : écran d'introduction avant le bootstrap (pré-normal).
- **Infra d'abord, Compte en dernier** : ordre `DNS → SSL → Compte` dans `deriveSetupStep`. DNS **doit** précéder SSL (dépendance dure : l'ACME DNS-01 s'appuie sur le `dnsManagement: Automatic`/`dnsServerId`) ; le compte ne dépend de rien et passe en dernier.
- Plus de groupes « config » / « activation » dans le `StepperH` : **une seule séquence linéaire**.

## 5. Reprise, idempotence & marche avant

`deriveSetupStep` reste le **point de vérité unique** de l'étape courante. Nouvel ordre :

```
done      si isSetupComplete()
collect   si isBootstrapMode()          // Welcome + Domaine (sous-état client pré-bootstrap)
dns       si dnsManagement != Automatic ET pas de marqueur `dnsConfigured`
ssl       si certificateManagement != Automatic
account   si pas de compte utilisateur admin
finalize  sinon                          // étape Done : finishSetup → isSetupComplete
```

Signaux serveur « étape franchie » :
- **DNS** = `dnsManagement['@type'] === 'Automatic'` (chemin auto) **ou** marqueur `dnsConfigured` (chemin Manuel, cf. §6).
- **SSL** = `certificateManagement['@type'] === 'Automatic'` (posé par `configureAcme`). Non bloquant sur la validité du cert : dès l'ACME configuré on avance, même si le cert est encore `pending`.
- **Compte** = présence d'un compte utilisateur (non-système).

`finalize` correspond à l'écran **Done** qui appelle `finishSetup` (pose le drapeau `isSetupComplete`) — le compte étant la dernière saisie, c'est lui qui débloque l'étape finale.

- **Marche avant** : une étape exécutée fait avancer la précondition serveur ; on ne revient pas dessus. Le `StepperH` n'expose pas de navigation arrière vers une étape franchie.
- **Ré-exécution idempotente** : si une étape est ré-affichée (rechargement, retry après erreur), elle ré-exécute proprement sans dupliquer :
  - **DNS auto** : si un DnsServer existe déjà mais que la gestion du domaine n'est pas finalisée, l'étape **réutilise/remplace** au lieu de créer un doublon (détecter l'existant via une requête `DnsServer/query`, sinon `create`).
  - **Compte** : `deriveSetupStep` ne quitte `account` qu'une fois un compte **utilisateur** (non-système) présent ; un retry ne crée pas de doublon si le compte existe déjà.
- **Welcome/Domaine** sont en mode bootstrap (pas d'état serveur pour les distinguer) : sous-état **client** simple (`welcome` → `domain`) tant que `deriveSetupStep === 'collect'`.

## 6. Mode DNS « Manuel »

**Tranché (doc officielle v0.16, référence objet Domain).** `dnsManagement` est une union à deux variantes :
- **`Manual`** : *« Manual DNS management. No additional fields. »* → `{ "@type": "Manual" }` ;
- **`Automatic`** : porte les `DnsManagementProperties` (`dnsServerId`, `origin`, `publishRecords`).

(Confirmé aussi par l'exemple CLI : `dnsManagement={"@type":"Manual"}`.)

**Mais** un domaine fraîchement bootstrappé est **déjà non-`Automatic`** (c'est précisément ce qui fait que `deriveSetupStep` renvoie `dns` sur un setup neuf). Donc `@type === 'Manual'` **seul** ne distingue pas l'état **par défaut** du **choix explicite** de l'utilisateur. On ne peut pas s'appuyer uniquement sur la variante.

**Décision** : le chemin Manuel
1. pose explicitement `setDnsManagement({ '@type': 'Manual' })` (cohérence de l'état Stalwart), **et**
2. écrit un **marqueur de progression persistant** `dnsConfigured` (réutilise le mécanisme `setup-flag`/config partagée), consulté par `deriveSetupStep`.

L'étape DNS Manuel affiche la **grille d'enregistrements** (depuis `domain.dnsZoneFile` via `dnsGridStatus`) à recopier chez le registrar, puis un bouton de confirmation qui exécute (1)+(2) et avance.

Le chemin **Automatique** n'a, lui, pas besoin du marqueur : `dnsManagement['@type'] === 'Automatic'` suffit comme signal serveur.

**Incompatibilité connue (préexistante) Manuel + SSL ACME DNS-01** : l'étape SSL (`configureAcme`) requiert un `dnsManagement: Automatic` (un `dnsServerId` pour résoudre le challenge DNS-01). En mode DNS **Manuel**, il n'y a pas de DnsServer → l'ACME DNS-01 du serveur mail n'est pas applicable. L'étape SSL devra donc, en mode Manuel, **être informative/optionnelle** (pas de `configureAcme` automatique ; cert mail à gérer autrement). Ce n'est pas introduit par ce refactor — c'est une limite du couple Manuel+DNS-01 — mais le plan doit définir le comportement de l'étape SSL quand DNS est Manuel (probable : sauter `configureAcme` et marquer SSL comme franchi via le même `dnsConfigured`/un marqueur dédié). Le parcours principal validé (Cloudflare, automatique) n'est pas concerné.

## 7. Redémarrage bootstrap→normal

Le `submitBootstrap` (étape Domaine) déclenche le **redémarrage Stalwart**. Le wizard affiche un écran transitoire **« configuration du serveur… »** (réutilise le mécanisme `restarting`/`pollStep` existant) tant que `getStep()` ne répond pas en mode normal. À la reprise du service, `deriveSetupStep` renvoie `dns` → l'étape DNS s'affiche. C'est l'unique attente longue du parcours, et elle est désormais **juste après la saisie du domaine**, pas après une collecte massive.

## 8. Gestion d'erreur par étape

Chaque exécution peut échouer (ex. token DNS invalide, mot de passe faible). Comportement uniforme :
- message d'erreur **inline** (générique côté UI, sans fuite de détail serveur — cf. R6 du socle) ;
- bouton **« Réessayer »** qui ré-exécute l'action de l'étape ;
- on **reste sur l'étape** (pas d'avance tant que l'exécution n'a pas réussi).

C'est précisément le comportement qui aurait rendu lisible le bug du secret DnsServer.

## 9. Fichiers impactés (cartographie)

- `src/server/setup-state.ts` — `deriveSetupStep` : nouvel ordre (`dns` avant `account`) ; prise en compte du marqueur Manuel.
- `src/components/setup/SetupWizard.tsx` — refonte de l'orchestration : suppression du split config/activation, machine linéaire, exécution par étape, mapping étape→composant, gestion d'erreur/retry, écran de redémarrage entre Domaine et DNS.
- `src/components/setup/steps/` :
  - **Supprimés/fusionnés** : `DnsProviderStep` (fusionné dans l'étape DNS), `RecapStep`, `AdminAccountStep`/`AccountStep` (un seul composant « Compte » collecte+exécute).
  - **Conservés/adaptés** : `WelcomeStep`, `DomainStep` (exécute `submitBootstrap`), `DnsStep` (collecte provider+token **et** exécute), `SslStep`, `DoneStep`.
- `src/server/stalwart-domain.ts` — éventuel `setDnsManagementManual` si variante Manual confirmée ; helper `hasDnsServer`/réutilisation pour l'idempotence.
- `src/i18n/resources.ts` — libellés d'étapes (`wizard.steps.*`), suppression `recap`/`dnsProvider` séparés, réordonnancement ; tout en français via clés `t('...')`.
- `src/components/setup/ui/StepperH.tsx` — séquence linéaire (plus de groupes), nouveau nombre d'étapes.
- Tests : `setup-state.test.ts` (nouvel ordre + Manuel), composants d'étape (collecte+exécution+erreur), `stalwart-dns`/`stalwart-domain` (idempotence).

## 10. Stratégie de test

Conforme aux conventions du projet (fonctions pures testées isolément, composants présentationnels avec props injectées) :
- **`deriveSetupStep`** (fonction pure côté serveur, mocks JMAP) : couvre le nouvel ordre `collect → dns → account → ssl → done`, le cas Manuel, et l'idempotence (étape déjà franchie → on n'y revient pas).
- **Composants d'étape** : rendu présentationnel, props injectées (pas de hooks de route) ; tests de collecte → exécution (succès) → avance, et exécution (échec) → message + retry sans avance.
- **Idempotence DnsServer** : `createDnsServer`/réutilisation ne duplique pas ; test unitaire du helper de détection d'existant.

## 11. Sécurité

- **Token DNS** saisi à l'étape où il est **immédiatement consommé** ; jamais conservé en état client entre étapes ni à travers le redémarrage → réduit la surface (plus de secret en mémoire client en attente). Aucun secret en `localStorage`/cookie.
- Server functions inchangées : validation Zod conservée, enums fermés, pas d'opération JMAP générique exposée.
- Messages d'erreur génériques côté client (pas de fuite du détail JMAP — R6).
- `/setup` reste re-protégé une fois le setup complété (inchangé).

## 12. Risques & points à lever (phase plan)

1. ~~Variante `dnsManagement: Manual`~~ — **tranché** (cf. §6) : la variante `{ "@type": "Manual" }` existe (doc objet Domain v0.16), mais le défaut post-bootstrap étant non-`Automatic`, le chemin Manuel utilise un marqueur `dnsConfigured` persistant en plus de poser la variante.
2. **Idempotence DNS auto** : stratégie exacte de détection/réutilisation d'un DnsServer existant (query par description ? par provider ?) — à préciser dans le plan.
3. **Écran de redémarrage** : réutiliser tel quel le `pollStep`/`restarting` existant, en s'assurant qu'il enchaîne vers `dns` (et non `account`) après le nouvel ordre.
4. **Marqueur `dnsConfigured`** : définir son support exact (extension du `setup-flag` existant vs nouvelle entrée de config partagée) et sa prise en compte dans `deriveSetupStep` — à préciser dans le plan.

## 13. Critères d'acceptation

- Le parcours complet `Welcome → Domaine → DNS → Compte → SSL → Done` fonctionne de bout en bout avec Cloudflare (token saisi et **consommé à l'étape DNS**).
- **Rechargement à n'importe quelle étape** → la reprise revient sur **la même étape**, avec son formulaire, sans « repartir à zéro » ni perte de progression serveur.
- Un échec d'exécution d'étape **reste sur l'étape** avec retry, sans avancer.
- L'ordre **DNS avant Compte** est effectif.
- Tests verts (lint, typecheck, vitest) ; couverture des fonctions pures (`deriveSetupStep`) et des composants d'étape.
