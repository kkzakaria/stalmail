# Gating DMARC de l'allowlist images (#126) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conditionner l'upgrade `sender-allowed` (auto-affichage des images d'un expéditeur allowlisté) à un verdict DMARC lu depuis `Authentication-Results`, avec exemption locale pour le courrier interne, + rate-limit des mutations d'allowlist.

**Architecture:** Le verdict est extrait côté serveur d'un en-tête déjà présent (aucun appel réseau ajouté) : `buildReadThreadCalls` fetch `header:Authentication-Results:asText:all`, un parseur pur (`auth-results.ts`) lit la **première instance** (anti-spoof par ordre : la nôtre est préfixée sur le port 25), `parseThreadDetail` pose `AppMessage.authVerdict`, et `resolveImageDecision` (pur) n'upgrade que si `pass` — ou `none` + expéditeur du même domaine que le compte (exemption locale, domaines non vides). Le hook client conditionne son patch optimiste au verdict (jamais de chargement non authentifié, même transitoire).

**Tech Stack:** TanStack Start (server functions BFF), JMAP RFC 8621 (`header:...:asText:all`), RFC 8601 (Authentication-Results), Vitest, TanStack Query.

## Global Constraints

- **Bun uniquement** : `bun run lint`, `bun run typecheck`, `bun run test` (jamais npm/yarn/pnpm). Le pre-commit lance les trois → **chaque commit doit être vert**.
- **Fail-closed partout** : instance absente → `"none"` ; instance présente sans clause `dmarc=` (ou vide/malformée) → `"fail"` ; `authVerdict` absent → `"none"` ; domaines vides → jamais d'upgrade ; patch optimiste client conditionné à `"pass"`.
- `localDomain` dérivé de la session côté serveur (`accountName`), **jamais du client**, **jamais persisté** dans `image-prefs.json` (assemblé au point d'appel `readThreadFn`).
- Parseur : **strip des commentaires CFWS avant tout match**, `dmarc` en **frontière de clause** (début ou après `;`), `pass` → `"pass"`, toute autre valeur → `"fail"`, clause/instance absente → `"none"`.
- Clé JMAP **littérale** : `header:Authentication-Results:asText:all` (demande ET lecture de la réponse).
- Le keyword par-message `stalmail_showimages` est **inchangé** (non gouverné par le verdict) ; précédence existante conservée.
- Rate-limit : `requireSession()` d'abord, puis consommation **synchrone** (aucun `await` entre check et enregistrement) — patron `consumeSendSlot`/`sendMailFn`.
- Fonctions pures testées isolément ; commits conventionnels ; i18n : aucune clé nouvelle (pas de changement d'UI visible).

---

## File Structure

- **Créé** `src/server/auth-results.ts` — parseur pur `parseDmarcVerdict` (+ `stripComments` interne).
- **Créé** `src/server/auth-results.test.ts`.
- **Créé** `src/server/image-prefs-rate-limit.ts` — miroir de `send-rate-limit.ts` (fenêtre 60 min, cap 60).
- **Créé** `src/server/image-prefs-rate-limit.test.ts`.
- **Modifié** `src/server/mail-types.ts` — `export type AuthVerdict` + `AppMessage.authVerdict?`.
- **Modifié** `src/server/image-prefs.ts` — `senderDomain`, `ImagePrefs.localDomain`, gating dans `resolveImageDecision`.
- **Modifié** `src/server/image-prefs.test.ts` — matrice de gating (fixtures existantes adaptées).
- **Modifié** `src/server/mail-actions.ts` — `requireSession` propage `accountName` ; `buildReadThreadCalls` + `RawDetailEmail` + `parseThreadDetail` (header/verdict) ; `readThreadFn` (assemblage `localDomain`) ; rate-limit dans `trustSenderFn`/`untrustSenderFn`.
- **Modifié** `src/server/mail-actions.test.ts`.
- **Modifié** `src/server/image-prefs-store.ts` — commentaire « constat purge » sur `deleteAllForAccount`.
- **Modifié** `src/components/mail/use-image-actions.ts` — `trustSender` : patch conditionné à `pass` + invalidation au succès.
- **Modifié** `src/components/mail/use-image-actions.test.tsx`.
- **Modifié** `docs/superpowers/specs/2026-07-03-dmarc-gating-allowlist-design.md` — §6 : test handler rate-limit remplacé par couverture module (précédent `sendMailFn`).

---

## Task 1 : Parseur pur `parseDmarcVerdict`

**Files:**
- Modify: `src/server/mail-types.ts` (ajout du type, près de `ImageDecision`)
- Create: `src/server/auth-results.ts`
- Test: `src/server/auth-results.test.ts`

**Interfaces:**
- Produces:
  - `export type AuthVerdict = "pass" | "fail" | "none"` (dans `mail-types.ts`)
  - `parseDmarcVerdict(headers: string[] | null | undefined): AuthVerdict` (dans `auth-results.ts`)

- [ ] **Step 1: Ajouter le type dans `mail-types.ts`**

Juste après la ligne `export type ImageDecision = ...` :

```ts
// Verdict DMARC extrait d'Authentication-Results (#126). "none" = pas de verdict
// (courrier interne via soumission, ou en-tête absent/illisible — fail-closed).
export type AuthVerdict = "pass" | "fail" | "none"
```

- [ ] **Step 2: Écrire le test**

Create `src/server/auth-results.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { parseDmarcVerdict } from "./auth-results"

describe("parseDmarcVerdict", () => {
  it("dmarc=pass → pass (format Stalwart typique)", () => {
    expect(
      parseDmarcVerdict([
        "mail.getstalmail.com; dkim=pass header.d=gmail.com; spf=pass smtp.mailfrom=gmail.com; dmarc=pass header.from=gmail.com; iprev=pass",
      ])
    ).toBe("pass")
  })

  it("dmarc=fail → fail", () => {
    expect(parseDmarcVerdict(["srv; dmarc=fail header.from=x.io"])).toBe(
      "fail"
    )
  })

  it("dmarc=none (domaine sans politique DMARC) → fail (fail-closed)", () => {
    expect(parseDmarcVerdict(["srv; dmarc=none header.from=x.io"])).toBe(
      "fail"
    )
  })

  it("temperror/permerror → fail", () => {
    expect(parseDmarcVerdict(["srv; dmarc=temperror"])).toBe("fail")
    expect(parseDmarcVerdict(["srv; dmarc=permerror"])).toBe("fail")
  })

  it("insensible à la casse et aux espaces", () => {
    expect(parseDmarcVerdict(["srv; DMARC = Pass ; spf=fail"])).toBe("pass")
  })

  it("instance présente SANS clause dmarc → fail (ne pas ouvrir l'exemption locale)", () => {
    expect(parseDmarcVerdict(["srv; spf=pass; dkim=pass"])).toBe("fail")
  })

  it("tableau vide / null / undefined → none", () => {
    expect(parseDmarcVerdict([])).toBe("none")
    expect(parseDmarcVerdict(null)).toBe("none")
    expect(parseDmarcVerdict(undefined)).toBe("none")
  })

  it("SEULE la première instance compte (forgée en 2e position ignorée)", () => {
    expect(
      parseDmarcVerdict([
        "mail.getstalmail.com; dmarc=fail header.from=x.io",
        "evil.example; dmarc=pass header.from=x.io", // forgé, en dessous
      ])
    ).toBe("fail")
  })

  it("commentaire CFWS injectant dmarc=pass ignoré (strippé avant match)", () => {
    expect(
      parseDmarcVerdict([
        "srv; spf=pass (dmarc=pass) smtp.mailfrom=x.io; dmarc=fail header.from=x.io",
      ])
    ).toBe("fail")
  })

  it("dmarc= hors frontière de clause ignoré (valeur de propriété)", () => {
    expect(
      parseDmarcVerdict([
        "srv; spf=pass smtp.mailfrom=dmarc=pass@evil.io; dmarc=fail",
      ])
    ).toBe("fail")
  })

  it("commentaires imbriqués strippés", () => {
    expect(parseDmarcVerdict(["srv (a (b) c); dmarc=pass"])).toBe("pass")
  })
})
```

- [ ] **Step 3: Lancer le test → échec attendu**

Run: `bun run test auth-results`
Expected: FAIL (module `./auth-results` introuvable).

- [ ] **Step 4: Implémenter `auth-results.ts`**

Create `src/server/auth-results.ts` :

```ts
// Extraction pure du verdict DMARC depuis Authentication-Results (RFC 8601) — #126.
// Aucune dépendance Node : importable partout.
import type { AuthVerdict } from "./mail-types"

// Retire les commentaires parenthésés (CFWS) AVANT tout match : leur contenu est
// influençable par l'expéditeur (ex. `spf=pass (dmarc=pass)`) même dans NOTRE en-tête.
// Boucle jusqu'à stabilité pour gérer l'imbrication.
function stripComments(value: string): string {
  let out = value
  for (;;) {
    const next = out.replace(/\([^()]*\)/g, " ")
    if (next === out) return out
    out = next
  }
}

// Verdict DMARC de la PREMIÈRE instance (ordre du message = la nôtre sur le port 25,
// les instances forgées sont en dessous — spec §2/§3.2). `dmarc` est matché en frontière
// de clause (début ou après ';') pour ignorer un `dmarc=` niché dans une valeur de
// propriété. pass → "pass" ; fail/none/temperror/permerror… → "fail" (fail-closed :
// dmarc=none = domaine sans politique, aucune protection anti-usurpation) ; instance
// absente → "none" ; instance présente sans clause dmarc= (ou vide/malformée) → "fail"
// (ne jamais ouvrir l'exemption locale sur une instance illisible).
export function parseDmarcVerdict(
  headers: string[] | null | undefined
): AuthVerdict {
  const first = headers?.[0]
  if (!first) return "none"
  const cleaned = stripComments(first)
  const m = /(?:^|;)\s*dmarc\s*=\s*([a-z0-9]+)/i.exec(cleaned)
  if (!m) return "fail"
  return m[1].toLowerCase() === "pass" ? "pass" : "fail"
}
```

- [ ] **Step 5: Lancer le test → succès attendu**

Run: `bun run test auth-results`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/auth-results.ts src/server/auth-results.test.ts src/server/mail-types.ts
git commit -m "feat(reader): parseur pur du verdict DMARC (Authentication-Results) (#126)"
```

---

## Task 2 : Gating dans `resolveImageDecision` + `localDomain` de session

**Files:**
- Modify: `src/server/image-prefs.ts`
- Modify: `src/server/mail-types.ts` (champ `AppMessage.authVerdict?`)
- Modify: `src/server/mail-actions.ts` (`requireSession` ~ligne 69 ; `readThreadFn` ~ligne 782 ; import)
- Test: `src/server/image-prefs.test.ts`

**Interfaces:**
- Consumes: `AuthVerdict` (Task 1).
- Produces:
  - `senderDomain(email: string): string` ("" si pas de `@`)
  - `ImagePrefs = { allowedSenders: string[]; localDomain: string }`
  - `resolveImageDecision(prefs: ImagePrefs, message: { from: MailAddress[]; imageDecision?: ImageDecision; authVerdict?: AuthVerdict }): ImageDecision`
  - `requireSession()` renvoie `{ sid, accountId, accountName }`

NB vert-au-commit : `ImagePrefs.localDomain` requis casse la compilation des appelants → cette task met à jour `readThreadFn` ET les fixtures de test existantes dans le même commit. `parseThreadDetail` ne pose pas encore `authVerdict` (Task 3) : état intermédiaire assumé — les expéditeurs externes allowlistés perdent l'upgrade jusqu'à Task 3 (fail-closed, jamais l'inverse).

- [ ] **Step 1: Ajouter le champ au type `AppMessage`**

Dans `src/server/mail-types.ts`, dans `AppMessage`, après la ligne `imageDecision?: ImageDecision` :

```ts
  // Verdict DMARC du message (#126), posé par parseThreadDetail. Absent ⇒ "none".
  authVerdict?: AuthVerdict
```

- [ ] **Step 2: Écrire les tests du gating**

Dans `src/server/image-prefs.test.ts` :

(a) **Adapter les fixtures existantes** — `ImagePrefs` exige désormais `localDomain` et l'upgrade exige un verdict :
- Test « sender de confiance → sender-allowed (précédence) » : passer le 2e argument à `{ from, imageDecision: "blocked", authVerdict: "pass" }` et le prefs à `{ allowedSenders: ["bob@x.io"], localDomain: "" }`.
- Test « keyword posé mais expéditeur non listé » : prefs devient `{ allowedSenders: [], localDomain: "" }`.
- Test « rien → blocked » : prefs devient `{ allowedSenders: [], localDomain: "" }`.
- Test « from vide → jamais sender-allowed » : prefs devient `{ allowedSenders: [""], localDomain: "" }`.
- Test `applyImagePrefs` : prefs devient `{ allowedSenders: ["bob@x.io"], localDomain: "" }` et le message e1 (bob) gagne `authVerdict: "pass"` (l'assertion `sender-allowed` reste valide).

(b) **Ajouter les nouveaux describe** :

```ts
describe("senderDomain", () => {
  it("extrait le domaine, lowercase/trim", () => {
    expect(senderDomain(" Bob@X.IO ")).toBe("x.io")
  })
  it("sans @ → chaîne vide", () => {
    expect(senderDomain("pas-une-adresse")).toBe("")
    expect(senderDomain("")).toBe("")
  })
  it("@ final → chaîne vide", () => {
    expect(senderDomain("bob@")).toBe("")
  })
})

describe("resolveImageDecision — gating DMARC (#126)", () => {
  const from = [{ name: "Bob", email: "bob@x.io" }]
  const allowed = (localDomain: string) => ({
    allowedSenders: ["bob@x.io"],
    localDomain,
  })

  it("allowlisté + pass → sender-allowed", () => {
    expect(
      resolveImageDecision(allowed(""), { from, authVerdict: "pass" })
    ).toBe("sender-allowed")
  })

  it("allowlisté + fail → PAS d'upgrade (retombe sur le niveau message)", () => {
    expect(
      resolveImageDecision(allowed("getstalmail.com"), {
        from,
        authVerdict: "fail",
      })
    ).toBe("blocked")
    expect(
      resolveImageDecision(allowed("getstalmail.com"), {
        from,
        imageDecision: "message-allowed",
        authVerdict: "fail",
      })
    ).toBe("message-allowed") // le keyword par-message reste souverain
  })

  it("allowlisté + none + même domaine → sender-allowed (exemption locale)", () => {
    expect(
      resolveImageDecision(allowed("x.io"), { from, authVerdict: "none" })
    ).toBe("sender-allowed")
  })

  it("allowlisté + none + domaine externe → PAS d'upgrade", () => {
    expect(
      resolveImageDecision(allowed("getstalmail.com"), {
        from,
        authVerdict: "none",
      })
    ).toBe("blocked")
  })

  it("anti-fail-open : domaines vides ne s'égalisent jamais", () => {
    // localDomain indérivable ("") + From malformé (domaine "") → jamais d'upgrade
    expect(
      resolveImageDecision(
        { allowedSenders: ["bad"], localDomain: "" },
        { from: [{ name: "", email: "bad" }], authVerdict: "none" }
      )
    ).toBe("blocked")
  })

  it("authVerdict absent ⇒ traité comme none (exemption locale seule)", () => {
    expect(resolveImageDecision(allowed("x.io"), { from })).toBe(
      "sender-allowed"
    )
    expect(resolveImageDecision(allowed("autre.tld"), { from })).toBe(
      "blocked"
    )
  })

  it("non-allowlisté → jamais d'upgrade, quel que soit le verdict", () => {
    expect(
      resolveImageDecision(
        { allowedSenders: [], localDomain: "x.io" },
        { from, authVerdict: "pass" }
      )
    ).toBe("blocked")
  })
})
```

Compléter l'import en tête : `import { normalizeSender, senderDomain, resolveImageDecision, applyImagePrefs } from "./image-prefs"`.

- [ ] **Step 3: Lancer le test → échec attendu**

Run: `bun run test image-prefs`
Expected: FAIL (`senderDomain` non exporté ; gating absent).

- [ ] **Step 4: Implémenter dans `image-prefs.ts`**

Remplacer `ImagePrefs` et `resolveImageDecision`, ajouter `senderDomain` :

```ts
export interface ImagePrefs {
  allowedSenders: string[]
  // Domaine du compte de session (exemption locale #126). "" si indérivable
  // (accountName sans @) → exemption simplement inopérante (fail-closed).
  // Assemblé par readThreadFn — JAMAIS persisté dans image-prefs.json.
  localDomain: string
}

// Domaine d'une adresse, lowercase/trim. "" si pas de @ (ou @ final) — les appelants
// doivent traiter "" comme « pas de domaine », jamais le comparer à un autre "".
export function senderDomain(email: string): string {
  const at = email.lastIndexOf("@")
  if (at === -1) return ""
  return email.slice(at + 1).trim().toLowerCase()
}

// Upgrade par-expéditeur d'une décision niveau-message déjà calculée (via le keyword).
// Précédence : sender-allowed > (message-allowed | blocked).
// Gating anti-usurpation (#126) : l'upgrade exige un message AUTHENTIFIÉ (dmarc=pass),
// ou — exemption locale — aucun verdict (courrier interne via soumission, sans
// Authentication-Results) ET expéditeur du même domaine que le compte, domaines non
// vides des deux côtés (anti-fail-open : "" === "" ne doit jamais accorder l'upgrade).
export function resolveImageDecision(
  prefs: ImagePrefs,
  message: {
    from: MailAddress[]
    imageDecision?: ImageDecision
    authVerdict?: AuthVerdict
  }
): ImageDecision {
  const preliminary: ImageDecision = message.imageDecision ?? "blocked"
  const email = message.from.at(0)?.email ?? ""
  const sender = normalizeSender(email)
  if (!sender || !prefs.allowedSenders.includes(sender)) return preliminary
  const verdict: AuthVerdict = message.authVerdict ?? "none"
  if (verdict === "pass") return "sender-allowed"
  if (verdict === "none") {
    const fromDomain = senderDomain(email)
    if (
      fromDomain !== "" &&
      prefs.localDomain !== "" &&
      fromDomain === prefs.localDomain
    )
      return "sender-allowed"
  }
  return preliminary // "fail" ou exemption non applicable → fail-closed
}
```

Compléter l'import de types en tête : `import type { AppThreadDetail, AuthVerdict, ImageDecision, MailAddress } from "./mail-types"`.

- [ ] **Step 5: Câbler `requireSession` + `readThreadFn` dans `mail-actions.ts`**

(a) `requireSession` (~ligne 69) propage `accountName` :

```ts
async function requireSession(): Promise<{
  sid: string
  accountId: string
  // Username du principal (email sur notre déploiement — sinon senderDomain rend ""
  // et l'exemption locale #126 est simplement inopérante, fail-closed).
  accountName: string
}> {
  const { readSid } = await import("./session-cookie")
  const { currentSession } = await import("./session")
  const { redirect } = await import("@tanstack/react-router")
  const sid = readSid()
  const session = currentSession(sid)
  if (!sid || !session) throw redirect({ to: "/login" })
  return {
    sid,
    accountId: session.accountId,
    accountName: session.accountName,
  }
}
```

(b) Ajouter `senderDomain` à l'import : `import { SHOW_IMAGES_KEYWORD, applyImagePrefs, normalizeSender, senderDomain } from "./image-prefs"`.

(c) Dans le handler `readThreadFn` (~ligne 782), remplacer la déstructuration et l'application des prefs :

```ts
      const { sid, accountId, accountName } = await requireSession()
      const responses = await jmapUserCall(
        sid,
        buildReadThreadCalls(accountId, data.threadId)
      )
      const { getPrefs } = await import("./image-prefs-store")
      // Exemption locale (#126) : domaine du compte, dérivé de la session — jamais du
      // client. Assemblé ici : le store ne persiste QUE allowedSenders.
      return applyImagePrefs(parseThreadDetail(responses), {
        ...getPrefs(accountId),
        localDomain: senderDomain(accountName),
      })
```

- [ ] **Step 6: Lancer les tests → succès attendu**

Run: `bun run test image-prefs mail-actions use-image-actions message-item`
Expected: PASS (le hook et les composants ne consomment pas `ImagePrefs` — seuls `image-prefs`/`mail-actions` étaient impactés).

- [ ] **Step 7: Commit**

```bash
git add src/server/image-prefs.ts src/server/image-prefs.test.ts src/server/mail-types.ts src/server/mail-actions.ts
git commit -m "feat(reader): gating du sender-allowed par verdict + exemption locale (#126)"
```

---

## Task 3 : Fetch de l'en-tête + verdict posé par `parseThreadDetail`

**Files:**
- Modify: `src/server/mail-actions.ts` (`buildReadThreadCalls` ~ligne 351 ; `RawDetailEmail` ~ligne 312 ; littéral messages de `parseThreadDetail` ; import)
- Test: `src/server/mail-actions.test.ts`

**Interfaces:**
- Consumes: `parseDmarcVerdict` (Task 1) ; `AppMessage.authVerdict?` (Task 2).
- Produces: `readThreadFn` renvoie des messages avec `authVerdict` réel — le gating de Task 2 devient effectif de bout en bout.

- [ ] **Step 1: Écrire les tests**

Dans `src/server/mail-actions.test.ts` (dans les describe existants concernés) :

(a) Dans le describe de `buildReadThreadCalls` (ou à défaut un `it` près des tests `parseThreadDetail`) :

```ts
  it("fetch l'en-tête Authentication-Results (clé littérale exacte)", () => {
    const [, emailGet] = buildReadThreadCalls("acc", "t1")
    const props = (emailGet[1] as { properties: string[] }).properties
    expect(props).toContain("header:Authentication-Results:asText:all")
  })
```

(b) Dans le describe `parseThreadDetail` existant (fixtures nommées, pas de shadowing de `responses`) :

```ts
  it("authVerdict = pass quand l'en-tête Authentication-Results porte dmarc=pass", () => {
    const withAuthHeader: JmapMethodResponse[] = [
      ["Thread/get", { list: [{ id: "t1", emailIds: ["e1"] }] }, "0"],
      [
        "Email/get",
        {
          list: [
            {
              id: "e1",
              from: [{ name: "Bob", email: "bob@gmail.com" }],
              keywords: {},
              "header:Authentication-Results:asText:all": [
                "mail.getstalmail.com; dmarc=pass header.from=gmail.com",
              ],
            },
          ],
        },
        "1",
      ],
    ]
    expect(parseThreadDetail(withAuthHeader).messages[0].authVerdict).toBe(
      "pass"
    )
  })

  it("authVerdict = none sans en-tête Authentication-Results", () => {
    const withoutAuthHeader: JmapMethodResponse[] = [
      ["Thread/get", { list: [{ id: "t1", emailIds: ["e1"] }] }, "0"],
      ["Email/get", { list: [{ id: "e1", from: [], keywords: {} }] }, "1"],
    ]
    expect(parseThreadDetail(withoutAuthHeader).messages[0].authVerdict).toBe(
      "none"
    )
  })
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `bun run test mail-actions`
Expected: FAIL (property absente ; `authVerdict` vaut `undefined`).

- [ ] **Step 3: Implémenter**

(a) Import en tête de `mail-actions.ts` : `import { parseDmarcVerdict } from "./auth-results"`.

(b) `buildReadThreadCalls` : dans le tableau `properties` d'`Email/get`, après `"keywords"` :

```ts
          "keywords",
          // Verdict DMARC (#126) — clé LITTÉRALE : la réponse JMAP renvoie la valeur
          // sous exactement ce nom (RFC 8621 §4.1.2).
          "header:Authentication-Results:asText:all",
```

(c) `RawDetailEmail` : après `keywords?: Record<string, boolean>` :

```ts
  "header:Authentication-Results:asText:all"?: string[] | null
```

(d) Littéral messages de `parseThreadDetail` : après la ligne `imageDecision: ...` :

```ts
    authVerdict: parseDmarcVerdict(
      e["header:Authentication-Results:asText:all"]
    ),
```

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `bun run test mail-actions image-prefs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/mail-actions.ts src/server/mail-actions.test.ts
git commit -m "feat(reader): verdict DMARC lu depuis Authentication-Results dans readThreadFn (#126)"
```

---

## Task 4 : Hook client — patch optimiste conditionné au verdict

**Files:**
- Modify: `src/components/mail/use-image-actions.ts` (bloc `trustSender`)
- Test: `src/components/mail/use-image-actions.test.tsx`

**Interfaces:**
- Consumes: `AppMessage.authVerdict?` (Task 2, présent dans les données du cache).
- Produces: `trustSender` ne patche que les messages `authVerdict === "pass"` et invalide au succès.

- [ ] **Step 1: Mettre à jour les tests**

Dans `src/components/mail/use-image-actions.test.tsx` :

(a) La fixture `detail` : ajouter `authVerdict: "pass"` au message e1 (le test optimiste existant reste alors valide).

(b) Remplacer le test existant « trustSender : patch optimiste sender-allowed sur les messages de l'expéditeur » par :

```ts
  it("trustSender : patch optimiste UNIQUEMENT des messages pass + invalidation au succès", async () => {
    const { qc, result } = setup()
    const spy = vi.spyOn(qc, "invalidateQueries")
    await result.current.trustSender("Bob@x.io")
    expect(trust).toHaveBeenCalledWith({ data: { sender: "Bob@x.io" } })
    const d = qc.getQueryData<AppThreadDetail>(["thread", "t1"])
    expect(d?.messages[0].imageDecision).toBe("sender-allowed") // authVerdict: "pass"
    expect(spy).toHaveBeenCalledWith({ queryKey: ["thread", "t1"] })
  })

  it("trustSender : message fail/none NON patché optimistiquement (gating #126)", async () => {
    const { qc, result } = setup()
    qc.setQueryData<AppThreadDetail>(["thread", "t1"], {
      ...detail,
      messages: [{ ...detail.messages[0], authVerdict: "fail" }],
    })
    await result.current.trustSender("bob@x.io")
    const d = qc.getQueryData<AppThreadDetail>(["thread", "t1"])
    expect(d?.messages[0].imageDecision).toBe("blocked")
  })
```

NB : le second test — après `trustSender`, l'invalidation au succès marque la query stale mais sans observateur actif il n'y a pas de refetch : l'assertion lit l'état patché (non modifié). Le test d'échec existant (« trustSender : échec serveur → invalidation + toast ») reste valide tel quel.

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `bun run test use-image-actions`
Expected: FAIL (patch inconditionnel actuel ; pas d'invalidation au succès).

- [ ] **Step 3: Implémenter**

Dans `src/components/mail/use-image-actions.ts`, remplacer le bloc `trustSender` :

```ts
    trustSender: async (sender) => {
      const norm = normalizeSender(sender)
      await qc.cancelQueries({ queryKey: detailKey })
      // Gating #126 : ne patcher optimistiquement QUE les messages AUTHENTIFIÉS (pass)
      // — jamais de chargement d'images non authentifié, même transitoire. Les cas
      // none+domaine local s'afficheront au refetch (invalidation au succès ci-dessous).
      patch(
        (m) =>
          m.authVerdict === "pass" &&
          normalizeSender(m.from.at(0)?.email ?? "") === norm,
        "sender-allowed"
      )
      try {
        await trustSenderFn({ data: { sender } })
        await qc.invalidateQueries({ queryKey: detailKey })
      } catch {
        await qc.invalidateQueries({ queryKey: detailKey })
        notify(t("mail.actions.error"), "error")
      }
    },
```

(`runOptimistic` reste utilisé tel quel par `showOnce`/`hideImages` — inchangés.)

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `bun run test use-image-actions message-item`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mail/use-image-actions.ts src/components/mail/use-image-actions.test.tsx
git commit -m "feat(reader): patch optimiste de trustSender conditionné au verdict DMARC (#126)"
```

---

## Task 5 : Rate-limit des mutations d'allowlist + constat purge

**Files:**
- Create: `src/server/image-prefs-rate-limit.ts`
- Create: `src/server/image-prefs-rate-limit.test.ts`
- Modify: `src/server/mail-actions.ts` (handlers `trustSenderFn` ~ligne 567 et `untrustSenderFn` ~ligne 582)
- Modify: `src/server/image-prefs-store.ts` (commentaire sur `deleteAllForAccount`)
- Modify: `docs/superpowers/specs/2026-07-03-dmarc-gating-allowlist-design.md` (§6, une ligne)

**Interfaces:**
- Produces: `consumeMutationSlot(account: string, now?: number): boolean` ; `__resetForTest()` ; `MAX_PREFS_MUTATIONS = 60`.

- [ ] **Step 1: Écrire le test du module**

Create `src/server/image-prefs-rate-limit.test.ts` :

```ts
import { describe, it, expect, beforeEach } from "vitest"
import {
  consumeMutationSlot,
  MAX_PREFS_MUTATIONS,
  __resetForTest,
} from "./image-prefs-rate-limit"

beforeEach(() => __resetForTest())

describe("image-prefs-rate-limit", () => {
  it("consomme jusqu'au cap puis refuse", () => {
    for (let i = 0; i < MAX_PREFS_MUTATIONS; i++) {
      expect(consumeMutationSlot("acc", 1000 + i)).toBe(true)
    }
    expect(consumeMutationSlot("acc", 2000)).toBe(false)
  })

  it("fenêtre glissante : un créneau expiré se libère", () => {
    const t0 = 1000
    for (let i = 0; i < MAX_PREFS_MUTATIONS; i++) {
      consumeMutationSlot("acc", t0 + i)
    }
    expect(consumeMutationSlot("acc", t0 + 100)).toBe(false)
    // t0 (le plus ancien) sort de la fenêtre de 60 min
    expect(consumeMutationSlot("acc", t0 + 60 * 60 * 1000 + 1)).toBe(true)
  })

  it("comptes indépendants", () => {
    for (let i = 0; i < MAX_PREFS_MUTATIONS; i++) consumeMutationSlot("a", 1000)
    expect(consumeMutationSlot("a", 1000)).toBe(false)
    expect(consumeMutationSlot("b", 1000)).toBe(true)
  })

  it("refus NE consomme PAS de créneau supplémentaire", () => {
    // 60 créneaux aux timestamps 1000..1059, puis un refus à 2000.
    for (let i = 0; i < MAX_PREFS_MUTATIONS; i++)
      consumeMutationSlot("acc", 1000 + i)
    expect(consumeMutationSlot("acc", 2000)).toBe(false) // refusé
    // À 1000+WINDOW+1, seul le créneau t=1000 a expiré → 59 restants → accepté.
    // Si le refus à 2000 avait consommé un créneau, il en resterait 60 → refusé.
    expect(consumeMutationSlot("acc", 1000 + 60 * 60 * 1000 + 1)).toBe(true)
  })

  it("compte vide → lève (anti pool global partagé)", () => {
    expect(() => consumeMutationSlot("  ", 1000)).toThrow()
  })
})
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `bun run test image-prefs-rate-limit`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le module**

Create `src/server/image-prefs-rate-limit.ts` :

```ts
// Throttle des mutations d'allowlist images par compte (#126) — miroir de
// send-rate-limit. Chaque mutation réécrit image-prefs.json en entier : sans borne,
// un client authentifié peut marteler trustSenderFn (amplification d'écriture disque).
// Limite assumée : in-memory mono-process, remis à zéro au redémarrage.
const WINDOW_MS = 60 * 60 * 1000
export const MAX_PREFS_MUTATIONS = 60

const mutations = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const list = (mutations.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length === 0) mutations.delete(key)
  else mutations.set(key, list)
  return list
}

// Garde défensive : un account vide ferait un pool global partagé entre tous les
// comptes (contournement de l'anti-abus). On rejette plutôt que dégrader en silence.
function keyFor(account: string): string {
  const normalized = account.trim().toLowerCase()
  if (!normalized) {
    throw new Error("image-prefs-rate-limit: account must be non-empty")
  }
  return `a:${normalized}`
}

// Atomique : élague + vérifie + consomme en UNE passe synchrone (aucun await intercalé).
// À appeler juste après requireSession() dans les handlers (patron consumeSendSlot).
// Retourne false si le compte est au plafond (créneau NON consommé).
export function consumeMutationSlot(account: string, now = Date.now()): boolean {
  const key = keyFor(account)
  const list = recent(key, now)
  if (list.length >= MAX_PREFS_MUTATIONS) return false
  list.push(now)
  mutations.set(key, list)
  return true
}

export function __resetForTest(): void {
  mutations.clear()
}
```

- [ ] **Step 4: Appliquer aux deux handlers**

Dans `src/server/mail-actions.ts`, dans `trustSenderFn` ET `untrustSenderFn`, juste après `const { accountId } = await requireSession()` :

```ts
      const { consumeMutationSlot } = await import("./image-prefs-rate-limit")
      // Consommation SYNCHRONE immédiatement après requireSession (patron sendMailFn) :
      // aucun await entre vérification et enregistrement.
      if (!consumeMutationSlot(accountId)) {
        throw new Error("prefs mutation rate limited")
      }
```

(le catch existant transforme en « mail action failed » générique.)

- [ ] **Step 5: Commentaire « constat purge » sur le store**

Dans `src/server/image-prefs-store.ts`, remplacer le commentaire au-dessus de `deleteAllForAccount` (ou l'ajouter s'il n'y en a pas) :

```ts
// Purge des prefs d'un compte. PAS de point de câblage aujourd'hui : l'app n'a aucun
// flux de suppression de compte (gestion des principals = Stalwart admin), et le
// câbler au logout serait faux (les prefs doivent survivre à la déconnexion — c'est
// la feature). À appeler depuis le futur flux de gestion de comptes (phase settings).
```

- [ ] **Step 6: Aligner le spec (§6)**

Dans `docs/superpowers/specs/2026-07-03-dmarc-gating-allowlist-design.md`, remplacer la ligne :
`- Handler : \`trustSenderFn\` refuse au-delà du cap (erreur générique).`
par :
`- Rate-limit : couverture au niveau module (cap, fenêtre, atomicité, refus) — le handler n'ajoute que 3 lignes de câblage, non testé isolément (précédent \`sendMailFn\`/\`consumeSendSlot\`).`

- [ ] **Step 7: Lancer les tests → succès attendu**

Run: `bun run test image-prefs-rate-limit mail-actions`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/image-prefs-rate-limit.ts src/server/image-prefs-rate-limit.test.ts src/server/mail-actions.ts src/server/image-prefs-store.ts docs/superpowers/specs/2026-07-03-dmarc-gating-allowlist-design.md
git commit -m "feat(reader): rate-limit des mutations d'allowlist + constat purge (#126)"
```

---

## Vérification finale (E2E, post-déploiement uniquement)

Après merge + release + CD (le code doit être en prod), adapter le script Playwright de #70 (`scratchpad/test-revoke.ts`, identifiants `mail-id.txt`, https://getstalmail.com) :

- [ ] **Expéditeur externe authentifié (dmarc=pass)** : sur un mail reçu de Gmail (les forwards existants) → « Toujours afficher pour X » → images immédiates (patch optimiste, verdict pass) → reload → auto-affichées. Révoquer (« Bloquer ») pour nettoyer.
- [ ] **Expéditeur interne (exemption locale)** : s'envoyer un mail HTML à image distante (kkzakaria@getstalmail.com → lui-même, aucun A-R) → trust → **pas** d'affichage optimiste (verdict none) mais images **après refetch/reload** (exemption locale). Révoquer pour nettoyer.
- [ ] **Sonde format réel** : dans la réponse réseau de `readThreadFn` (DevTools/Playwright response), vérifier `authVerdict: "pass"` sur le mail Gmail — confirme le format `Authentication-Results` réel de Stalwart et la clé JMAP. (`accountName` = email déjà confirmé : affiché tel quel dans la sidebar.)
- [ ] Si la sonde contredit une hypothèse (verdict `none` sur le mail Gmail) : inspecter l'en-tête brut via la réponse JMAP et ouvrir un fix ciblé sur `parseDmarcVerdict` (fixtures à recaler sur le format constaté).

---

## Notes de couverture (auto-revue plan ↔ spec)

- Spec §3.1 (fetch + clé littérale) → Task 3. §3.2 (parseur, strip commentaires, frontière de clause, première instance) → Task 1. §3.3 (politique + garde anti-fail-open) → Task 2. §3.4 (types, requireSession étendu, assemblage localDomain hors store) → Task 2. §3.5 (hook conditionné + invalidation au succès + no-op documenté) → Task 4. §3.6 (constat purge → commentaire) → Task 5. §3.7 (rate-limit synchrone patron sendMailFn) → Task 5. §5 (sécurité) → gardes Tasks 1/2/4 + fixtures anti-spoof/anti-fail-open. §6 (tests) → chaque task (l'écart « test handler » est résorbé par l'alignement du spec en Task 5 Step 6). §7 (hors périmètre) → rien d'ajouté (pas de badge, pas de multi-domaines, pas de strict).
- La **sonde** du spec (§3.2/§3.4) est réalisée en vérification finale post-déploiement (le format réel n'est observable qu'en prod) ; les fixtures suivent RFC 8601 et le point de recalage est prévu.
- État intermédiaire assumé entre Tasks 2 et 3 (upgrade externe temporairement coupé, fail-closed) — documenté dans Task 2.
