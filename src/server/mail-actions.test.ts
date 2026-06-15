import { describe, expect, it } from "vitest"
import {
  mapMailboxes,
  resolveFilter,
  buildListMethodCalls,
  parseListPage,
  parseThreadDetail,
  buildReadThreadCalls,
  buildSetFlagsCall,
  buildMovePatch,
  parseEmailMailboxes,
  resolveTargetMailbox,
} from "./mail-actions"
import type { JmapMethodResponse } from "./jmap"
import type { AppMailbox } from "./mail-types"

describe("mapMailboxes", () => {
  it("mappe Mailbox/get vers AppMailbox[] trié par sortOrder", () => {
    const responses: JmapMethodResponse[] = [
      [
        "Mailbox/get",
        {
          list: [
            {
              id: "m2",
              name: "Envoyés",
              role: "sent",
              unreadEmails: 0,
              totalEmails: 3,
              sortOrder: 2,
            },
            {
              id: "m1",
              name: "Réception",
              role: "inbox",
              unreadEmails: 5,
              totalEmails: 40,
              sortOrder: 1,
            },
          ],
        },
        "0",
      ],
    ]
    const out = mapMailboxes(responses)
    expect(out.map((m) => m.id)).toEqual(["m1", "m2"])
    expect(out[0]).toMatchObject({
      role: "inbox",
      unreadEmails: 5,
      totalEmails: 40,
    })
  })

  it("normalise role absent en null", () => {
    const responses: JmapMethodResponse[] = [
      [
        "Mailbox/get",
        {
          list: [
            {
              id: "m1",
              name: "X",
              unreadEmails: 0,
              totalEmails: 0,
              sortOrder: 0,
            },
          ],
        },
        "0",
      ],
    ]
    expect(mapMailboxes(responses)[0].role).toBeNull()
  })

  it("retourne [] quand Mailbox/get est absent ou list non-tableau", () => {
    expect(mapMailboxes([])).toEqual([])
  })
})

const MBX: AppMailbox[] = [
  {
    id: "mi",
    name: "In",
    role: "inbox",
    unreadEmails: 0,
    totalEmails: 0,
    sortOrder: 1,
  },
  {
    id: "mt",
    name: "Trash",
    role: "trash",
    unreadEmails: 0,
    totalEmails: 0,
    sortOrder: 2,
  },
  {
    id: "ms",
    name: "Junk",
    role: "junk",
    unreadEmails: 0,
    totalEmails: 0,
    sortOrder: 3,
  },
]

describe("resolveFilter", () => {
  it("dossier réel → inMailbox sur l'id du role", () => {
    expect(resolveFilter("inbox", MBX)).toEqual({ inMailbox: "mi" })
  })

  it("starred → $flagged AND NOT (trash, spam) [R5]", () => {
    expect(resolveFilter("starred", MBX)).toEqual({
      operator: "AND",
      conditions: [
        { hasKeyword: "$flagged" },
        {
          operator: "NOT",
          conditions: [{ inMailbox: "mt" }, { inMailbox: "ms" }],
        },
      ],
    })
  })

  it("starred sans trash/spam → filtre keyword seul (pas de NOT vide)", () => {
    const inboxOnly: AppMailbox[] = [
      {
        id: "mi",
        name: "In",
        role: "inbox",
        unreadEmails: 0,
        totalEmails: 0,
        sortOrder: 1,
      },
    ]
    expect(resolveFilter("starred", inboxOnly)).toEqual({
      hasKeyword: "$flagged",
    })
    expect(resolveFilter("starred", [])).toEqual({ hasKeyword: "$flagged" })
  })

  it("'spam' (URL) → mailbox de role 'junk' (RFC 8621, pas de role \"spam\")", () => {
    expect(resolveFilter("spam", MBX)).toEqual({ inMailbox: "ms" })
  })

  it("dossier connu mais mailbox non provisionnée → filtre match-none (liste vide, pas erreur)", () => {
    // 'sent' est connu mais absent de MBX → on n'erre pas, on renvoie un filtre vide
    expect(resolveFilter("sent", MBX)).toEqual({
      before: "1970-01-02T00:00:00Z",
    })
  })

  it("nom de dossier réellement inconnu → lève une erreur", () => {
    expect(() => resolveFilter("bogus", MBX)).toThrow(/Unknown mail folder/)
  })
})

