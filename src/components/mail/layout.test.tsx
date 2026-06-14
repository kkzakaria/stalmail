import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MailLayout } from './layout'

describe('MailLayout', () => {
  it('rend la grille 3 colonnes avec sidebar, liste et reader', () => {
    const { container } = render(
      <MailLayout sidebar={<div data-testid="sb" />} list={<div data-testid="ls" />} />,
    )
    expect(container.querySelector('.app')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="sb"]')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="ls"]')).toBeInTheDocument()
    expect(container.querySelector('.reader-placeholder')).toBeInTheDocument()
  })
})
