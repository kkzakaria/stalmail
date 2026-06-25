import { describe, expect, it, vi, beforeEach } from "vitest"
import { isRedirect } from "@tanstack/react-router"
import { withFreshAccessToken } from "./session"
import { stalwartUserFetch } from "./stalwart-user"
import {
  jmapUserCall,
  JmapUserError,
  SUBMISSION_CAPABILITIES,
  capabilitiesForBatch,
} from "./jmap-user"

vi.mock("./session", () => ({ withFreshAccessToken: vi.fn() }))
vi.mock("./stalwart-user", () => ({ stalwartUserFetch: vi.fn() }))

const methodCalls = [
  ["Mailbox/get", { accountId: "a1", ids: null }, "0"],
] as const

beforeEach(() => {
  vi.resetAllMocks()
})

describe("jmapUserCall", () => {
  it("envoie le batch en Bearer et retourne methodResponses", async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue("tok-123")
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          methodResponses: [["Mailbox/get", { list: [] }, "0"]],
        }),
        {
          status: 200,
        }
      )
    )

    const res = await jmapUserCall("sid-1", methodCalls as never)

    expect(withFreshAccessToken).toHaveBeenCalledWith("sid-1")
    const [path, token, init] = vi.mocked(stalwartUserFetch).mock.calls[0]
    expect(path).toBe("/jmap/")
    expect(token).toBe("tok-123")
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.using).toContain("urn:ietf:params:jmap:mail")
    expect(body.methodCalls).toEqual(methodCalls)
    expect(res).toEqual([["Mailbox/get", { list: [] }, "0"]])
  })

  it("token null → throw redirect /login (sans appel sortant)", async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue(null)
    try {
      await jmapUserCall("sid-1", methodCalls as never)
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(isRedirect(err)).toBe(true)
      // Verrouille la destination : le contrat de jmapUserCall est spécifiquement /login.
      expect(err).toMatchObject({ options: { to: "/login" } })
    }
    expect(stalwartUserFetch).not.toHaveBeenCalled()
  })

  it("HTTP non-2xx → JmapUserError", async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue("tok")
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response("nope", { status: 500 })
    )
    await expect(
      jmapUserCall("sid-1", methodCalls as never)
    ).rejects.toBeInstanceOf(JmapUserError)
  })

  it('réponse method ["error", ...] → JmapUserError avec type', async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue("tok")
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          methodResponses: [["error", { type: "serverFail" }, "0"]],
        }),
        { status: 200 }
      )
    )
    await expect(
      jmapUserCall("sid-1", methodCalls as never)
    ).rejects.toMatchObject({
      name: "JmapUserError",
      type: "serverFail",
    })
  })

  it("payload malformé (non-JSON ou sans methodResponses) → JmapUserError", async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue("tok")
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response("not json", { status: 200 })
    )
    await expect(
      jmapUserCall("sid-1", methodCalls as never)
    ).rejects.toBeInstanceOf(JmapUserError)

    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), { status: 200 })
    )
    await expect(
      jmapUserCall("sid-1", methodCalls as never)
    ).rejects.toBeInstanceOf(JmapUserError)
  })

  it("inclut la capability submission quand on passe SUBMISSION_CAPABILITIES", async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue("tok")
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(JSON.stringify({ methodResponses: [] }), { status: 200 })
    )

    await jmapUserCall(
      "sid",
      [["X/get", {}, "0"]] as never,
      SUBMISSION_CAPABILITIES
    )

    const [, , init] = vi.mocked(stalwartUserFetch).mock.calls[0]
    const sent = JSON.parse((init as RequestInit).body as string) as {
      using: string[]
    }
    expect(sent.using).toContain("urn:ietf:params:jmap:submission")
  })

  it("n'inclut PAS submission par défaut (R5)", async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue("tok")
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(JSON.stringify({ methodResponses: [] }), { status: 200 })
    )

    await jmapUserCall("sid", [["X/get", {}, "0"]] as never)

    const [, , init] = vi.mocked(stalwartUserFetch).mock.calls[0]
    const sent = JSON.parse((init as RequestInit).body as string) as {
      using: string[]
    }
    expect(sent.using).not.toContain("urn:ietf:params:jmap:submission")
  })

  it("auto-inclut submission quand le batch contient Identity/get (sans cap explicite)", async () => {
    // Régression : sendMailFn lit Mailbox/get + Identity/get sans passer de capabilities.
    // Identity/* relève de la spec submission → Stalwart rejetait l'appel en unknownMethod.
    vi.mocked(withFreshAccessToken).mockResolvedValue("tok")
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(JSON.stringify({ methodResponses: [] }), { status: 200 })
    )

    await jmapUserCall("sid", [
      ["Mailbox/get", {}, "0"],
      ["Identity/get", {}, "1"],
    ] as never)

    const [, , init] = vi.mocked(stalwartUserFetch).mock.calls[0]
    const sent = JSON.parse((init as RequestInit).body as string) as {
      using: string[]
    }
    expect(sent.using).toContain("urn:ietf:params:jmap:submission")
  })
})

describe("capabilitiesForBatch", () => {
  const SUB = "urn:ietf:params:jmap:submission"

  it("ne contient PAS submission pour un batch mail seul", () => {
    expect(
      capabilitiesForBatch([["Mailbox/get", {}, "0"]] as never)
    ).not.toContain(SUB)
  })

  it("ajoute submission si le batch contient Identity/get", () => {
    expect(
      capabilitiesForBatch([
        ["Mailbox/get", {}, "0"],
        ["Identity/get", {}, "1"],
      ] as never)
    ).toContain(SUB)
  })

  it("ajoute submission si le batch contient EmailSubmission/set", () => {
    expect(
      capabilitiesForBatch([["EmailSubmission/set", {}, "0"]] as never)
    ).toContain(SUB)
  })

  it("conserve toujours les capabilities mail de base", () => {
    expect(capabilitiesForBatch([["Email/get", {}, "0"]] as never)).toEqual([
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
    ])
  })
})