describe("buildListMethodCalls", () => {
  it("Email/query inclut collapseThreads + calculateTotal + position/limit", () => {
    const calls = buildListMethodCalls("acc", { inMailbox: "mi" }, 50, 50)
    const [, query] = calls[0]
    expect(query).toMatchObject({
      accountId: "acc",
      collapseThreads: true,
      calculateTotal: true,
      position: 50,
      limit: 50,
      sort: [{ property: "receivedAt", isAscending: false }],
    })
    expect(query.filter).toEqual({ inMailbox: "mi" })
    expect(calls[1][0]).toBe("Email/get")
    expect(calls[2][0]).toBe("Thread/get")
    expect(calls[2][1]["#ids"]).toMatchObject({
      resultOf: "1",
      name: "Email/get",
      path: "/list/*/threadId",
    })
  })
})

describe("parseListPage", () => {
  it("assemble threads (messageCount via Thread/get), total et position", () => {
    const responses: JmapMethodResponse[] = [
      ["Email/query", { total: 120, position: 0 }, "0"],
      [
        "Email/get",
        {
          list: [
            {
              id: "e1",
              threadId: "t1",
              mailboxIds: { mi: true },
              keywords: { $flagged: true },
              from: [{ name: "Alice", email: "a@x.fr" }],
              to: [{ name: "Moi", email: "me@x.fr" }],
              subject: "Sujet",
              preview: "Aperçu",
              receivedAt: "2026-06-10T08:00:00Z",
              hasAttachment: true,
            },
          ],
        },
        "1",
      ],
      [
        "Thread/get",
        { list: [{ id: "t1", emailIds: ["e1", "e2", "e3"] }] },
        "2",
      ],
    ]
    const page = parseListPage(responses, 0)
    expect(page.total).toBe(120)
    expect(page.position).toBe(0)
    expect(page.threads).toHaveLength(1)
    expect(page.threads[0]).toMatchObject({
      id: "e1",
      threadId: "t1",
      messageCount: 3,
      unread: true, // $seen absent ⇒ non lu
      starred: true,
      hasAttachment: true,
      mailboxIds: ["mi"],
    })
  })

  it("unread = true quand $seen absent, false quand présent", () => {
    const mk = (keywords: Record<string, boolean>): JmapMethodResponse[] => [
      ["Email/query", { total: 1, position: 0 }, "0"],
      [
        "Email/get",
        {
          list: [
            {
              id: "e1",
              threadId: "t1",
              mailboxIds: {},
              keywords,
              from: [],
              to: [],
              subject: "",
              preview: "",
              receivedAt: "2026-06-10T08:00:00Z",
              hasAttachment: false,
            },
          ],
        },
        "1",
      ],
      ["Thread/get", { list: [{ id: "t1", emailIds: ["e1"] }] }, "2"],
    ]
    expect(parseListPage(mk({}), 0).threads[0].unread).toBe(true)
    expect(parseListPage(mk({ $seen: true }), 0).threads[0].unread).toBe(false)
  })

  it("réordonne Email/get selon l'ordre des ids de Email/query (RFC 8620 §5.1)", () => {
    const responses: JmapMethodResponse[] = [
      ["Email/query", { total: 3, position: 0, ids: ["e1", "e2", "e3"] }, "0"],
      [
        "Email/get",
        {
          // volontairement DÉSORDONNÉ par rapport à la query (e3, e1, e2)
          list: [
            {
              id: "e3",
              threadId: "t3",
              mailboxIds: { mi: true },
              keywords: {},
              from: [],
              to: [],
              subject: "C",
              preview: "",
              receivedAt: "2026-06-08T08:00:00Z",
              hasAttachment: false,
            },
            {
              id: "e1",
              threadId: "t1",
              mailboxIds: { mi: true },
              keywords: {},
              from: [],
              to: [],
              subject: "A",
              receivedAt: "2026-06-10T08:00:00Z",
            },
            {
              id: "e2",
              threadId: "t2",
              mailboxIds: { mi: true },
              keywords: {},
              from: [],
              to: [],
              subject: "B",
              receivedAt: "2026-06-09T08:00:00Z",
            },
          ],
        },
        "1",
      ],
      [
        "Thread/get",
        {
          list: [
            { id: "t1", emailIds: ["e1"] },
            { id: "t2", emailIds: ["e2"] },
            { id: "t3", emailIds: ["e3"] },
          ],
        },
        "2",
      ],
    ]
    const page = parseListPage(responses, 0)
    expect(page.threads.map((t) => t.id)).toEqual(["e1", "e2", "e3"])
    expect(page.threads.map((t) => t.subject)).toEqual(["A", "B", "C"])
  })
})

