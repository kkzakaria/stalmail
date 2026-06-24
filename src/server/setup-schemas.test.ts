// Dedicated tests for the exported Zod schemas in setup-actions.ts.
// These run independently of the createServerFn mock so validator logic is
// actually exercised (the mock bypasses validators in setup-actions.test.ts).
import { describe, it, expect } from "vitest"
import {
  createDnsServerSchema,
  createAccountSchema,
  configureAcmeSchema,
} from "./setup-actions"

describe("createDnsServerSchema", () => {
  it("accepts a valid automatic provider and non-empty secret", () => {
    expect(() =>
      createDnsServerSchema.parse({ provider: "Cloudflare", secret: "tok-abc" })
    ).not.toThrow()
  })

  it('rejects "Manual" as a provider', () => {
    expect(() =>
      createDnsServerSchema.parse({ provider: "Manual", secret: "tok-abc" })
    ).toThrow()
  })

  it("rejects an unknown provider", () => {
    expect(() =>
      createDnsServerSchema.parse({ provider: "Bogus", secret: "tok-abc" })
    ).toThrow()
  })

  it("rejects an empty secret", () => {
    expect(() =>
      createDnsServerSchema.parse({ provider: "Cloudflare", secret: "" })
    ).toThrow()
  })

  it("rejects a secret longer than 4096 chars", () => {
    expect(() =>
      createDnsServerSchema.parse({
        provider: "Cloudflare",
        secret: "x".repeat(4097),
      })
    ).toThrow()
  })

  it("accepts a secret at the max boundary (4096 chars)", () => {
    expect(() =>
      createDnsServerSchema.parse({
        provider: "Cloudflare",
        secret: "x".repeat(4096),
      })
    ).not.toThrow()
  })
})

describe("createAccountSchema", () => {
  it("accepts valid name and password", () => {
    expect(() =>
      createAccountSchema.parse({ name: "alice", password: "correct-horse-9" })
    ).not.toThrow()
  })

  it("rejects an empty name", () => {
    expect(() =>
      createAccountSchema.parse({ name: "", password: "correct-horse-9" })
    ).toThrow()
  })

  it("rejects an empty password", () => {
    expect(() =>
      createAccountSchema.parse({ name: "alice", password: "" })
    ).toThrow()
  })

  it("rejects a name longer than 64 chars", () => {
    expect(() =>
      createAccountSchema.parse({
        name: "a".repeat(65),
        password: "correct-horse-9",
      })
    ).toThrow()
  })

  it("rejects a password longer than 256 chars", () => {
    expect(() =>
      createAccountSchema.parse({
        name: "alice",
        password: "x".repeat(257),
      })
    ).toThrow()
  })
})

describe("configureAcmeSchema", () => {
  it("accepts valid hostname and contactEmail", () => {
    expect(() =>
      configureAcmeSchema.parse({
        hostname: "mail.example.com",
        contactEmail: "admin@example.com",
      })
    ).not.toThrow()
  })

  it("accepts empty strings (pure-resume case)", () => {
    // On resume the client may send empty strings; handler resolves server-side.
    expect(() =>
      configureAcmeSchema.parse({ hostname: "", contactEmail: "" })
    ).not.toThrow()
  })

  it("rejects a non-empty non-email contactEmail", () => {
    expect(() =>
      configureAcmeSchema.parse({
        hostname: "mail.example.com",
        contactEmail: "x",
      })
    ).toThrow()
  })

  it("rejects a hostname longer than 253 chars", () => {
    expect(() =>
      configureAcmeSchema.parse({
        hostname: "a".repeat(254),
        contactEmail: "a@b.com",
      })
    ).toThrow()
  })

  it("rejects a contactEmail longer than 254 chars", () => {
    expect(() =>
      configureAcmeSchema.parse({
        hostname: "mail.example.com",
        contactEmail: "a".repeat(255),
      })
    ).toThrow()
  })
})
