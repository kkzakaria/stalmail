export function Stepper({ labels, activeIndex }: { labels: string[]; activeIndex: number }) {
  return (
    <ol className="mb-8 flex items-center justify-center gap-2 text-sm">
      {labels.map((label, i) => (
        <li key={label} className="flex items-center">
          <span
            data-active={i === activeIndex}
            aria-current={i === activeIndex ? 'step' : undefined}
            className={
              i === activeIndex
                ? 'font-medium text-foreground'
                : 'text-muted-foreground'
            }
          >
            {label}
          </span>
          {i < labels.length - 1 && <span className="mx-2 text-muted-foreground">→</span>}
        </li>
      ))}
    </ol>
  )
}
