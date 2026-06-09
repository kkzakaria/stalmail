import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { DnsProviderStep } from './DnsProviderStep'

const wrap = (ui: React.ReactNode) =>
  render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)

describe('DnsProviderStep', () => {
  it('advances in Manual mode without a secret', async () => {
    const onNext = vi.fn()
    wrap(<DnsProviderStep defaults={{ provider: 'Manual', secret: '' }} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(onNext).toHaveBeenCalledWith({ provider: 'Manual', secret: '' }))
  })

  it('requires a secret for a real provider', async () => {
    const onNext = vi.fn()
    wrap(<DnsProviderStep defaults={{ provider: 'Cloudflare', secret: '' }} onNext={onNext} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(onNext).not.toHaveBeenCalled())
  })
})
