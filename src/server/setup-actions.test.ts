import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitBootstrap } from './stalwart-bootstrap'
import { requestStalwartRestart } from './stalwart-restart'
import { getStepHandler, submitBootstrapHandler, createAdminAccountHandler } from './setup-actions'
import type * as StalwartAccountModule from './stalwart-account'
import type * as StalwartDomainModule from './stalwart-domain'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: () => ({ handler: (fn: unknown) => fn }), handler: (fn: unknown) => fn }),
}))
vi.mock('./setup-state', () => ({ deriveSetupStep: vi.fn(async () => 'collect') }))
vi.mock('./stalwart-bootstrap', () => ({ submitBootstrap: vi.fn(async () => ({ username: 'admin@exemple.fr', secret: 'g' })) }))
vi.mock('./stalwart-restart', () => ({ requestStalwartRestart: vi.fn() }))
vi.mock('./stalwart-domain', async (importActual) => ({
  ...(await importActual<typeof StalwartDomainModule>()),
  getPrimaryDomain: vi.fn(async () => ({ id: 'dom-1', name: 'exemple.fr' })),
}))
vi.mock('./stalwart-account', async (importActual) => ({
  ...(await importActual<typeof StalwartAccountModule>()),
  createAdminAccount: vi.fn(async () => 'acc-1'),
}))

// eslint-disable-next-line import/first
import { getPrimaryDomain } from './stalwart-domain'
// eslint-disable-next-line import/first
import { createAdminAccount, WeakPasswordError } from './stalwart-account'

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
