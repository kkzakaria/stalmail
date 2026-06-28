// Stalmail wizard — searchable Combobox with an optional pinned sticky option.
// Ports the design prototype (docs/design/wizard-handoff/project/wizard/ui.jsx,
// the `Combobox` function) to typed TSX backed by the scoped classes in
// wizard.css. All visible text is passed in via props; i18n is resolved by
// callers.
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { IconCheck, IconSearch, IconPen } from "./icons"

export interface ComboboxStickyOption {
  value: string
  label: string
  hint?: string
}

export interface ComboboxProps {
  id: string
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  stickyOption?: ComboboxStickyOption
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  invalid?: boolean
}

const norm = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export function Combobox({
  id,
  value,
  onChange,
  options,
  stickyOption,
  placeholder,
  searchPlaceholder,
  emptyText,
  invalid,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)

  // Position du panneau, en coordonnées viewport (le panneau est portalé hors de la
  // carte scrollable pour ne pas être rogné ni gonfler son scrollHeight).
  const computePos = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ top: r.bottom + 5, left: r.left, width: r.width })
  }, [])

  const q = norm(query.trim())
  const filtered = q ? options.filter((o) => norm(o).includes(q)) : options
  const count = filtered.length + (stickyOption ? 1 : 0)

  const selectedLabel =
    value === ""
      ? null
      : stickyOption && value === stickyOption.value
        ? stickyOption.label
        : value

  const openPop = () => {
    computePos()
    setOpen(true)
    setQuery("")
    setActive(-1)
  }
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      const inRoot = !!rootRef.current?.contains(t)
      const inPop = !!popRef.current?.contains(t)
      if (!inRoot && !inPop) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  // Reposition le panneau portalé tant qu'il est ouvert (scroll de la carte, resize).
  // Le scroll en phase capture se déclenche pour chaque ancêtre scrollable ; on coalesce
  // les recalculs via requestAnimationFrame pour éviter un re-render par tick.
  useEffect(() => {
    if (!open) return
    computePos()
    let raf = 0
    const onMove = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        computePos()
      })
    }
    window.addEventListener("scroll", onMove, true)
    window.addEventListener("resize", onMove)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener("scroll", onMove, true)
      window.removeEventListener("resize", onMove)
    }
  }, [open, computePos])

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  // Keep the active item visible in the scrolling list (without scrollIntoView).
  useEffect(() => {
    if (!open || active < 0 || !listRef.current) return
    const list = listRef.current
    const el = list.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    if (!el) return
    if (el.offsetTop < list.scrollTop) {
      list.scrollTop = el.offsetTop
    } else if (
      el.offsetTop + el.offsetHeight >
      list.scrollTop + list.clientHeight
    ) {
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight
    }
  }, [active, open])

  const valueAt = (i: number): string | null =>
    i < filtered.length ? filtered[i] : stickyOption ? stickyOption.value : null

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, count - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const v = active >= 0 ? valueAt(active) : count === 1 ? valueAt(0) : null
      if (v != null) pick(v)
    } else if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
    }
  }

  const itemClassName = (i: number, v: string): string =>
    "combobox-item" +
    (i === active ? " is-active" : "") +
    (value === v ? " is-selected" : "")

  const itemHandlers = (i: number, v: string) => ({
    "data-idx": i,
    role: "option" as const,
    "aria-selected": value === v,
    onMouseEnter: () => setActive(i),
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => pick(v),
  })

  return (
    <div className="combobox" ref={rootRef}>
      <button
        type="button"
        id={id}
        className={"combobox-trigger" + (invalid ? " input-invalid" : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPop())}
        onKeyDown={(e) => {
          if (
            !open &&
            (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault()
            openPop()
          }
        }}
      >
        <span
          className={
            "combobox-value" + (selectedLabel ? "" : " is-placeholder")
          }
        >
          {selectedLabel || placeholder}
        </span>
        <svg
          className="combobox-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && pos
        ? createPortal(
            <div
              className="combobox-pop combobox-pop-fixed"
              ref={popRef}
              style={{ top: pos.top, left: pos.left, width: pos.width }}
            >
              <div className="combobox-search">
                <IconSearch size={14} />
                <input
                  ref={inputRef}
                  className="combobox-search-input"
                  value={query}
                  placeholder={searchPlaceholder}
                  autoComplete="off"
                  spellCheck="false"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={id + "-list"}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActive(0)
                  }}
                  onKeyDown={onKey}
                />
              </div>
              <div
                className="combobox-list"
                id={id + "-list"}
                ref={listRef}
                role="listbox"
              >
                {filtered.length === 0 ? (
                  <p className="combobox-empty">{emptyText}</p>
                ) : null}
                {filtered.map((o, i) => (
                  <div
                    key={o}
                    {...itemHandlers(i, o)}
                    className={itemClassName(i, o)}
                  >
                    <span className="combobox-item-label">{o}</span>
                    {value === o ? <IconCheck size={14} /> : null}
                  </div>
                ))}
              </div>
              {stickyOption ? (
                <div className="combobox-footer">
                  <div
                    {...itemHandlers(filtered.length, stickyOption.value)}
                    className={
                      itemClassName(filtered.length, stickyOption.value) +
                      " combobox-item-sticky"
                    }
                  >
                    <span className="combobox-sticky-icon">
                      <IconPen size={13} />
                    </span>
                    <span className="combobox-sticky-text">
                      <span className="combobox-item-label">
                        {stickyOption.label}
                      </span>
                      {stickyOption.hint ? (
                        <span className="combobox-sticky-hint">
                          {stickyOption.hint}
                        </span>
                      ) : null}
                    </span>
                    {value === stickyOption.value ? (
                      <IconCheck size={14} />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>,
            rootRef.current?.closest(".stalmail-wizard") ?? document.body
          )
        : null}
    </div>
  )
}
