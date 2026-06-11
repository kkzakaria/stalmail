import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as JmapModule from './jmap'

vi.mock('./jmap', async (importActual) => ({
  ...(await importActual<typeof JmapModule>()),
  jmapCall: vi.fn(),
  resolveAccountId: vi.fn(async () => 'd333333'),
}))

// eslint-disable-next-line import/first
import { jmapCall, JmapError } from './jmap'
// eslint-disable-next-line import/first
import { createAdminAccount, WeakPasswordError } from './stalwart-account'

const mj = vi.mocked(jmapCall)
beforeEach(() => vi.clearAllMocks())

describe('createAdminAccount', () => {
  it('creates a User with name, domainId, password credential and Admin role', async () => {
    mj.mockResolvedValue([['x:Account/set', { created: { u1: { id: 'c' } } }, '0']])
    const id = await createAdminAccount({ name: 'koffi', domainId: 'b', password: 'correct horse battery staple' })
    expect(id).toBe('c')
    const [[, args]] = mj.mock.calls[0][0] as [[string, Record<string, unknown>, string]]
    expect(args.create).toEqual({
      u1: {
        '@type': 'User',
        name: 'koffi',
        domainId: 'b',
        credentials: { '0': { '@type': 'Password', secret: 'correct horse battery staple' } },
        roles: { '@type': 'Admin' },
      },
    })
  })

  it('throws WeakPasswordError when the server rejects a weak secret', async () => {
    mj.mockResolvedValue([
      ['x:Account/set', { notCreated: { u1: { type: 'invalidProperties', properties: ['secret'], description: 'Password is too weak. ...' } } }, '0'],
    ])
    await expect(
      createAdminAccount({ name: 'koffi', domainId: 'b', password: 'password' }),
    ).rejects.toBeInstanceOf(WeakPasswordError)
  })

  it('throws a generic error for other rejections', async () => {
    mj.mockResolvedValue([['x:Account/set', { notCreated: { u1: { type: 'invalidProperties', properties: ['name'] } } }, '0']])
    await expect(
      createAdminAccount({ name: 'bad name', domainId: 'b', password: 'correct horse battery staple' }),
    ).rejects.toBeInstanceOf(JmapError)
  })

  it('maps primaryKeyViolation (email taken) to a clearer "already in use" error', async () => {
    mj.mockResolvedValue([
      ['x:Account/set', { notCreated: { u1: { type: 'primaryKeyViolation', properties: ['email'] } } }, '0'],
    ])
    await expect(
      createAdminAccount({ name: 'admin', domainId: 'b', password: 'correct horse battery staple' }),
    ).rejects.toThrow('username already in use')
  })
})
