import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { WelcomeStep } from './WelcomeStep'

function renderWithI18n(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)
}

describe('WelcomeStep', () => {
  it('shows the start button and calls onNext', () => {
    const onNext = vi.fn()
    renderWithI18n(<WelcomeStep onNext={onNext} />)
    fireEvent.click(screen.getByRole('button', { name: 'Commencer' }))
    expect(onNext).toHaveBeenCalled()
  })

  it('switches language when EN is chosen', () => {
    renderWithI18n(<WelcomeStep onNext={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument()
  })
})
