import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StatusBadge, CopyIconBtn, DownloadButton } from './monitor-primitives'

/* ---------- StatusBadge ---------- */
describe('StatusBadge', () => {
  const labels = { verified: 'Vérifié', pending: 'En attente', error: 'Erreur' }

  it('renders the verified label for status=verified', () => {
    render(<StatusBadge status="verified" labels={labels} />)
    expect(screen.getByText('Vérifié')).toBeInTheDocument()
  })

  it('renders the pending label for status=pending', () => {
    render(<StatusBadge status="pending" labels={labels} />)
    expect(screen.getByText('En attente')).toBeInTheDocument()
  })

  it('renders the error label for status=error', () => {
    render(<StatusBadge status="error" labels={labels} />)
    expect(screen.getByText('Erreur')).toBeInTheDocument()
  })
})

/* ---------- CopyIconBtn ---------- */
describe('CopyIconBtn', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('has the aria-label equal to copyLabel', () => {
    render(
      <CopyIconBtn text="value" copyLabel="Copier" copiedLabel="Copié !" />,
    )
    expect(screen.getByRole('button', { name: 'Copier' })).toBeInTheDocument()
  })

  it('calls navigator.clipboard.writeText with the text on click', () => {
    render(
      <CopyIconBtn text="hello world" copyLabel="Copier" copiedLabel="Copié !" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copier' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world')
  })
})

/* ---------- DownloadButton ---------- */
describe('DownloadButton', () => {
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let anchorClick: ReturnType<typeof vi.fn>
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL

  beforeEach(() => {
    createObjectURL = vi.fn().mockReturnValue('blob:x')
    revokeObjectURL = vi.fn()
    anchorClick = vi.fn()

    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      anchorClick as unknown as () => void,
    )
  })

  afterEach(() => {
    // restoreAllMocks undoes the spy but NOT the direct global assignments / timer mode.
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('clicking the button triggers an anchor click with a blob URL', () => {
    render(
      <DownloadButton
        content="zone file content"
        filename="example.fr.zone.txt"
        label="Télécharger"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger' }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(anchorClick).toHaveBeenCalledTimes(1)
  })

  it('schedules revokeObjectURL after the click', () => {
    vi.useFakeTimers()
    render(
      <DownloadButton
        content="zone file content"
        filename="example.fr.zone.txt"
        label="Télécharger"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger' }))
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
    vi.useRealTimers()
  })
})
