import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitBootstrap } from './stalwart-bootstrap'
import { requestStalwartRestart } from './stalwart-restart'
import { getStepHandler, submitBootstrapHandler } from './setup-actions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ validator: () => ({ handler: (fn: unknown) => fn }), handler: (fn: unknown) => fn }),
}))
vi.mock('./setup-state', () => ({ deriveSetupStep: vi.fn(async () => 'collect') }))
vi.mock('./stalwart-bootstrap', () => ({ submitBootstrap: vi.fn(async () => ({ username: 'admin@exemple.fr', secret: 'g' })) }))
vi.mock('./stalwart-restart', () => ({ requestStalwartRestart: vi.fn() }))

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
})
