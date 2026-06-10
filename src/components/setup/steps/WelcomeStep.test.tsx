import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { WelcomeStep } from './WelcomeStep'

function renderWithI18n(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('fr')}>{ui}</I18nextProvider>)
}

describe('WelcomeStep', () => {
  it('renders the title', () => {
    renderWithI18n(<WelcomeStep onNext={vi.fn()} />)
    expect(screen.getByText('Bienvenue sur Stalmail')).toBeInTheDocument()
  })

  it('renders a need-item', () => {
    const { container } = renderWithI18n(<WelcomeStep onNext={vi.fn()} />)
    expect(container.querySelector('.need-item')).toBeTruthy()
  })

  it('calls onNext when the start button is clicked', () => {
    const onNext = vi.fn()
    renderWithI18n(<WelcomeStep onNext={onNext} />)
    fireEvent.click(screen.getByRole('button', { name: /commencer/i }))
    expect(onNext).toHaveBeenCalled()
  })
})
