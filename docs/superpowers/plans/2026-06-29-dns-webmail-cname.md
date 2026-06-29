# Webmail en CNAME vers l'hôte mail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans la section « Adresse du serveur » du wizard DNS, proposer le webmail (sous-domaine distinct) comme un **CNAME unique vers l'hôte mail**, au lieu de ses A/AAAA.

**Architecture:** Modification d'une seule fonction pure (`buildHostRecords`) qui émet désormais un CNAME pour le rôle `webmail` quand une cible mail existe ; le vérificateur de statut (`resolveRecordStatus`) gère déjà CNAME (aucun code resolver neuf) ; la note UI explique l'alias. Repli A/AAAA conservé quand aucune cible mail.

**Tech Stack:** TanStack Start, React 19, TypeScript, Vitest, react-i18next, Bun.

## Global Constraints

- Gestionnaire de paquets : **Bun** uniquement (`bun run lint`, `bun run typecheck`, `bun run test`). Lancer un test isolé : `bunx vitest run <path>`.
- Fonctions pures extraites et testées isolément ; pas de logique dans les composants.
- Toute valeur attendue de CNAME = FQDN avec **point final** (cohérent avec le format zone, ex. `mail.exemple.fr.`).
- i18n : libellés en **français** via clés `t('...')`, parité fr/en imposée par le type. Jamais de texte en dur.
- Commits **conventionnels** (`feat:`, `test:`…). Ne jamais bumper la version. Travailler sur la branche `feat/dns-webmail-cname`.
- Le pre-commit (`lint && typecheck && test`) ne doit pas être contourné.

---

## File Structure

- `src/server/dns-host-records.ts` — **modifié** : `buildHostRecords` émet un CNAME pour le webmail.
- `src/server/dns-host-records.test.ts` — **modifié** : 2 tests existants adaptés (webmail A → CNAME), 2 tests ajoutés (CNAME sans IP, agnostique IP).
- `src/i18n/resources.ts` — **modifié** : clé `wizard.dns.hostAddress.webmailCnameNote` (fr + en).
- `src/components/setup/steps/HostAddressSection.tsx` — **modifié** : note info quand le webmail est un CNAME.
- `src/components/setup/steps/HostAddressSection.test.tsx` — **modifié** : 1 test ajouté (note présente si CNAME, absente sinon).

Aucun changement à `dns-resolve.ts`, `setup-actions.ts`, `collectHostTargets`.

---

## Task 1: `buildHostRecords` émet un CNAME pour le webmail

**Files:**
- Modify: `src/server/dns-host-records.ts:37-71` (corps de `buildHostRecords`)
- Test: `src/server/dns-host-records.test.ts`

**Interfaces:**
- Consumes: `collectHostTargets(zoneRecords): string[]` (inchangé), type `HostRole = "mail" | "apex" | "webmail"`, `HostRecord { name; type; value; role }`.
- Produces: `buildHostRecords(input)` — signature inchangée. Nouveau comportement : pour `role === "webmail"` avec une cible mail disponible et un nom distinct, retourne un unique `{ name: <webmail>".", type: "CNAME", value: <mailHost>".", role: "webmail" }` (ni A ni AAAA, émis indépendamment de `ipv4`/`ipv6`).

- [ ] **Step 1: Adapter le test existant « hostname public distinct → rôle webmail »**

Dans `src/server/dns-host-records.test.ts`, remplacer l'entrée webmail attendue de ce test (actuellement `type: "A"`) par un CNAME. Le test complet devient :

```ts
  it("hostname public distinct → rôle webmail en CNAME vers l'hôte mail", () => {
    const recs = buildHostRecords({
      ...base,
      hostname: "webmail.exemple.fr",
      zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
    })
    expect(recs).toEqual([
      {
        name: "mail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "mail",
      },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      {
        name: "webmail.exemple.fr.",
        type: "CNAME",
        value: "mail.exemple.fr.",
        role: "webmail",
      },
    ])
  })
```

