import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Stepper } from './Stepper'

describe('Stepper', () => {
  it('renders all step labels and marks the active one', () => {
    render(<Stepper labels={['Bienvenue', 'Domaine', 'DNS']} activeIndex={1} />)
    expect(screen.getByText('Domaine')).toHaveAttribute('data-active', 'true')
    expect(screen.getByText('Bienvenue')).toHaveAttribute('data-active', 'false')
  })
})
