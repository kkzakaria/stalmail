---
name: new-server-fn
description: Créer une nouvelle server function JMAP pour Stalmail en suivant le pattern du projet (createServerFn + Zod + requireSession + builder/parser purs + test). Utiliser quand on ajoute une action ou une lecture côté serveur (ex. action mail, requête JMAP). Invocable par l'utilisateur (/new-server-fn) ou par Claude.
---

# Nouvelle server function (Stalmail)

Suis ce squelette pour ajouter une opération serveur dans `src/server/mail-actions.ts` (ou fichier serveur voisin). Le but : handler mince, **logique en fonctions pures testées**, entrée validée par Zod, aucune opération JMAP générique exposée.

## 1. Fonctions pures (builder + parser)

Extraire la construction des `methodCalls` et le parsing des réponses. Elles sont exportées et testées sans réseau.

```ts
// Pur : construit le batch JMAP.
export function buildXxxCall(accountId: string, /* args validés */): JmapMethodCall[] {
  return [
    ['Email/set', { accountId, update: { /* ... */ } }, '0'],
  ]
}

// Pur : extrait le résultat utile des réponses.
export function parseXxx(responses: JmapMethodResponse[]): AppXxx {
  const res = responses.find(([n]) => n === 'Email/set')?.[1]
  // ... mapping défensif (Array.isArray, valeurs par défaut)
  return /* AppXxx */
}
```

Règle cibles : un enum côté client (`'archive' | 'trash' | …`) est résolu en `mailboxId` **côté serveur** via `Mailbox/get` + `mailboxRefs`/`mailboxIdByRole` (déjà dans `mail-actions.ts`). Ne jamais accepter un mailboxId/keyword brut du client.

## 2. Schéma Zod

```ts
const xxxSchema = z.object({
  emailIds: z.array(z.string().min(1).max(64)).min(1),
  to: z.enum(['archive', 'trash', 'junk', 'inbox']),
})
```

Borne toujours les tailles/longueurs et ferme les enums.

## 3. Handler

```ts
export const xxxFn = createServerFn({ method: 'POST' }) // GET pour une lecture
  .validator((d: { /* … */ }) => xxxSchema.parse(d))
  .handler(async ({ data }): Promise<AppXxx> => {
    const { jmapUserCall } = await import('./jmap-user')
    const { sid, accountId } = await requireSession()
    const responses = await jmapUserCall(sid, buildXxxCall(accountId, /* … */))
    return parseXxx(responses)
  })
```

`requireSession()` fournit `sid` + `accountId` (jamais depuis le client). Les imports serveur (`jmap-user`, `session*`) sont en import dynamique dans le handler, comme l'existant.

## 4. Test (vitest)

Tester les fonctions **pures**, pas le handler réseau :

```ts
import { buildXxxCall, parseXxx } from './mail-actions'

describe('buildXxxCall', () => {
  it('construit le bon update', () => { /* assert sur le methodCall */ })
})

describe('parseXxx', () => {
  it('mappe la réponse', () => { /* … */ })
  it('résiste aux réponses malformées', () => { /* list manquante → défaut */ })
})
```

## 5. Vérifier

`bun run lint && bun run typecheck && bun run test`. Exporter les nouveaux types depuis `mail-types.ts` si partagés avec l'UI.

## Référence

S'inspirer de l'existant : `emailListFn` / `buildListMethodCalls` / `parseListPage` / `resolveFilter` dans `src/server/mail-actions.ts`.
