import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Combobox } from './Combobox'

const opts = ['Cloudflare', 'Gandi', 'OVHcloud']

function open() {
  fireEvent.click(screen.getByRole('button', { expanded: false }))
}

describe('Combobox', () => {
  it('filters options by query (accent/case-insensitive)', () => {
    render(
      <Combobox
        id="c"
        value=""
        onChange={() => {}}
        options={opts}
        placeholder="Choose"
        searchPlaceholder="Search"
        emptyText="None"
      />,
    )
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gan' } })
    expect(screen.getByText('Gandi')).toBeInTheDocument()
    expect(screen.queryByText('Cloudflare')).not.toBeInTheDocument()
  })

  it('selects an option on click', () => {
    const onChange = vi.fn()
    render(
      <Combobox
        id="c"
        value=""
        onChange={onChange}
        options={opts}
        placeholder="Choose"
        searchPlaceholder="Search"
        emptyText="None"
      />,
    )
    open()
    fireEvent.click(screen.getByText('Cloudflare'))
    expect(onChange).toHaveBeenCalledWith('Cloudflare')
  })

  it('keeps the sticky option visible while filtering and selects it', () => {
    const onChange = vi.fn()
    render(
      <Combobox
        id="c"
        value=""
        onChange={onChange}
        options={opts}
        stickyOption={{ value: 'Manual', label: 'Manual setup', hint: 'self' }}
        placeholder="Choose"
        searchPlaceholder="Search"
        emptyText="None"
      />,
    )
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })
    expect(screen.getByText('None')).toBeInTheDocument() // empty list
    fireEvent.click(screen.getByText('Manual setup')) // sticky still there
    expect(onChange).toHaveBeenCalledWith('Manual')
  })

  it('shows the empty text when nothing matches', () => {
    render(
      <Combobox
        id="c"
        value=""
        onChange={() => {}}
        options={opts}
        placeholder="Choose"
        searchPlaceholder="Search"
        emptyText="None found"
      />,
    )
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })
    expect(screen.getByText('None found')).toBeInTheDocument()
  })
})
