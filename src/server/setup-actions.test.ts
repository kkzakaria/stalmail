import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitBootstrap } from './stalwart-bootstrap'
import { requestStalwartRestart } from './stalwart-restart'
import { getStepHandler, submitBootstrapHandler, createAdminAccountHandler, createDnsServerHandler, setDnsManagementHandler, dnsGridStatusHandler, configureAcmeHandler, acmeStatusHandler, finishSetupHandler } from './setup-actions'
import type * as StalwartAccountModule from './stalwart-account'
import type * as StalwartDomainModule from './stalwart-domain'
import type * as StalwartDnsModule from './stalwart-dns'
import type * as DnsZoneModule from './dns-zone'
import type * as DnsResolveModule from './dns-resolve'
import type * as StalwartAcmeModule from './stalwart-acme'
import type * as SetupFlagModule from './setup-flag'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: () => ({ handler: (fn: unknown) => fn }), handler: (fn: unknown) => fn }),
}))
vi.mock('./setup-state', () => ({ deriveSetupStep: vi.fn(async () => 'collect') }))
vi.mock('./stalwart-bootstrap', () => ({ submitBootstrap: vi.fn(async () => ({ username: 'admin@exemple.fr', secret: 'g' })) }))
vi.mock('./stalwart-restart', () => ({ requestStalwartRestart: vi.fn() }))
vi.mock('./stalwart-domain', async (importActual) => ({
  ...(await importActual<typeof StalwartDomainModule>()),
  getPrimaryDomain: vi.fn(async () => ({ id: 'dom-1', name: 'exemple.fr' })),
  setDnsManagementAutomatic: vi.fn(async () => undefined),
}))
vi.mock('./stalwart-account', async (importActual) => ({
  ...(await importActual<typeof StalwartAccountModule>()),
  createAdminAccount: vi.fn(async () => 'acc-1'),
}))
vi.mock('./stalwart-dns', async (importActual) => ({
  ...(await importActual<typeof StalwartDnsModule>()),
  createDnsServer: vi.fn(async () => 'srv-1'),
}))
vi.mock('./dns-zone', async (importActual) => ({
  ...(await importActual<typeof DnsZoneModule>()),
  parseZoneFile: vi.fn(() => []),
}))
vi.mock('./dns-resolve', async (importActual) => ({
  ...(await importActual<typeof DnsResolveModule>()),
  resolveRecordStatus: vi.fn(async () => 'verified'),
}))
vi.mock('./stalwart-acme', async (importActual) => ({
  ...(await importActual<typeof StalwartAcmeModule>()),
  configureAcme: vi.fn(async () => 'prov-1'),
  getAcmeStatus: vi.fn(async () => 'pending'),
}))
vi.mock('./setup-flag', async (importActual) => ({
  ...(await importActual<typeof SetupFlagModule>()),
  markSetupComplete: vi.fn(),
}))

// eslint-disable-next-line import/first
import { getPrimaryDomain, setDnsManagementAutomatic } from './stalwart-domain'
// eslint-disable-next-line import/first
import { createAdminAccount, WeakPasswordError } from './stalwart-account'
// eslint-disable-next-line import/first
import { createDnsServer } from './stalwart-dns'
// eslint-disable-next-line import/first
import { parseZoneFile } from './dns-zone'
// eslint-disable-next-line import/first
import { resolveRecordStatus } from './dns-resolve'
// eslint-disable-next-line import/first
import { configureAcme, getAcmeStatus } from './stalwart-acme'
// eslint-disable-next-line import/first
import { markSetupComplete } from './setup-flag'

beforeEach(() => vi.clearAllMocks())

describe('getStepHandler', () => {
  it('returns the derived step', async () => {
    expect(await getStepHandler()).toEqual({ step: 'collect' })
  })
})