- [ ] **Step 2: Remplacer le test « webmail distinct avec ipv6 → A et AAAA »**

Toujours dans le même fichier, remplacer entièrement le test `"webmail distinct avec ipv6 → reçoit A et AAAA avec rôle webmail"` par la version CNAME (le webmail reste un CNAME unique même avec IPv6 ; seuls mail/apex reçoivent A+AAAA) :

```ts
  it("webmail distinct avec ipv6 → mail/apex en A+AAAA, webmail reste un CNAME unique", () => {
    expect(
      buildHostRecords({
        ...base,
        hostname: "webmail.exemple.fr",
        ipv6: "2001:db8::1",
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([
      {
        name: "mail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "mail",
      },
      {
        name: "mail.exemple.fr.",
        type: "AAAA",
        value: "2001:db8::1",
        role: "mail",
      },
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      { name: "exemple.fr.", type: "AAAA", value: "2001:db8::1", role: "apex" },
      {
        name: "webmail.exemple.fr.",
        type: "CNAME",
        value: "mail.exemple.fr.",
        role: "webmail",
      },
    ])
  })
```

- [ ] **Step 3: Ajouter le test « CNAME émis même sans IP »**

Ajouter ce nouveau test dans le bloc `describe("buildHostRecords", …)` (le CNAME ne dépend pas de l'écho IP) :

```ts
  it("webmail distinct sans IP → CNAME tout de même émis (mail/apex absents)", () => {
    expect(
      buildHostRecords({
        ...base,
        hostname: "webmail.exemple.fr",
        ipv4: null,
        ipv6: null,
        zoneRecords: zone([["exemple.fr.", "MX", "10 mail.exemple.fr."]]),
      })
    ).toEqual([
      {
        name: "webmail.exemple.fr.",
        type: "CNAME",
        value: "mail.exemple.fr.",
        role: "webmail",
      },
    ])
  })
```

- [ ] **Step 4: Ajouter le test « zone vide → webmail repli A/AAAA »**

Le repli existe déjà (`"zone vide → repli apex + webmail (hostname)"`) mais avec `hostname` = `mail.exemple.fr`. Ajouter un cas explicite avec un hostname webmail distinct pour verrouiller le repli A (pas de cible → pas de CNAME) :

```ts
  it("zone vide → webmail en repli A/AAAA (pas de cible CNAME)", () => {
    expect(
      buildHostRecords({
        ...base,
        hostname: "webmail.exemple.fr",
        zoneRecords: [],
      })
    ).toEqual([
      { name: "exemple.fr.", type: "A", value: "203.0.113.4", role: "apex" },
      {
        name: "webmail.exemple.fr.",
        type: "A",
        value: "203.0.113.4",
        role: "webmail",
      },
    ])
  })
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils échouent**

Run: `bunx vitest run src/server/dns-host-records.test.ts`
Expected: ÉCHEC — les nouveaux/adaptés attendent `type: "CNAME"` mais l'implémentation émet encore `type: "A"` pour le webmail.

- [ ] **Step 6: Implémenter le CNAME dans `buildHostRecords`**

Dans `src/server/dns-host-records.ts`, remplacer le corps de `buildHostRecords` (lignes 37-71) par :

```ts
export function buildHostRecords(input: {
  zoneRecords: ZoneRecord[]
  hostname: string
  domain: string
  ipv4: string | null
  ipv6: string | null
}): HostRecord[] {
  const { ipv4, ipv6, zoneRecords } = input
  const mailTargets = collectHostTargets(zoneRecords)
  // Cible du CNAME webmail : l'hôte mail (1ʳᵉ cible MX/SRV). Null si zone non générée.
  const mailHost = mailTargets[0] ?? null
  const seen = new Set<string>()
  const named: { name: string; role: HostRole }[] = []
  const add = (raw: string, role: HostRole) => {
    const n = normName(raw)
    if (!n || seen.has(n)) return
    seen.add(n)
    named.push({ name: n, role })
  }

  // La zone Stalwart est générée : MX/SRV pointent l'hôte du serveur mail ; les CNAMEs
  // sont des alias et ne constituent pas une source authoritative.
  // 1) Serveur mail : les hôtes que la zone désigne via MX/SRV.
  for (const t of mailTargets) add(t, "mail")
  // Repli (zone non encore générée) : pas de cible MX → apex + hostname public uniquement.
  // 2) Apex (accès web), s'il n'est pas déjà un hôte mail.
  add(input.domain, "apex")
  // 3) Webmail (hôte de PUBLIC_URL), s'il est distinct.
  add(input.hostname, "webmail")

  const records: HostRecord[] = []
  for (const { name, role } of named) {
    // Webmail = sous-domaine distinct → CNAME vers l'hôte mail : une seule IP à
    // maintenir (celle de la cible). Agnostique de l'IP → émis même sans écho IP.
    if (role === "webmail" && mailHost && name !== mailHost) {
      records.push({
        name: name + ".",
        type: "CNAME",
        value: mailHost + ".",
        role,
      })
      continue
    }
    if (ipv4) records.push({ name: name + ".", type: "A", value: ipv4, role })
    if (ipv6)
      records.push({ name: name + ".", type: "AAAA", value: ipv6, role })
  }
  return records
}
```

(`name` et `mailHost` sont déjà normalisés via `normName` — `name !== mailHost` est une défense ; la dédup garantit déjà qu'un webmail atteignant la boucle est distinct de toute cible mail.)

- [ ] **Step 7: Lancer les tests pour vérifier qu'ils passent**

Run: `bunx vitest run src/server/dns-host-records.test.ts`
Expected: PASS (tous les cas, dont collectHostTargets inchangé, repli A/AAAA, dédup webmail=apex / webmail=mail host, et CNAME).

- [ ] **Step 8: Commit**

```bash
git add src/server/dns-host-records.ts src/server/dns-host-records.test.ts
git commit -m "feat(setup): webmail proposé en CNAME vers l'hôte mail (#61)"
```

---

## Task 2: Note UI + i18n pour l'alias webmail

**Files:**
- Modify: `src/i18n/resources.ts:132-150` (bloc `hostAddress` fr) et `:473` (bloc `hostAddress` en)
- Modify: `src/components/setup/steps/HostAddressSection.tsx:172-185` (bloc après le tableau)
- Test: `src/components/setup/steps/HostAddressSection.test.tsx`

**Interfaces:**
- Consumes: `HostAddressRecord { name; type; value; role; status }` (inchangé), clé i18n `wizard.dns.hostAddress.webmailCnameNote`.
- Produces: rien de réutilisé en aval (changement présentationnel terminal).

- [ ] **Step 1: Ajouter la clé i18n française**

Dans `src/i18n/resources.ts`, bloc `hostAddress` français (vers la ligne 142, après `apexNote`), ajouter la clé :

```ts
        webmailCnameNote:
          "Le webmail est un alias (CNAME) vers l'hôte mail : une seule adresse IP à maintenir.",
```

- [ ] **Step 2: Ajouter la clé i18n anglaise (parité)**

Dans le bloc `hostAddress` anglais (vers la ligne 473, au même emplacement relatif, après `apexNote`), ajouter :

```ts
        webmailCnameNote:
          "The webmail is an alias (CNAME) to the mail host: a single IP address to maintain.",
```

- [ ] **Step 3: Vérifier la parité de types i18n**

Run: `bun run typecheck`
Expected: PASS — la clé existe dans fr ET en, le type des ressources reste cohérent.

- [ ] **Step 4: Écrire le test UI (note présente si CNAME, absente sinon)**

Dans `src/components/setup/steps/HostAddressSection.test.tsx`, ajouter ce test (le fixture `recs` existant a un webmail en `A` → la note doit être absente ; un nouveau fixture avec webmail `CNAME` → note présente) :

```ts
  it("affiche la note CNAME quand le webmail est un alias, sinon non", () => {
    const { rerender } = wrap(
      <HostAddressSection
        records={recs}
        status="ready"
        domain="exemple.fr"
        onManualIp={vi.fn()}
      />
    )
    // recs a un webmail en A → pas de note CNAME
    expect(screen.queryByText(/alias \(CNAME\)/)).not.toBeInTheDocument()

    rerender(
      <I18nextProvider i18n={createI18n("fr")}>
        <HostAddressSection
          records={[
            {
              name: "webmail.exemple.fr.",
              type: "CNAME",
              value: "mail.exemple.fr.",
              role: "webmail",
              status: "pending",
            },
          ]}
          status="ready"
          domain="exemple.fr"
          onManualIp={vi.fn()}
        />
      </I18nextProvider>
    )
    expect(screen.getByText(/alias \(CNAME\)/)).toBeInTheDocument()
  })
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il échoue**

Run: `bunx vitest run src/components/setup/steps/HostAddressSection.test.tsx`
Expected: ÉCHEC sur le second `expect` (`getByText(/alias \(CNAME\)/)`) — la note n'est pas encore rendue.

- [ ] **Step 6: Rendre la note dans `HostAddressSection`**

Dans `src/components/setup/steps/HostAddressSection.tsx`, juste après le bloc IIFE de `apexNote` (avant la fermeture `</div>` de `dns-table-wrap`, vers la ligne 184), ajouter :

```tsx
          {records.some(
            (r) => r.role === "webmail" && r.type === "CNAME"
          ) ? (
            <Alert variant="info">
              {t("wizard.dns.hostAddress.webmailCnameNote")}
            </Alert>
          ) : null}
```

- [ ] **Step 7: Lancer le test pour vérifier qu'il passe**

Run: `bunx vitest run src/components/setup/steps/HostAddressSection.test.tsx`
Expected: PASS (les tests existants — titre, groupes par rôle, spinner, échec IP, apexNote — restent verts).

- [ ] **Step 8: Commit**

```bash
git add src/i18n/resources.ts src/components/setup/steps/HostAddressSection.tsx src/components/setup/steps/HostAddressSection.test.tsx
git commit -m "feat(setup): note d'alias CNAME pour le webmail (#61)"
```

---

## Task 3: Vérification finale d'intégration

**Files:** aucun (validation seulement)

- [ ] **Step 1: Suite complète**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: tout au vert (lint, tsc --noEmit, vitest run — l'ensemble des fichiers).

- [ ] **Step 2: Vérifier l'absence de régression sur les rôles mail/apex**

Relire mentalement `dns-host-records.test.ts` : les cas `mail` (cible MX) et `apex` restent en A/AAAA ; les cas de dédup (`webmail === apex`, `webmail === hôte mail`) ne produisent pas de CNAME. Confirmer qu'aucun test existant non lié n'a été modifié.

---

## Self-Review

**Spec coverage :**
- CNAME webmail vers hôte mail (sous-domaine distinct) → Task 1, Steps 1-2, 6. ✓
- Repli A/AAAA si zone vide → Task 1, Step 4 + implémentation `mailHost` null. ✓
- `webmail === apex` / `=== hôte mail` → couverts par la dédup existante (tests existants conservés). ✓
- Indépendance vis-à-vis de l'IP (CNAME émis sans écho) → Task 1, Step 3. ✓
- Aucun code resolver neuf → confirmé (Task sans modification de `dns-resolve.ts`). ✓
- Note UI + i18n fr/en → Task 2. ✓
- Suite verte → Task 3. ✓

**Placeholder scan :** aucun TODO/TBD ; tout le code est fourni en entier. ✓

**Type consistency :** `HostRole`, `HostRecord`, `HostAddressRecord`, `buildHostRecords`, `collectHostTargets`, clé `webmailCnameNote` — noms cohérents entre tâches et avec le code existant. La valeur CNAME porte toujours le point final. ✓
