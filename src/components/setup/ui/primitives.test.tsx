import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PasswordInput, CopyButton, Alert } from './primitives'

describe('PasswordInput', () => {
  it('toggles visibility', () => {
    render(
      <PasswordInput
        id="p"
        value="secret"
        onChange={() => {}}
        showLabel="show"
        hideLabel="hide"
      />,
    )
    const input = document.getElementById('p') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'show' }))
    expect(input.type).toBe('text')
  })
})

describe('Alert', () => {
  it('renders title + role=alert', () => {
    render(
      <Alert variant="warning" title="warn">
        body
      </Alert>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('warn')
    expect(screen.getByRole('alert')).toHaveTextContent('body')
  })
})

describe('CopyButton', () => {
  it('writes to clipboard on click', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<CopyButton text="abc" label="Copy" copiedLabel="Copied" />)
    fireEvent.click(screen.getByRole('button'))
    expect(writeText).toHaveBeenCalledWith('abc')
  })
})
