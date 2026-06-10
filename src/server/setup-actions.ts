import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { BootstrapInput } from './stalwart-bootstrap'
import { domainSchema } from '@/components/setup/schemas'

// The setup-state / stalwart-bootstrap / stalwart-restart modules reach `node:fs`
// (and the JMAP transport) at module scope. This file is pulled into the client
// bundle by the /setup route, so those modules are imported lazily INSIDE the
// handlers — a static top-level import would bind `node:fs` named exports in client
// code (Vite externalizes them → runtime error on access). The handler bodies are
// stripped from the client build, keeping the dynamic imports server-only.

export async function getStepHandler(): Promise<{ step: string }> {
  const { deriveSetupStep } = await import('./setup-state')
  return { step: await deriveSetupStep() }
}

export async function submitBootstrapHandler(
  { data }: { data: BootstrapInput },
): Promise<{ ok: true }> {
  const { submitBootstrap } = await import('./stalwart-bootstrap')
  const { requestStalwartRestart } = await import('./stalwart-restart')
  await submitBootstrap(data)
  requestStalwartRestart()
  return { ok: true }
}

export type CreateAccountResult =
  | { status: 'ok' }
  | { status: 'weak'; message?: string }

export async function createAdminAccountHandler(
  { data }: { data: { name: string; password: string } },
): Promise<CreateAccountResult> {
  const { getPrimaryDomain } = await import('./stalwart-domain')
  const { createAdminAccount, WeakPasswordError } = await import('./stalwart-account')
  const domain = await getPrimaryDomain()
  if (!domain) throw new Error('No primary domain found')
  try {
    await createAdminAccount({ name: data.name, domainId: domain.id, password: data.password })
    return { status: 'ok' }
  } catch (e) {
    if (e instanceof WeakPasswordError) return { status: 'weak', message: e.description }
    throw e
  }
}

const createAccountSchema = z.object({ name: z.string().min(1), password: z.string().min(1) })

export const createAdminAccountFn = createServerFn({ method: 'POST' })
  .validator((d: { name: string; password: string }) => createAccountSchema.parse(d))
  .handler(createAdminAccountHandler)

export const getStep = createServerFn({ method: 'GET' }).handler(getStepHandler)

export const submitBootstrapFn = createServerFn({ method: 'POST' })
  .validator((d: BootstrapInput) => domainSchema.parse(d))
  .handler(submitBootstrapHandler)
