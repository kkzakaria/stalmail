import type { ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'

export interface WizardData {
  serverHostname?: string
  defaultDomain?: string
  provider?: string
  secret?: string
  name?: string
  password?: string
}

interface WizardCtx {
  data: WizardData
  setData: (patch: Partial<WizardData>) => void
}

const Ctx = createContext<WizardCtx | null>(null)

export function WizardProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<WizardData>({})
  const setData = (patch: Partial<WizardData>) =>
    setDataState((prev) => ({ ...prev, ...patch }))
  return <Ctx.Provider value={{ data, setData }}>{children}</Ctx.Provider>
}

export function useWizard(): WizardCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useWizard must be used within WizardProvider')
  return ctx
}