describe("parseThreadDetail", () => {
  const responses: JmapMethodResponse[] = [
    ["Thread/get", { list: [{ id: "t1", emailIds: ["e1", "e2"] }] }, "0"],
    [
      "Email/get",
      {
        list: [
          {
            id: "e2",
            from: [{ name: "Bob", email: "bob@x.io" }],
            to: [{ name: "Moi", email: "me@x.io" }],
            subject: "sujet",
            receivedAt: "2026-06-10T10:00:00Z",
            keywords: { $seen: true },
            hasAttachment: false,
            textBody: [],
            htmlBody: [{ partId: "q2" }],
            bodyValues: { q2: { value: "<b>e2</b>" } },
            attachments: [],
          },
          {
            id: "e1",
            from: [{ name: "Alice", email: "alice@x.io" }],
            to: [{ name: "Moi", email: "me@x.io" }],
            subject: "sujet",
            receivedAt: "2026-06-10T00:00:00Z",
            keywords: {},
            hasAttachment: true,
            textBody: [{ partId: "q1" }],
            htmlBody: [],
            bodyValues: { q1: { value: "texte e1" } },
            attachments: [
              {
                blobId: "b1",
                name: "cv.pdf",
                type: "application/pdf",
                size: 1234,
              },
            ],
          },
        ],
      },
      "1",
    ],
  ]

  it("ordonne les messages selon emailIds du Thread", () => {
    const d = parseThreadDetail(responses)
    expect(d.messages.map((m) => m.id)).toEqual(["e1", "e2"])
  })

  it("résout le corps depuis bodyValues", () => {
    const d = parseThreadDetail(responses)
    expect(d.messages[0].textBody).toBe("texte e1")
    expect(d.messages[1].htmlBody).toBe("<b>e2</b>")
  })

  it("calcule les agrégats unread/starred et emailIds", () => {
    const d = parseThreadDetail(responses)
    expect(d.threadId).toBe("t1")
    expect(d.emailIds).toEqual(["e1", "e2"])
    expect(d.unread).toBe(true) // e1 n'a pas $seen
    expect(d.starred).toBe(false)
    expect(d.subject).toBe("sujet") // sujet du 1er message chronologique
  })

  it("normalise cc null en [] et attachments manquants en []", () => {
    const d = parseThreadDetail(responses)
    expect(d.messages[1].cc).toEqual([])
    expect(d.messages[0].attachments).toHaveLength(1)
  })

  it("résiste aux réponses vides", () => {
    expect(parseThreadDetail([])).toEqual({
      threadId: "",
      subject: "",
      messages: [],
      emailIds: [],
      starred: false,
      unread: false,
    })
  })
})

describe("buildSetFlagsCall", () => {
  it("positionne le keyword à true", () => {
    expect(buildSetFlagsCall("acc", ["e1", "e2"], "$seen", true)).toEqual([
      [
        "Email/set",
        {
          accountId: "acc",
          update: {
            e1: { "keywords/$seen": true },
            e2: { "keywords/$seen": true },
          },
        },
        "0",
      ],
    ])
  })
  it("retire le keyword avec null quand value=false", () => {
    expect(buildSetFlagsCall("acc", ["e1"], "$flagged", false)).toEqual([
      [
        "Email/set",
        {
          accountId: "acc",
          update: { e1: { "keywords/$flagged": null } },
        },
        "0",
      ],
    ])
  })
})

describe("buildReadThreadCalls", () => {
  it("génère Thread/get + Email/get avec back-reference", () => {
    const calls = buildReadThreadCalls("acc", "t42")
    expect(calls[0][0]).toBe("Thread/get")
    expect(calls[0][1]).toMatchObject({ accountId: "acc", ids: ["t42"] })
    expect(calls[1][0]).toBe("Email/get")
    expect(calls[1][1]["#ids"]).toMatchObject({
      resultOf: "0",
      name: "Thread/get",
      path: "/list/*/emailIds",
    })
    expect(calls[1][1]).toMatchObject({
      fetchTextBodyValues: true,
      fetchHTMLBodyValues: true,
      maxBodyValueBytes: 256000,
    })
    const emailGet = calls[1][1] as { properties: string[] }
    expect(emailGet.properties).toContain("keywords")
    expect(emailGet.properties).toContain("bodyValues")
    expect(emailGet.properties).not.toContain("mailboxIds")
  })
})

