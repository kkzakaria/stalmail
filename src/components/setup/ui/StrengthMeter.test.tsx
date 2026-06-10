import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { StrengthMeter } from './StrengthMeter'

describe('StrengthMeter', () => {
  it('renders 4 bars and shows the label when a password is present', () => {
    const { container, getByText } = render(<StrengthMeter password="Abcdef12!xyz" label="Strong" />)
    expect(container.querySelectorAll('.strength-bar')).toHaveLength(4)
    expect(getByText('Strong')).toBeInTheDocument()
  })
  it('hides the label region for empty password', () => {
    const { container } = render(<StrengthMeter password="" label="Strong" />)
    expect(container.querySelector('.strength')?.getAttribute('aria-hidden')).toBe('true')
  })
})
