import { createServerFn } from '@tanstack/react-start'
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

export const getStep = createServerFn({ method: 'GET' }).handler(getStepHandler)

export const submitBootstrapFn = createServerFn({ method: 'POST' })
  .validator((d: BootstrapInput) => domainSchema.parse(d))
  .handler(submitBootstrapHandler)
