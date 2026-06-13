import { describe, expect, it, vi, beforeEach } from 'vitest'
import { isRedirect } from '@tanstack/react-router'
import { withFreshAccessToken } from './session'
import { stalwartUserFetch } from './stalwart-user'
import { jmapUserCall, JmapUserError } from './jmap-user'

vi.mock('./session', () => ({ withFreshAccessToken: vi.fn() }))
vi.mock('./stalwart-user', () => ({ stalwartUserFetch: vi.fn() }))

const methodCalls = [['Mailbox/get', { accountId: 'a1', ids: null }, '0']] as const

beforeEach(() => {
  vi.resetAllMocks()
})

describe('jmapUserCall', () => {
  it('envoie le batch en Bearer et retourne methodResponses', async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue('tok-123')
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(JSON.stringify({ methodResponses: [['Mailbox/get', { list: [] }, '0']] }), {
        status: 200,
      }),
    )

    const res = await jmapUserCall('sid-1', methodCalls as never)

    expect(withFreshAccessToken).toHaveBeenCalledWith('sid-1')
    const [path, token, init] = vi.mocked(stalwartUserFetch).mock.calls[0]
    expect(path).toBe('/jmap/')
    expect(token).toBe('tok-123')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.using).toContain('urn:ietf:params:jmap:mail')
    expect(body.methodCalls).toEqual(methodCalls)
    expect(res).toEqual([['Mailbox/get', { list: [] }, '0']])
  })

  it('token null → throw redirect /login', async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue(null)
    try {
      await jmapUserCall('sid-1', methodCalls as never)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(isRedirect(err)).toBe(true)
    }
  })

  it('HTTP non-2xx → JmapUserError', async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue('tok')
    vi.mocked(stalwartUserFetch).mockResolvedValue(new Response('nope', { status: 500 }))
    await expect(jmapUserCall('sid-1', methodCalls as never)).rejects.toBeInstanceOf(JmapUserError)
  })

  it('réponse method ["error", ...] → JmapUserError avec type', async () => {
    vi.mocked(withFreshAccessToken).mockResolvedValue('tok')
    vi.mocked(stalwartUserFetch).mockResolvedValue(
      new Response(
        JSON.stringify({ methodResponses: [['error', { type: 'serverFail' }, '0']] }),
        { status: 200 },
      ),
    )
    await expect(jmapUserCall('sid-1', methodCalls as never)).rejects.toMatchObject({
      name: 'JmapUserError',
      type: 'serverFail',
    })
  })
})
