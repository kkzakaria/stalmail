# Topologie mail : noms, certificats, politique MTA-STS — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le certificat de Stalwart couvre le nom sous lequel il se présente, et la politique MTA-STS publiée en DNS devient réellement servie.

**Architecture :** le `serverHostname` cesse d'être dérivé de `STALMAIL_PUBLIC_URL` et se lit à la source, chez Stalwart, via le singleton Bootstrap où le wizard l'a écrit. Un bloc de site Caddy dédié sert la politique MTA-STS depuis `mta-sts.<domaine>` en relayant vers Stalwart, sans exposer quoi que ce soit d'autre. Une variable d'annuaire ACME commune permet d'itérer en staging sans brûler le quota Let's Encrypt.

**Tech Stack :** TypeScript, server functions TanStack Start, vitest, Caddy 2.9, Docker Compose, JMAP (extensions `x:` de Stalwart).

**Spec :** `docs/superpowers/specs/2026-08-07-topologie-mail-design.md` (commit `49c43ce`).

## Global Constraints

- **Bun uniquement** : `bun run lint`, `bun run typecheck`, `bun run test`. Jamais npm/yarn/pnpm.
- Le hook pre-commit (`lint && typecheck && test`) **ne doit jamais être contourné** (pas de `--no-verify`). Il échoue parfois de façon transitoire sous charge : relancer `bun run test` seul pour vérifier avant de conclure à une régression.
- **Ne jamais lancer `bun run format`** : il reformate tout le dépôt. Prettier tourne déjà au pre-commit sur les fichiers indexés.
- Commits **conventionnels en anglais** ; commentaires de code et libellés de test **en français**.
- **i18n** : tout libellé visible passe par `t('...')`, avec la clé ajoutée **à la fois** dans `fr` et dans `en` de `src/i18n/resources.ts` (le type `DeepRecord<typeof fr>` échoue à la compilation sinon).
- **Validation Zod** sur toute entrée de server function ; aucune opération JMAP générique exposée au client.
- `git add` nomme explicitement les fichiers. Jamais `git add -A` / `git add .`.

## Faits établis (vérifiés avant rédaction, ne pas re-découvrir)

1. `getBootstrap()` existe (`src/server/stalwart-bootstrap.ts:30`) : il appelle `x:Bootstrap/get` et renvoie le singleton, celui-là même où `submitBootstrap` écrit `serverHostname` (l. 52). C'est la source autoritaire.
2. L'accès admin nécessaire à cette lecture est disponible pendant tout le setup : `docker/stalwart/entrypoint.sh` ne durcit le port de management qu'**après** la fin du setup, donc après l'étape SSL.
3. `configureAcme` accepte déjà un `directory` de substitution (`src/server/stalwart-acme.ts:16`), mais `configureAcmeHandler` ne le transmet pas.
4. Le `Caddyfile` est unique pour dev et prod : monté par `compose.dev.yml` **et** `compose.prod.yml:71`.
5. Caddy émet automatiquement un certificat interne pour les noms en `.localhost`, sans aucune directive `tls` et sans appel ACME.
6. `install.sh` demande déjà interactivement un argument manquant (`read -rp`, l. 33) et valide le FQDN par une expression régulière (l. 41). Le motif de migration douce d'un `.env` existant est en place pour `STALMAIL_SETUP_TOKEN_HASH` (l. 135-145).
7. `setup-actions.test.ts` teste déjà ce niveau : `resolveServerHostname` (l. 187), `setupContextHandler` (l. 306), `configureAcmeHandler`.

## File Structure

| Fichier | Rôle dans ce plan |
| --- | --- |
| `src/server/stalwart-bootstrap.ts` | **Ajout** de `getServerHostname()` — lecture typée du `serverHostname` dans le singleton Bootstrap. Une responsabilité, testable seule. |
| `src/server/setup-actions.ts` | `resolveMailHostname` (pure, remplace `resolveAcmeHostname`), `configureAcmeHandler`, `setupContextHandler`. |
| `src/server/stalwart-acme.ts` | Inchangé — il accepte déjà `directory`. |
| `src/components/setup/steps/SslStep.tsx` | Avertissement de divergence de domaine. |
| `src/components/setup/SetupWizard.tsx` | Transmission de la valeur d'environnement à `SslStep`. |
| `src/i18n/resources.ts` | Clés de l'avertissement, `fr` **et** `en`. |
| `Caddyfile` | Bloc `mta-sts.*`, option globale `acme_ca`. |
| `compose.prod.yml` | `STALMAIL_MAIL_DOMAIN` (requise), `STALMAIL_ACME_DIRECTORY` (facultative). |
| `.env.example` | Les deux variables, documentées. |
| `install.sh` | Saisie et migration de `STALMAIL_MAIL_DOMAIN`. |

---

### Task 1 : Le SAN suit l'identité mail, lue à la source

