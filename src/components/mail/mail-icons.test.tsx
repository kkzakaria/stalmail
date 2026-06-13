import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Icon, Avatar, initialsOf, hashColor } from './mail-icons'

describe('initialsOf', () => {
  it('prend les 2 premières initiales', () => {
    expect(initialsOf('Alice Martin')).toBe('AM')
    expect(initialsOf('Bob')).toBe('B')
    expect(initialsOf('')).toBe('?')
  })
})

describe('hashColor', () => {
  it('est stable par entrée', () => {
    expect(hashColor('a@x.fr')).toBe(hashColor('a@x.fr'))
  })
  it('renvoie une couleur CSS', () => {
    expect(hashColor('a@x.fr')).toMatch(/^(hsl|#)/)
  })
})

describe('Icon', () => {
  it('rend un svg pour un nom connu', () => {
    const { container } = render(<Icon name="inbox" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})

describe('Avatar', () => {
  it('affiche les initiales', () => {
    render(<Avatar name="Alice Martin" email="a@x.fr" />)
    expect(screen.getByText('AM')).toBeInTheDocument()
  })
})
