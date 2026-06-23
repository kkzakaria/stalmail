import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

// eslint-disable-next-line import/first
import { existsSync, writeFileSync } from "node:fs"
// eslint-disable-next-line import/first
import {
  isSetupComplete,
  markSetupComplete,
  isDnsConfigured,
  markDnsConfigured,
} from "./setup-flag"

describe("isSetupComplete", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns true when flag file exists", () => {
    vi.mocked(existsSync).mockReturnValueOnce(true)
    expect(isSetupComplete()).toBe(true)
  })

  it("returns false when flag file does not exist", () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    expect(isSetupComplete()).toBe(false)
  })
})

describe("markSetupComplete", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes an ISO timestamp to the flag file path", () => {
    markSetupComplete()
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".stalmail-configured"),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      "utf-8"
    )
  })

  it("respects STALMAIL_RUN_DIR env variable for the path", () => {
    process.env.STALMAIL_RUN_DIR = "/custom/run"
    markSetupComplete()
    expect(writeFileSync).toHaveBeenCalledWith(
      "/custom/run/.stalmail-configured",
      expect.any(String),
      "utf-8"
    )
    delete process.env.STALMAIL_RUN_DIR
  })
})

describe("isDnsConfigured", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns true when DNS flag file exists", () => {
    vi.mocked(existsSync).mockReturnValueOnce(true)
    expect(isDnsConfigured()).toBe(true)
  })

  it("returns false when DNS flag file does not exist", () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    expect(isDnsConfigured()).toBe(false)
  })
})

describe("markDnsConfigured", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes an ISO timestamp to the DNS flag file path", () => {
    markDnsConfigured()
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".stalmail-dns-configured"),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      "utf-8"
    )
  })

  it("respects STALMAIL_RUN_DIR env variable for the DNS path", () => {
    process.env.STALMAIL_RUN_DIR = "/custom/run"
    markDnsConfigured()
    expect(writeFileSync).toHaveBeenCalledWith(
      "/custom/run/.stalmail-dns-configured",
      expect.any(String),
      "utf-8"
    )
    delete process.env.STALMAIL_RUN_DIR
  })
})