// ---------------------------------------------------------------------------
// Task 5 — buildMovePatch / parseEmailMailboxes / resolveTargetMailbox
// ---------------------------------------------------------------------------

const MOVE_MBX = [
  { id: "mi", role: "inbox" },
  { id: "ma", role: "archive" },
  { id: "lbl", role: null }, // label (4d) — doit être préservé
]

describe("buildMovePatch", () => {
  it("retire les dossiers système actuels et ajoute la cible (patch ciblé)", () => {
    expect(
      buildMovePatch("acc", [{ id: "e1", mailboxIds: ["mi"] }], MOVE_MBX, "ma")
    ).toEqual([
      [
        "Email/set",
        {
          accountId: "acc",
          update: { e1: { "mailboxIds/ma": true, "mailboxIds/mi": null } },
        },
        "0",
      ],
    ])
  })
  it("préserve les mailboxes sans role (labels) — ne les met pas à null", () => {
    const out = buildMovePatch(
      "acc",
      [{ id: "e1", mailboxIds: ["mi", "lbl"] }],
      MOVE_MBX,
      "ma"
    )
    const patch = (
      out[0][1] as { update: Record<string, Record<string, unknown>> }
    ).update.e1
    expect(patch).toEqual({ "mailboxIds/ma": true, "mailboxIds/mi": null })
    expect(patch["mailboxIds/lbl"]).toBeUndefined()
  })
  it("batch : patche chaque email indépendamment et préserve les labels", () => {
    const result = buildMovePatch(
      "acc",
      [
        { id: "e1", mailboxIds: ["mi"] },
        { id: "e2", mailboxIds: ["mi", "lbl"] },
      ],
      MOVE_MBX,
      "ma"
    )
    const { update } = result[0][1] as {
      update: Record<string, Record<string, unknown>>
    }
    expect(Object.keys(update)).toEqual(["e1", "e2"])
    expect(update.e1).toEqual({ "mailboxIds/ma": true, "mailboxIds/mi": null })
    expect(update.e2).toEqual({ "mailboxIds/ma": true, "mailboxIds/mi": null })
    expect(update.e2["mailboxIds/lbl"]).toBeUndefined()
  })
  it("idempotent si déjà dans la cible", () => {
    expect(
      buildMovePatch("acc", [{ id: "e1", mailboxIds: ["ma"] }], MOVE_MBX, "ma")
    ).toEqual([
      [
        "Email/set",
        { accountId: "acc", update: { e1: { "mailboxIds/ma": true } } },
        "0",
      ],
    ])
  })
})

describe("parseEmailMailboxes", () => {
  it("extrait {id, mailboxIds[]} depuis Email/get", () => {
    const responses: JmapMethodResponse[] = [
      [
        "Email/get",
        { list: [{ id: "e1", mailboxIds: { mi: true, lbl: true } }] },
        "0",
      ],
    ]
    expect(parseEmailMailboxes(responses)).toEqual([
      { id: "e1", mailboxIds: ["mi", "lbl"] },
    ])
  })
  it("résiste à mailboxIds absent", () => {
    expect(
      parseEmailMailboxes([["Email/get", { list: [{ id: "e1" }] }, "0"]])
    ).toEqual([{ id: "e1", mailboxIds: [] }])
  })
  it("liste vide → []", () => {
    expect(parseEmailMailboxes([["Email/get", { list: [] }, "0"]])).toEqual([])
  })
})

describe("resolveTargetMailbox", () => {
  it("résout 'archive' → id du role archive", () => {
    expect(
      resolveTargetMailbox("archive", [{ id: "ma", role: "archive" }])
    ).toBe("ma")
  })
  it("'spam' (URL) → role junk", () => {
    expect(resolveTargetMailbox("spam", [{ id: "mj", role: "junk" }])).toBe(
      "mj"
    )
  })
  it("role absent → undefined", () => {
    expect(
      resolveTargetMailbox("trash", [{ id: "mi", role: "inbox" }])
    ).toBeUndefined()
  })
})