describe('submitBootstrapHandler', () => {
  it('submits bootstrap then requests a Stalwart restart', async () => {
    const out = await submitBootstrapHandler({ data: { serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' } })
    expect(submitBootstrap).toHaveBeenCalledWith({ serverHostname: 'mail.exemple.fr', defaultDomain: 'exemple.fr' })
    expect(requestStalwartRestart).toHaveBeenCalled()
    expect(out).toEqual({ ok: true })
  })

  it('does not request a restart if submitBootstrap throws', async () => {
    vi.mocked(submitBootstrap).mockRejectedValueOnce(new Error('network'))
    await expect(
      submitBootstrapHandler({ data: { serverHostname: 'x', defaultDomain: 'y' } }),
    ).rejects.toThrow('network')
    expect(requestStalwartRestart).not.toHaveBeenCalled()
  })
})

describe('createAdminAccountHandler', () => {
  it('returns {status:"ok"} on success and calls createAdminAccount with correct args', async () => {
    vi.mocked(createAdminAccount).mockResolvedValueOnce('acc-1')
    const result = await createAdminAccountHandler({ data: { name: 'koffi', password: 'correct horse battery staple' } })
    expect(result).toEqual({ status: 'ok' })
    expect(createAdminAccount).toHaveBeenCalledWith({ name: 'koffi', domainId: 'dom-1', password: 'correct horse battery staple' })
  })

  it('returns {status:"weak"} when createAdminAccount throws WeakPasswordError', async () => {
    vi.mocked(createAdminAccount).mockRejectedValueOnce(new WeakPasswordError('too weak'))
    const result = await createAdminAccountHandler({ data: { name: 'koffi', password: 'abc' } })
    expect(result).toEqual({ status: 'weak', message: 'too weak' })
  })

  it('rethrows other errors', async () => {
    vi.mocked(createAdminAccount).mockRejectedValueOnce(new Error('network failure'))
    await expect(
      createAdminAccountHandler({ data: { name: 'koffi', password: 'correct horse battery staple' } }),
    ).rejects.toThrow('network failure')
  })

  it('throws when no primary domain is found', async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce(null)
    await expect(
      createAdminAccountHandler({ data: { name: 'koffi', password: 'correct horse battery staple' } }),
    ).rejects.toThrow('No primary domain found')
  })
})

describe('createDnsServerHandler', () => {
  it('returns {dnsServerId} from createDnsServer', async () => {
    vi.mocked(createDnsServer).mockResolvedValueOnce('srv-1')
    const result = await createDnsServerHandler({ data: { provider: 'Cloudflare', secret: 'tok-abc' } })
    expect(result).toEqual({ dnsServerId: 'srv-1' })
  })
})

describe('setDnsManagementHandler', () => {
  it('resolves the domain and calls setDnsManagementAutomatic with correct args', async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce({ id: 'dom-1', name: 'example.com' })
    vi.mocked(setDnsManagementAutomatic).mockResolvedValueOnce(undefined)
    const result = await setDnsManagementHandler({ data: { dnsServerId: 'srv-1' } })
    expect(result).toEqual({ ok: true })
    expect(setDnsManagementAutomatic).toHaveBeenCalledWith({ domainId: 'dom-1', dnsServerId: 'srv-1', origin: 'example.com' })
  })

  it('throws when getPrimaryDomain returns null', async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce(null)
    await expect(
      setDnsManagementHandler({ data: { dnsServerId: 'srv-1' } }),
    ).rejects.toThrow('No primary domain found')
  })
})

describe('dnsGridStatusHandler', () => {
  it('maps verified/mismatch/missing to verified/error/pending', async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce({
      id: 'dom-1',
      name: 'example.com',
      dnsZoneFile: 'zone content',
    })
    const fakeRecords = [
      { name: 'example.com', type: 'A', value: '1.2.3.4' },
      { name: 'mail.example.com', type: 'MX', value: 'mail.example.com' },
      { name: '_dmarc.example.com', type: 'TXT', value: 'v=DMARC1' },
    ]
    vi.mocked(parseZoneFile).mockReturnValueOnce(fakeRecords)
    vi.mocked(resolveRecordStatus)
      .mockResolvedValueOnce('verified')
      .mockResolvedValueOnce('mismatch')
      .mockResolvedValueOnce('missing')
    const result = await dnsGridStatusHandler()
    expect(result.origin).toBe('example.com')
    expect(result.records).toHaveLength(3)
    expect(result.records[0].status).toBe('verified')
    expect(result.records[1].status).toBe('error')
    expect(result.records[2].status).toBe('pending')
  })

  it('returns {records:[]} when domain has no dnsZoneFile', async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce({ id: 'dom-1', name: 'example.com' })
    const result = await dnsGridStatusHandler()
    expect(result).toEqual({ origin: 'example.com', records: [] })
  })
})

describe('configureAcmeHandler', () => {
  it('resolves the domain and calls configureAcme with correct args, returns {ok:true}', async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce({ id: 'dom-1', name: 'example.com' })
    vi.mocked(configureAcme).mockResolvedValueOnce('prov-1')
    const result = await configureAcmeHandler({ data: { hostname: 'mail.example.com', contactEmail: 'admin@example.com' } })
    expect(configureAcme).toHaveBeenCalledWith({ domainId: 'dom-1', hostname: 'mail.example.com', contactEmail: 'admin@example.com' })
    expect(result).toEqual({ ok: true })
  })

  it('throws when getPrimaryDomain returns null', async () => {
    vi.mocked(getPrimaryDomain).mockResolvedValueOnce(null)
    await expect(
      configureAcmeHandler({ data: { hostname: 'mail.example.com', contactEmail: 'admin@example.com' } }),
    ).rejects.toThrow('No primary domain found')
  })
})

describe('acmeStatusHandler', () => {
  it('returns {status} from getAcmeStatus', async () => {
    vi.mocked(getAcmeStatus).mockResolvedValueOnce('pending')
    const result = await acmeStatusHandler()
    expect(result).toEqual({ status: 'pending' })
  })
})

describe('finishSetupHandler', () => {
  it('calls markSetupComplete and returns {ok:true}', async () => {
    const result = await finishSetupHandler()
    expect(markSetupComplete).toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
  })
})