**Files:**
- Modify: `src/server/stalwart-bootstrap.ts` (ajout de `getServerHostname`)
- Modify: `src/server/setup-actions.ts:339-342` (renommage de l'appelant webmail), `:422-447` (fonctions de résolution), `:453-472` (`setupContextHandler`), `:473-505` (`configureAcmeHandler`)
- Test: `src/server/stalwart-bootstrap.test.ts`, `src/server/setup-actions.test.ts`

**Interfaces:**
- Consumes : `getBootstrap()` (existant).
- Produces : `getServerHostname(): Promise<string>` et la fonction pure `resolveMailHostname(serverHostname: string, domainName: string): string`, consommées par la Task 4 (l'avertissement lit le même contexte).

- [ ] **Step 1 : Écrire le test de `getServerHostname`**

Dans `src/server/stalwart-bootstrap.test.ts`, ajouter au bloc existant (le fichier moque déjà `./jmap` — reprendre exactement le style de moquage des tests voisins) :

```ts
describe("getServerHostname", () => {
  it("renvoie le serverHostname du singleton bootstrap", async () => {
    jmapCall.mockResolvedValueOnce([
      ["x:Bootstrap/get", { list: [{ serverHostname: "mail.exemple.fr" }] }, "0"],
    ])
    await expect(getServerHostname()).resolves.toBe("mail.exemple.fr")
  })

  it("renvoie une chaîne vide quand le champ est absent", async () => {
    jmapCall.mockResolvedValueOnce([
      ["x:Bootstrap/get", { list: [{}] }, "0"],
    ])
    await expect(getServerHostname()).resolves.toBe("")
  })

  it("renvoie une chaîne vide quand le champ n'est pas une chaîne", async () => {
    jmapCall.mockResolvedValueOnce([
      ["x:Bootstrap/get", { list: [{ serverHostname: 42 }] }, "0"],
    ])
    await expect(getServerHostname()).resolves.toBe("")
  })
})
```

Ajouter `getServerHostname` à l'import depuis `./stalwart-bootstrap` en tête de fichier.

- [ ] **Step 2 : Lancer le test pour le voir échouer**

```bash
bun run vitest run src/server/stalwart-bootstrap.test.ts
```

Attendu : FAIL — `getServerHostname` n'est pas exporté.

- [ ] **Step 3 : Écrire `getServerHostname`**

Dans `src/server/stalwart-bootstrap.ts`, juste après `getBootstrap` (l. 39) :

```ts
/**
 * Nom que le serveur mail annonce (bannière EHLO, cible MX) — la valeur écrite
 * par le wizard au bootstrap. Source autoritaire pour le SAN du certificat :
 * c'est la seule identité que Stalwart ait besoin de prouver sur ses ports mail.
 * Le webmail, lui, est couvert par Caddy.
 */
export async function getServerHostname(): Promise<string> {
  const bootstrap = await getBootstrap()
  const value = bootstrap.serverHostname
  return typeof value === 'string' ? value : ''
}
```

- [ ] **Step 4 : Lancer le test pour le voir passer**

```bash
bun run vitest run src/server/stalwart-bootstrap.test.ts
```

Attendu : 3/3 PASS sur le nouveau bloc.

- [ ] **Step 5 : Écrire les tests de la résolution pure et des handlers**

Dans `src/server/setup-actions.test.ts`, **conserver** le bloc
`describe("resolveServerHostname (pur)")` (l. 187-205) en renommant la fonction
testée et le titre du bloc en `resolveWebmailHostname` — il couvre un
comportement qui existe toujours (voir Step 7). Ajouter **à côté** :

```ts
describe("resolveMailHostname (pur)", () => {
  it("prend le serverHostname quand il est renseigné", () => {
    expect(resolveMailHostname("mail.exemple.fr", "exemple.fr")).toBe(
      "mail.exemple.fr"
    )
  })

  it("retombe sur le nom du domaine quand le serverHostname est vide", () => {
    expect(resolveMailHostname("", "exemple.fr")).toBe("exemple.fr")
  })

  it("ignore STALMAIL_PUBLIC_URL, quelle que soit sa valeur", () => {
    const previous = process.env.STALMAIL_PUBLIC_URL
    process.env.STALMAIL_PUBLIC_URL = "https://webmail.autre.fr"
    try {
      // Le cas qui échoue aujourd'hui : l'hôte du webmail diverge de l'hôte mail.
      expect(resolveMailHostname("mail.exemple.fr", "exemple.fr")).toBe(
        "mail.exemple.fr"
      )
    } finally {
      if (previous === undefined) delete process.env.STALMAIL_PUBLIC_URL
      else process.env.STALMAIL_PUBLIC_URL = previous
    }
  })
})
```

Adapter l'import (l. 21) : `resolveServerHostname` devient `resolveWebmailHostname`, et `resolveMailHostname` s'y ajoute.

Ajouter enfin le cas qui épingle la distinction — c'est elle le cœur du correctif :

```ts
it("les deux résolveurs répondent différemment quand les rôles divergent", () => {
  // L'hôte du webmail et l'identité mail n'ont aucune raison de coïncider :
  // les confondre faisait demander le certificat pour le mauvais nom.
  expect(resolveWebmailHostname("https://webmail.exemple.fr", "exemple.fr")).toBe(
    "webmail.exemple.fr"
  )
  expect(resolveMailHostname("mail.exemple.fr", "exemple.fr")).toBe(
    "mail.exemple.fr"
  )
})
```

Le fichier moque déjà `./stalwart-bootstrap` (l. 44-50) : **y ajouter `getServerHostname`**, sans quoi les nouveaux tests ne pourront pas en contrôler la valeur.

```ts
vi.mock("./stalwart-bootstrap", () => ({
  isBootstrapMode: vi.fn(async () => false),
  submitBootstrap: vi.fn(async () => ({
    username: "admin@exemple.fr",
    secret: "g",
  })),
  getServerHostname: vi.fn(async () => ""),
}))
```

Puis ajouter deux cas de handler, en reprenant les moques de `./stalwart-domain`, `./stalwart-acme` et `./setup-state` déjà présents dans le fichier :

```ts
describe("configureAcmeHandler — SAN", () => {
  it("demande le certificat pour le serverHostname, pas pour l'hôte du webmail", async () => {
    process.env.STALMAIL_PUBLIC_URL = "https://webmail.autre.fr"
    getServerHostname.mockResolvedValue("mail.exemple.fr")
    await configureAcmeHandler({ data: { hostname: "", contactEmail: "" } })
    expect(configureAcme).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "mail.exemple.fr" })
    )
  })

  it("reprise à entrées vides : même SAN qu'au premier passage", async () => {
    getServerHostname.mockResolvedValue("mail.exemple.fr")
    await configureAcmeHandler({ data: { hostname: "", contactEmail: "" } })
    await configureAcmeHandler({ data: { hostname: "", contactEmail: "" } })
    const [first, second] = configureAcme.mock.calls
    expect(second[0].hostname).toBe(first[0].hostname)
  })
})
```

Et pour la ré-hydratation :

```ts
it("setupContextHandler renvoie le serverHostname lu chez Stalwart", async () => {
  process.env.STALMAIL_PUBLIC_URL = "https://webmail.autre.fr"
  getServerHostname.mockResolvedValue("mail.exemple.fr")
  await expect(setupContextHandler()).resolves.toEqual(
    expect.objectContaining({ serverHostname: "mail.exemple.fr" })
  )
})
```

- [ ] **Step 6 : Lancer les tests pour les voir échouer**

```bash
bun run vitest run src/server/setup-actions.test.ts
```

Attendu : FAIL — `resolveMailHostname` n'existe pas, et les handlers utilisent encore `STALMAIL_PUBLIC_URL`.

- [ ] **Step 7 : Remplacer la résolution**

Dans `src/server/setup-actions.ts`, **supprimer** `resolveAcmeHostname`
(l. 439-447), qui n'a plus d'usage.

`resolveServerHostname` (l. 422-434), en revanche, **reste** : elle a un second
appelant, `hostAddressStatusHandler` (l. 339-342), qui s'en sert pour le CNAME
webmail des enregistrements DNS (rôle `"webmail"` dans `dns-host-records.ts`).
C'est un usage légitime et distinct, qui doit continuer de lire
`STALMAIL_PUBLIC_URL`. La **renommer** `resolveWebmailHostname` — corps inchangé,
appelant mis à jour — et lui donner un commentaire qui nomme son rôle, puisque
c'est justement l'ambiguïté de l'ancien nom qui a produit le défaut :

```ts
// Pur : hôte du WEBMAIL, dérivé de STALMAIL_PUBLIC_URL, à défaut le nom du domaine.
// Sert au CNAME webmail des enregistrements DNS (rôle "webmail"). À ne pas confondre
// avec l'identité du serveur mail (bannière EHLO, cible MX, SAN du certificat) :
// celle-là se lit chez Stalwart via resolveMailHostname (design 2026-08-07).
export function resolveWebmailHostname(
  publicUrl: string | undefined,
  domainName: string
): string {
```

Puis écrire à côté :

```ts
// Pur : le nom que le serveur mail annonce. Le `serverHostname` vient de Stalwart
// (singleton Bootstrap), le nom du domaine ne sert que de repli. STALMAIL_PUBLIC_URL
// ne participe PAS : il porte l'hôte du webmail, servi par Caddy, et le confondre
// avec l'identité mail faisait demander le certificat pour le mauvais nom
// (design 2026-08-07).
export function resolveMailHostname(
  serverHostname: string,
  domainName: string
): string {
  return serverHostname || domainName
}
```

Dans `setupContextHandler`, remplacer le calcul du `serverHostname` :

```ts
  const { getServerHostname } = await import("./stalwart-bootstrap")
  return {
    serverHostname: resolveMailHostname(
      await getServerHostname(),
      defaultDomain
    ),
    defaultDomain,
  }
```

Dans `configureAcmeHandler`, remplacer la ligne `const hostname = resolveAcmeHostname(...)` et son commentaire par :

```ts
  // Le SAN suit l'identité mail, lue chez Stalwart : une reprise d'étape (entrées
  // client vides) donne donc le même nom qu'au premier passage.
  const { getServerHostname } = await import("./stalwart-bootstrap")
  const hostname = resolveMailHostname(await getServerHostname(), domain.name)
```

Le paramètre `data.hostname` n'est plus utilisé pour le SAN ; laisser `configureAcmeSchema` inchangé (l'entrée reste acceptée et bornée, elle n'a simplement plus d'effet).

- [ ] **Step 8 : Lancer les tests pour les voir passer**

```bash
bun run vitest run src/server/setup-actions.test.ts src/server/stalwart-bootstrap.test.ts
```

Attendu : PASS. Si un test existant échoue parce qu'il moquait `STALMAIL_PUBLIC_URL` pour obtenir le hostname, c'est un vrai signal : il testait l'ancien comportement, il faut l'adapter à la nouvelle source, pas rétablir l'ancienne.

- [ ] **Step 9 : Vérifier la suite complète**

```bash
bun run test && bun run lint && bun run typecheck
```

- [ ] **Step 10 : Commit**

```bash
git add src/server/stalwart-bootstrap.ts src/server/stalwart-bootstrap.test.ts src/server/setup-actions.ts src/server/setup-actions.test.ts
git commit -m "fix(setup): request the mail certificate for the announced hostname"
```

---

### Task 2 : Annuaire ACME configurable, pour itérer en staging

**Files:**
- Modify: `src/server/setup-actions.ts` (`configureAcmeHandler`)
- Modify: `Caddyfile` (options globales), `compose.prod.yml`, `.env.example`
- Test: `src/server/setup-actions.test.ts`

**Interfaces:**
- Consumes : `configureAcme({ domainId, hostname, contactEmail, directory? })` (existant, `stalwart-acme.ts:11-18`).
- Produces : la variable d'environnement `STALMAIL_ACME_DIRECTORY`, consommée par la Task 6 (validation en staging).

- [ ] **Step 1 : Écrire les tests**

Dans `src/server/setup-actions.test.ts`, ajouter :

```ts
describe("configureAcmeHandler — annuaire ACME", () => {
  it("transmet STALMAIL_ACME_DIRECTORY quand il est défini", async () => {
    process.env.STALMAIL_ACME_DIRECTORY =
      "https://acme-staging-v02.api.letsencrypt.org/directory"
    try {
      await configureAcmeHandler({ data: { hostname: "", contactEmail: "" } })
      expect(configureAcme).toHaveBeenCalledWith(
        expect.objectContaining({
          directory: "https://acme-staging-v02.api.letsencrypt.org/directory",
        })
      )
    } finally {
      delete process.env.STALMAIL_ACME_DIRECTORY
    }
  })

  it("ne transmet aucun annuaire quand la variable est absente", async () => {
    delete process.env.STALMAIL_ACME_DIRECTORY
    await configureAcmeHandler({ data: { hostname: "", contactEmail: "" } })
    const call = configureAcme.mock.calls.at(-1)?.[0]
    expect(call).not.toHaveProperty("directory")
  })
})
```

- [ ] **Step 2 : Lancer les tests pour les voir échouer**

```bash
bun run vitest run src/server/setup-actions.test.ts
```

Attendu : le premier test échoue (`directory` absent de l'appel).

- [ ] **Step 3 : Transmettre l'annuaire**

Dans `configureAcmeHandler`, remplacer l'appel :

```ts
    // Annuaire de substitution (Let's Encrypt staging) pour les validations qui
    // détruisent et refont le déploiement : le quota d'émission de l'annuaire de
    // production est limité, et l'épuiser rend le serveur injoignable en HTTPS
    // pendant une semaine.
    const directory = process.env.STALMAIL_ACME_DIRECTORY
    await configureAcme({
      domainId: domain.id,
      hostname,
      contactEmail,
      ...(directory ? { directory } : {}),
    })
```

- [ ] **Step 4 : Lancer les tests pour les voir passer**

```bash
bun run vitest run src/server/setup-actions.test.ts
```

- [ ] **Step 5 : Câbler Caddy et compose**

Dans `Caddyfile`, à l'intérieur du bloc d'options globales (celui qui contient `default_sni`, l. 24-26), ajouter :

```
	# Annuaire ACME. Par défaut la production Let's Encrypt ; bascule en staging par
	# le .env pour les validations qui détruisent et refont le déploiement.
	acme_ca {$STALMAIL_ACME_DIRECTORY:https://acme-v02.api.letsencrypt.org/directory}
```

Dans `compose.prod.yml`, ajouter la variable aux deux services qui demandent des certificats — le service `caddy` (bloc `environment`, à côté de `STALMAIL_HOSTNAME`) et le service `app` (qui la transmet à Stalwart) :

```yaml
      # Annuaire ACME (facultatif) : laisser vide pour Let's Encrypt production.
      STALMAIL_ACME_DIRECTORY: "${STALMAIL_ACME_DIRECTORY:-}"
```

Dans `.env.example`, à la fin :

```
# Annuaire ACME (facultatif). Vide = Let's Encrypt production. Pour tester sans
# entamer le quota d'émission :
# STALMAIL_ACME_DIRECTORY=https://acme-staging-v02.api.letsencrypt.org/directory
STALMAIL_ACME_DIRECTORY=
```

- [ ] **Step 6 : Vérifier la syntaxe Caddy dans les deux formes**

```bash
docker run --rm -e STALMAIL_HOSTNAME=exemple.fr -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.9.1 caddy validate --config /etc/caddy/Caddyfile
docker run --rm -e STALMAIL_HOSTNAME=exemple.fr -e STALMAIL_ACME_DIRECTORY=https://acme-staging-v02.api.letsencrypt.org/directory -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.9.1 caddy validate --config /etc/caddy/Caddyfile
```

Attendu : `Valid configuration` dans les deux cas.

- [ ] **Step 7 : Vérifier la suite complète et commiter**

```bash
bun run test && bun run lint && bun run typecheck
git add src/server/setup-actions.ts src/server/setup-actions.test.ts Caddyfile compose.prod.yml .env.example
git commit -m "feat(deploy): allow overriding the ACME directory for staging runs"
```

---

### Task 3 : Servir la politique MTA-STS

**Files:**
- Modify: `Caddyfile` (nouveau bloc de site), `compose.prod.yml`, `.env.example`

**Interfaces:**
- Consumes : l'option globale `acme_ca` posée en Task 2.
- Produces : la variable `STALMAIL_MAIL_DOMAIN`, consommée par la Task 4 (avertissement) et la Task 5 (`install.sh`).

- [ ] **Step 1 : Ajouter le bloc de site**

Dans `Caddyfile`, après le site nommé (dernier bloc du fichier), ajouter :

```
# Hôte de politique MTA-STS. La zone Stalwart publie déjà le TXT `_mta-sts` et le
# CNAME `mta-sts` ; sans ce bloc, le nom résout mais aucun site ne répond et le
# handshake TLS échoue — on publiait un enregistrement dont on ne desservait pas la
# politique. Stalwart génère et sert la politique lui-même sur ce chemin.
#
# Rien d'autre n'est exposé sous ce nom : ni webmail, ni wizard, ni surface JMAP.
# Aucune directive `tls` : Caddy émet un certificat interne pour le défaut en
# `.localhost` (stack de dev, pas de domaine mail) et passe à ACME dès que la
# variable porte un vrai domaine.
mta-sts.{$STALMAIL_MAIL_DOMAIN:invalid.localhost} {
	handle /.well-known/mta-sts.txt {
		reverse_proxy stalwart:8080
	}
	handle {
		respond 404
	}
}
```

- [ ] **Step 2 : Déclarer la variable, requise en production**

Dans `compose.prod.yml`, service `caddy`, bloc `environment` :

```yaml
      # Domaine des adresses e-mail (la partie après le @), PAS l'hôte du webmail :
      # c'est lui qui donne l'hôte de politique MTA-STS `mta-sts.<domaine>`.
      STALMAIL_MAIL_DOMAIN: "${STALMAIL_MAIL_DOMAIN:?set STALMAIL_MAIL_DOMAIN in .env (le domaine des adresses, ex. exemple.fr — pas l'hôte du webmail)}"
```

Ajouter la même variable au service `app` (sans `:?`, il l'utilisera en Task 4 pour l'avertissement) :

```yaml
      STALMAIL_MAIL_DOMAIN: "${STALMAIL_MAIL_DOMAIN:-}"
```

Dans `.env.example`, après `STALMAIL_PUBLIC_URL` :

```
# Domaine des adresses e-mail : la partie après le @, PAS l'hôte du webmail.
# Avec STALMAIL_HOSTNAME=mail.getstalmail.com, la valeur attendue ici est
# getstalmail.com. Sert à servir la politique MTA-STS sur mta-sts.<domaine>.
STALMAIL_MAIL_DOMAIN=getstalmail.com
```

- [ ] **Step 3 : Vérifier les deux formes du Caddyfile**

```bash
docker run --rm -e STALMAIL_HOSTNAME=exemple.fr -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.9.1 caddy validate --config /etc/caddy/Caddyfile
docker run --rm -e STALMAIL_HOSTNAME=exemple.fr -e STALMAIL_MAIL_DOMAIN=exemple.fr -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.9.1 caddy validate --config /etc/caddy/Caddyfile
```

Attendu : `Valid configuration` dans les deux cas. Sans la variable, le site s'appelle `mta-sts.invalid.localhost` ; avec, `mta-sts.exemple.fr`.

- [ ] **Step 4 : Vérifier que compose refuse de démarrer sans la variable**

```bash
env -u STALMAIL_MAIL_DOMAIN STALMAIL_SECRET=x STALMAIL_HOSTNAME=exemple.fr STALMAIL_PUBLIC_URL=https://exemple.fr STALMAIL_SETUP_TOKEN_HASH=x docker compose -f compose.prod.yml config >/dev/null
```

Attendu : échec, avec le message « set STALMAIL_MAIL_DOMAIN in .env ». Relancer la même commande en ajoutant `STALMAIL_MAIL_DOMAIN=exemple.fr` : doit réussir.

- [ ] **Step 5 : Vérifier que la stack de dev démarre toujours**

```bash
docker compose -f compose.dev.yml up -d
curl -s -o /dev/null -w '%{http_code}\n' -m 15 http://localhost:3443/login
```

Attendu : `200`. La stack de dev n'a pas de `STALMAIL_MAIL_DOMAIN` : c'est le chemin qui prouve que le défaut `.localhost` fait son office.

- [ ] **Step 6 : Commit**

```bash
git add Caddyfile compose.prod.yml .env.example
git commit -m "feat(deploy): serve the MTA-STS policy from its own host"
```

---

### Task 4 : Avertir quand le domaine saisi diverge du domaine créé

**Files:**
- Modify: `src/server/setup-actions.ts` (`setupContextHandler`)
- Modify: `src/components/setup/SetupWizard.tsx`, `src/components/setup/steps/SslStep.tsx`
- Modify: `src/i18n/resources.ts` (`fr` et `en`)
- Test: `src/server/setup-actions.test.ts`, `src/components/setup/steps/SslStep.test.tsx`

**Interfaces:**
- Consumes : `STALMAIL_MAIL_DOMAIN` (Task 3), `setupContextHandler` (Task 1).
- Produces : rien pour les tâches suivantes.

- [ ] **Step 1 : Écrire le test du handler**

Dans `src/server/setup-actions.test.ts` :

```ts
describe("setupContextHandler — domaine de politique", () => {
  it("renvoie la valeur de STALMAIL_MAIL_DOMAIN", async () => {
    process.env.STALMAIL_MAIL_DOMAIN = "exemple.fr"
    try {
      await expect(setupContextHandler()).resolves.toEqual(
        expect.objectContaining({ mailDomainEnv: "exemple.fr" })
      )
    } finally {
      delete process.env.STALMAIL_MAIL_DOMAIN
    }
  })

  it("renvoie une chaîne vide quand la variable est absente", async () => {
    delete process.env.STALMAIL_MAIL_DOMAIN
    await expect(setupContextHandler()).resolves.toEqual(
      expect.objectContaining({ mailDomainEnv: "" })
    )
  })
})
```

- [ ] **Step 2 : Lancer le test pour le voir échouer**

```bash
bun run vitest run src/server/setup-actions.test.ts
```

Attendu : FAIL — `mailDomainEnv` absent de la réponse.

- [ ] **Step 3 : Exposer la valeur**

Dans `setupContextHandler`, élargir le type de retour et la valeur renvoyée :

```ts
export async function setupContextHandler(): Promise<{
  serverHostname: string
  defaultDomain: string
  // Domaine de politique MTA-STS déclaré dans l'environnement. Exposé au wizard
  // pour signaler une divergence avec le domaine réellement créé : la variable est
  // saisie AVANT que le domaine n'existe, une faute de frappe resterait invisible.
  mailDomainEnv: string
}> {
```

Le retour du chemin bootstrap devient `{ serverHostname: "", defaultDomain: "", mailDomainEnv: "" }`, et le retour nominal ajoute :

```ts
    mailDomainEnv: process.env.STALMAIL_MAIL_DOMAIN ?? "",
```

- [ ] **Step 4 : Lancer le test pour le voir passer**

```bash
bun run vitest run src/server/setup-actions.test.ts
```

- [ ] **Step 5 : Ajouter les clés i18n**

Dans `src/i18n/resources.ts`, dans le bloc `ssl` du français (vers l. 210) :

```ts
      domainMismatch:
        "Le domaine déclaré dans STALMAIL_MAIL_DOMAIN ({{env}}) diffère du domaine créé ici ({{created}}). La politique MTA-STS sera servie sur mta-sts.{{env}}, qui n'est pas votre domaine de messagerie.",
```

Et la même clé dans le bloc `ssl` de l'anglais :

```ts
      domainMismatch:
        "The domain declared in STALMAIL_MAIL_DOMAIN ({{env}}) differs from the domain created here ({{created}}). The MTA-STS policy will be served from mta-sts.{{env}}, which is not your mail domain.",
```

- [ ] **Step 6 : Écrire le test du composant**

Dans `src/components/setup/steps/SslStep.test.tsx`, en reprenant le harnais et les moques déjà présents dans le fichier :

```tsx
it("avertit quand le domaine déclaré diverge du domaine créé", () => {
  renderSslStep({ mailDomainEnv: "autre.fr", defaultDomain: "exemple.fr" })
  expect(screen.getByText(/ssl\.domainMismatch/)).toBeInTheDocument()
})

it("n'avertit pas quand les deux domaines coïncident", () => {
  renderSslStep({ mailDomainEnv: "exemple.fr", defaultDomain: "exemple.fr" })
  expect(screen.queryByText(/ssl\.domainMismatch/)).not.toBeInTheDocument()
})

it("n'avertit pas quand la variable est absente", () => {
  renderSslStep({ mailDomainEnv: "", defaultDomain: "exemple.fr" })
  expect(screen.queryByText(/ssl\.domainMismatch/)).not.toBeInTheDocument()
})
```

Adapter `renderSslStep` (ou le rendu direct utilisé par le fichier) pour accepter les deux nouvelles props.

- [ ] **Step 7 : Lancer le test pour le voir échouer**

```bash
bun run vitest run src/components/setup/steps/SslStep.test.tsx
```

Attendu : FAIL — les props n'existent pas.

- [ ] **Step 8 : Afficher l'avertissement**

Dans `SslStep.tsx`, ajouter deux props au type `Props` :

```tsx
  /** Valeur de STALMAIL_MAIL_DOMAIN, vide si non déclarée. */
  mailDomainEnv: string
  /** Domaine réellement créé dans le wizard. */
  defaultDomain: string
```

Les accepter dans la signature du composant, puis afficher l'avertissement au-dessus du contenu existant :

```tsx
      {mailDomainEnv !== "" &&
        defaultDomain !== "" &&
        mailDomainEnv !== defaultDomain && (
          <p className="warn" role="status">
            {t("ssl.domainMismatch", {
              env: mailDomainEnv,
              created: defaultDomain,
            })}
          </p>
        )}
```

C'est un avertissement, pas un blocage : rien ne conditionne la suite de l'étape.

Dans `SetupWizard.tsx`, passer les deux valeurs au `<SslStep …>` (l. 495) :

```tsx
        mailDomainEnv={context.mailDomainEnv}
        defaultDomain={collected.defaultDomain}
```

en lisant `mailDomainEnv` du contexte déjà chargé par `setupContextHandler` (même source que `serverHostname`).

- [ ] **Step 9 : Lancer les tests pour les voir passer**

```bash
bun run vitest run src/components/setup/steps/SslStep.test.tsx src/server/setup-actions.test.ts
```

- [ ] **Step 10 : Vérifier la suite complète et commiter**

```bash
bun run test && bun run lint && bun run typecheck
git add src/server/setup-actions.ts src/server/setup-actions.test.ts src/components/setup/SetupWizard.tsx src/components/setup/steps/SslStep.tsx src/components/setup/steps/SslStep.test.tsx src/i18n/resources.ts
git commit -m "feat(setup): warn when the declared mail domain differs from the created one"
```

---

### Task 5 : `install.sh` demande et migre la nouvelle variable

**Files:**
- Modify: `install.sh:31-45` (arguments), `:116-123` (création du `.env`), `:135-145` (migration)

**Interfaces:**
- Consumes : `STALMAIL_MAIL_DOMAIN` (Task 3), désormais requise par `compose.prod.yml`.
- Produces : rien.

**Pourquoi cette tâche existe :** sans elle, tout déploiement installé par le script échoue au prochain `up -d`, puisque la variable est requise et que le script ne l'écrit pas.

- [ ] **Step 1 : Accepter un second argument, avec saisie interactive**

Dans `install.sh`, après le bloc qui valide `HOSTNAME_ARG` (l. 41-44), ajouter :

```sh
# Domaine des adresses e-mail (partie après le @). Distinct du hostname du webmail :
# avec STALMAIL_HOSTNAME=mail.exemple.fr, on attend ici exemple.fr. Requis par
# compose.prod.yml (hôte de politique MTA-STS).
MAIL_DOMAIN_ARG="${2:-}"
if [ -z "${MAIL_DOMAIN_ARG}" ]; then
  read -rp "Domaine des adresses e-mail (ex. getstalmail.com) : " MAIL_DOMAIN_ARG
fi
if [ -z "${MAIL_DOMAIN_ARG}" ]; then
  echo "❌ Domaine des adresses requis."
  exit 1
fi
if ! printf '%s' "${MAIL_DOMAIN_ARG}" | grep -qE '^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'; then
  echo "❌ Domaine invalide : « ${MAIL_DOMAIN_ARG} ». Attendu un domaine, ex. getstalmail.com"
  exit 1
fi
```

- [ ] **Step 2 : L'écrire à la création du `.env`**

Dans le bloc de création (l. 116-121), ajouter une ligne au groupe `printf` :

```sh
    printf 'STALMAIL_MAIL_DOMAIN=%s\n' "${MAIL_DOMAIN_ARG}"
```

et compléter le message de confirmation :

```sh
  echo "✓ .env créé (secret généré, hostname=${HOSTNAME_ARG}, domaine=${MAIL_DOMAIN_ARG})"
```

- [ ] **Step 3 : Migrer un `.env` existant**

Dans la branche `.env` existant, après le bloc de migration de `STALMAIL_SETUP_TOKEN_HASH` (l. 145), ajouter le même motif :

```sh
  # Migration douce : un .env antérieur à la topologie mail n'a pas
  # STALMAIL_MAIL_DOMAIN, désormais REQUISE par compose.prod.yml → sans elle,
  # `docker compose up` échoue avant tout affichage.
  EXISTING_MAIL_DOMAIN=$(awk -F= '$1=="STALMAIL_MAIL_DOMAIN"{print $2}' .env | tail -n1)
  if [ -z "${EXISTING_MAIL_DOMAIN}" ]; then
    printf 'STALMAIL_MAIL_DOMAIN=%s\n' "${MAIL_DOMAIN_ARG}" >> .env
    chmod 600 .env
    echo "✓ .env migré (STALMAIL_MAIL_DOMAIN=${MAIL_DOMAIN_ARG} ajouté)"
  fi
```

- [ ] **Step 4 : Vérifier le script**

```bash
sh -n install.sh
```

Attendu : aucune sortie (syntaxe valide).

Puis vérifier les deux chemins dans un répertoire jetable :

```bash
TMP=$(mktemp -d) && cp install.sh "$TMP/" && cd "$TMP"
printf 'STALMAIL_SECRET=x\nSTALMAIL_HOSTNAME=mail.exemple.fr\nSTALMAIL_PUBLIC_URL=https://mail.exemple.fr\nSTALMAIL_SETUP_TOKEN_HASH=x\n' > .env
```

Le script poursuit ensuite par le téléchargement des fichiers de compose et le démarrage de la stack : interrompre (Ctrl-C) dès que le message `✓ .env migré` s'affiche, puis vérifier le fichier :

```bash
grep -c STALMAIL_MAIL_DOMAIN .env   # attendu : 1
grep -c STALMAIL_SETUP_TOKEN_HASH .env  # attendu : 1 (inchangé)
```

L'objet de cette vérification est la migration du `.env`, pas l'installation complète.

- [ ] **Step 5 : Commit**

```bash
git add install.sh
git commit -m "feat(install): collect and migrate the mail domain variable"
```

---

### Task 6 : Validation par destruction, en staging puis en production

Aucune ligne de code. C'est la tâche qui prouve que les cinq précédentes tiennent, et la seule qui puisse le faire : le défaut corrigé n'apparaît que sur un déploiement réel dont les deux noms divergent.

**Files:** aucun.

**Interfaces:**
- Consumes : les Tasks 1 à 5, mergées et déployées.

**Prérequis :** l'accord explicite du partenaire humain avant toute destruction, et l'accès SSH au serveur de test. Les valeurs concrètes — adresse du serveur, hôte du webmail, domaine des adresses — se lisent dans le `.env` du serveur (`~/stalmail/.env`) ; le `serverHostname` retenu est celui saisi au wizard à l'étape 2.

- [ ] **Step 1 : Basculer en staging avant de détruire**

Dans le `.env` du serveur, poser :

```
STALMAIL_ACME_DIRECTORY=https://acme-staging-v02.api.letsencrypt.org/directory
STALMAIL_MAIL_DOMAIN=<domaine des adresses>
```

L'ordre compte : basculer **avant** la destruction, sinon la première demande de certificat part vers l'annuaire de production et entame le quota.

- [ ] **Step 2 : Détruire et refaire**

Détruire la stack **volumes compris** (c'est le seul cas où `-v` est légitime, et il exige l'accord explicite du partenaire), puis relancer et refaire le wizard en choisissant un `serverHostname` **différent** de l'hôte du webmail — la configuration qui casse aujourd'hui.

- [ ] **Step 3 : Vérifier le certificat des ports mail**

```bash
echo | openssl s_client -servername <serverHostname> -connect <serveur>:993 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName
```

Attendu : le SAN **contient le `serverHostname` annoncé en EHLO**. C'est l'assertion centrale ; vérifier le SAN, pas seulement le CN. Comparer avec la bannière :

```bash
printf 'QUIT\r\n' | openssl s_client -starttls smtp -connect <serveur>:25 2>/dev/null | head -3
```

- [ ] **Step 4 : Vérifier la politique MTA-STS depuis l'extérieur**

```bash
curl -sS https://mta-sts.<domaine>/.well-known/mta-sts.txt
curl -s -o /dev/null -w '%{http_code}\n' https://mta-sts.<domaine>/
```

Attendu : la politique pour la première commande (avec un certificat accepté, donc sans `-k`), et `404` pour la seconde. Cette requête est la première à traverser le nouveau bloc avec l'en-tête `Host: mta-sts.<domaine>` — le relais vers Stalwart n'a jamais été éprouvé sous cet hôte, c'est précisément ce que ce pas vérifie.

Vérifier enfin que le `mx:` de la politique correspond à l'enregistrement MX publié.

- [ ] **Step 5 : Vérifier que le webmail n'a pas bougé**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<hôte du webmail>/login
```

Attendu : `200`.

- [ ] **Step 6 : Repasser en production et refaire une fois**

Retirer `STALMAIL_ACME_DIRECTORY` du `.env`, détruire et refaire une dernière fois, puis reprendre les steps 3 à 5 — cette fois avec de vrais certificats. Consigner les résultats dans la description de la PR.

---

## Après le plan

1. Ouvrir la PR depuis une branche dédiée, en anglais, en liant la spec et en décrivant les vérifications de la Task 6.
2. Double revue CodeRabbit (bot sur la PR + `coderabbit review --agent --base main`), triage argumenté, skips motivés en commentaire.
3. Merge `--squash --admin --delete-branch` sur accord explicite, puis release-please.

## Hors périmètre (rappel de la spec)

- Le mode DNS manuel, où l'ACME est refusé et où le défaut reste entier — à ouvrir en issue.
- Les hôtes `autoconfig` / `autodiscover` / `ua-auto-config`, qui souffrent du même mal sur la découverte automatique.
- Le passage de la politique en `mode: enforce`, le multi-domaine, la mutualisation des certificats, DANE/TLSA.
