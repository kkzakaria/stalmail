import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '@/i18n/i18n'
import { ThemeToggle } from './ThemeToggle'

function wrap(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={createI18n('en')}>{ui}</I18nextProvider>)
}

describe('ThemeToggle', () => {
  it('toggles light → dark', () => {
    const onChange = vi.fn()
    wrap(<ThemeToggle theme="light" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenCalledWith('dark')
  })
  it('reflects pressed state in dark', () => {
    wrap(<ThemeToggle theme="dark" onChange={() => {}} />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })
})
