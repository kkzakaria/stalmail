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
  isSslAcknowledged,
  markSslAcknowledged,
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
    try {
      markSetupComplete()
      expect(writeFileSync).toHaveBeenCalledWith(
        "/custom/run/.stalmail-configured",
        expect.any(String),
        "utf-8"
      )
    } finally {
      delete process.env.STALMAIL_RUN_DIR
    }
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
    try {
      markDnsConfigured()
      expect(writeFileSync).toHaveBeenCalledWith(
        "/custom/run/.stalmail-dns-configured",
        expect.any(String),
        "utf-8"
      )
    } finally {
      delete process.env.STALMAIL_RUN_DIR
    }
  })
})

describe("isSslAcknowledged", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns true when SSL flag file exists", () => {
    vi.mocked(existsSync).mockReturnValueOnce(true)
    expect(isSslAcknowledged()).toBe(true)
  })

  it("returns false when SSL flag file does not exist", () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    expect(isSslAcknowledged()).toBe(false)
  })
})

describe("markSslAcknowledged", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes an ISO timestamp to the SSL flag file path", () => {
    markSslAcknowledged()
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".stalmail-ssl-configured"),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      "utf-8"
    )
  })

  it("respects STALMAIL_RUN_DIR env variable for the SSL path", () => {
    process.env.STALMAIL_RUN_DIR = "/custom/run"
    try {
      markSslAcknowledged()
      expect(writeFileSync).toHaveBeenCalledWith(
        "/custom/run/.stalmail-ssl-configured",
        expect.any(String),
        "utf-8"
      )
    } finally {
      delete process.env.STALMAIL_RUN_DIR
    }
  })
})
