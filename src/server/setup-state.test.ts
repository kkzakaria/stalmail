import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./setup-flag', () => ({ isSetupComplete: vi.fn() }))
vi.mock('./stalwart-bootstrap', () => ({ isBootstrapMode: vi.fn() }))
vi.mock('./stalwart-domain', () => ({ getPrimaryDomain: vi.fn() }))
vi.mock('./jmap', () => ({ jmapCall: vi.fn(), resolveAccountId: vi.fn(async () => 'd333333') }))

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

beforeEach(() => {
  vi.clearAllMocks()
  mj.mockResolvedValue([['x:Account/query', { ids: [] }, '0']]) // no admin user by default
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

  it('returns "account" in normal mode with no admin user', async () => {
    flag.mockReturnValue(false)
    boot.mockResolvedValue(false)
    mj.mockResolvedValue([['x:Account/query', { ids: [] }, '0']])
    expect(await deriveSetupStep()).toBe('account')
  })

  it('returns "dns" when an admin exists but dnsManagement is Manual', async () => {
    flag.mockReturnValue(false)
    boot.mockResolvedValue(false)
    mj.mockResolvedValue([['x:Account/query', { ids: ['c'] }, '0']])
    dom.mockResolvedValue({ id: 'b', name: 'exemple.fr', dnsManagement: { '@type': 'Manual' } })
    expect(await deriveSetupStep()).toBe('dns')
  })

  it('returns "ssl" when dnsManagement is Automatic but the finish flag is unset', async () => {
    flag.mockReturnValue(false)
    boot.mockResolvedValue(false)
    mj.mockResolvedValue([['x:Account/query', { ids: ['c'] }, '0']])
    dom.mockResolvedValue({ id: 'b', name: 'exemple.fr', dnsManagement: { '@type': 'Automatic' } })
    expect(await deriveSetupStep()).toBe('ssl')
  })
})
