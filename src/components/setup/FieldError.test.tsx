import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldError } from './FieldError'

function makeField(isValid: boolean, errors: unknown[]) {
  return { state: { meta: { isValid, errors } } }
}

describe('FieldError', () => {
  it('renders the error message when the field is invalid', () => {
    render(<FieldError field={makeField(false, [{ message: 'boom' }])} />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('renders nothing when the field is valid', () => {
    const { container } = render(<FieldError field={makeField(true, [])} />)
    expect(container.firstChild).toBeNull()
  })

  it('joins multiple error messages with a comma', () => {
    render(<FieldError field={makeField(false, [{ message: 'err1' }, { message: 'err2' }])} />)
    expect(screen.getByText('err1, err2')).toBeInTheDocument()
  })

  it('falls back to String(e) when the error has no message property', () => {
    render(<FieldError field={makeField(false, ['plain string error'])} />)
    expect(screen.getByText('plain string error')).toBeInTheDocument()
  })
})
