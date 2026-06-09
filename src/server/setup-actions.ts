import { createServerFn } from '@tanstack/react-start'
import { deriveSetupStep } from './setup-state'
import type { BootstrapInput } from './stalwart-bootstrap'
import { submitBootstrap } from './stalwart-bootstrap'
import { requestStalwartRestart } from './stalwart-restart'

export async function getStepHandler(): Promise<{ step: string }> {
  return { step: await deriveSetupStep() }
}

export async function submitBootstrapHandler(
  { data }: { data: BootstrapInput },
): Promise<{ ok: true }> {
  await submitBootstrap(data)
  requestStalwartRestart()
  return { ok: true }
}

export const getStep = createServerFn({ method: 'GET' }).handler(getStepHandler)

export const submitBootstrapFn = createServerFn({ method: 'POST' })
  .validator((d: BootstrapInput) => d)
  .handler(submitBootstrapHandler)
