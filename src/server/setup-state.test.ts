import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as JmapModule from './jmap'

vi.mock('./setup-flag', () => ({ isSetupComplete: vi.fn() }))
vi.mock('./stalwart-bootstrap', () => ({ isBootstrapMode: vi.fn() }))
vi.mock('./stalwart-domain', () => ({ getPrimaryDomain: vi.fn() }))
vi.mock('./jmap', async (importActual) => ({
  ...(await importActual<typeof JmapModule>()),
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'd333333'),
}))

// eslint-disable-next-line import/first
import { isSetupComplete } from './setup-flag'
// eslint-disable-next-line import/first
import { isBootstrapMode } from './stalwart-bootstrap'
// eslint-disable-next-line import/first
import { getPrimaryDomain } from './stalwart-domain'
// eslint-disable-next-line import/first
import { jmapCall } from './jmap'
// eslint-disable-next-line import/first
import { deriveSetupStep } from './setup-state'

const flag = vi.mocked(isSetupComplete)
const boot = vi.mocked(isBootstrapMode)
const dom = vi.mocked(getPrimaryDomain)
const mj = vi.mocked(jmapCall)

// Helper: a JMAP query+get pair for the given account list.
const accounts = (list: Array<{ name?: string; description?: string }>) =>
  [
    ['x:Account/query', { ids: list.map((_, i) => String(i)) }, '0'],
    ['x:Account/get', { list }, '1'],
  ] as [string, Record<string, unknown>, string][]

// The system admin Stalwart auto-creates during bootstrap.
const SYSTEM_ADMIN = { name: 'admin', description: 'System administrator' }

beforeEach(() => {
  vi.clearAllMocks()
  boot.mockResolvedValue(false)
  dom.mockResolvedValue(null)
  mj.mockResolvedValue(accounts([SYSTEM_ADMIN])) // only the system admin by default
})

describe('deriveSetupStep', () => {
  it('returns "done" when the flag is set', async () => {
    flag.mockReturnValue(true)
    expect(await deriveSetupStep()).toBe('done')
  })

  it('returns "collect" in bootstrap mode', async () => {
    flag.mockReturnValue(false)
    boot.mockResolvedValue(true)
    expect(await deriveSetupStep()).toBe('collect')
  })

  it('returns "account" when only the auto-created system admin exists', async () => {
    flag.mockReturnValue(false)
    mj.mockResolvedValue(accounts([SYSTEM_ADMIN]))
    expect(await deriveSetupStep()).toBe('account')
  })

  it('treats a user-created account named "admin" but without the system description as a real account', async () => {
    flag.mockReturnValue(false)
    mj.mockResolvedValue(accounts([SYSTEM_ADMIN, { name: 'koffi' }]))
    dom.mockResolvedValue({ id: 'b', name: 'exemple.fr', dnsManagement: { '@type': 'Manual' } })
    expect(await deriveSetupStep()).toBe('dns')
  })

  it('returns "dns" when a user account exists but dnsManagement is Manual', async () => {
    flag.mockReturnValue(false)
    mj.mockResolvedValue(accounts([SYSTEM_ADMIN, { name: 'koffi' }]))
    dom.mockResolvedValue({ id: 'b', name: 'exemple.fr', dnsManagement: { '@type': 'Manual' } })
    expect(await deriveSetupStep()).toBe('dns')
  })

  it('returns "ssl" when a user account exists and dnsManagement is Automatic', async () => {
    flag.mockReturnValue(false)
    mj.mockResolvedValue(accounts([SYSTEM_ADMIN, { name: 'koffi' }]))
    dom.mockResolvedValue({ id: 'b', name: 'exemple.fr', dnsManagement: { '@type': 'Automatic' } })
    expect(await deriveSetupStep()).toBe('ssl')
  })

  it('propagates errors from the account query instead of forcing the account step', async () => {
    flag.mockReturnValue(false)
    mj.mockResolvedValue([
      ['x:Account/query', { ids: ['0'] }, '0'],
      ['error', { type: 'serverFail' }, '1'],
    ])
    await expect(deriveSetupStep()).rejects.toThrow()
  })
})
