import { jmapCall, resolveAccountId, firstResponse, JmapError } from './jmap'

export interface AdminAccountInput {
  name: string
  domainId: string
  password: string
}

export class WeakPasswordError extends Error {
  constructor(readonly description?: string) {
    super(description ?? 'Password is too weak')
    this.name = 'WeakPasswordError'
  }
}

export async function createAdminAccount(input: AdminAccountInput): Promise<string> {
  const accountId = await resolveAccountId()
  const responses = await jmapCall([
    [
      'x:Account/set',
      {
        accountId,
        create: {
          u1: {
            '@type': 'User',
            name: input.name,
            domainId: input.domainId,
            credentials: { '0': { '@type': 'Password', secret: input.password } },
            roles: { '@type': 'Admin' },
          },
        },
      },
      '0',
    ],
  ])
  const result = firstResponse(responses)[1] as {
    created?: { u1?: { id: string } }
    notCreated?: { u1?: { type: string; properties?: string[]; description?: string } }
  }
  const created = result.created?.u1
  if (created) return created.id

  const err = result.notCreated?.u1
  if (err?.type === 'invalidProperties' && err.properties?.includes('secret')) {
    throw new WeakPasswordError(err.description)
  }
  // primaryKeyViolation on email = the username is already taken (e.g. the bootstrap
  // system admin "admin"). Surface a clearer message than the generic rejection.
  if (err?.type === 'primaryKeyViolation') {
    throw new JmapError('username already in use', err)
  }
  throw new JmapError('account creation rejected', err)
}
