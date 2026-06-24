// SegmentedControl — branding.md §5 segmented control (track --ws-steel-3, active
// segment --ws-gold). Used for the Week/Month calendar toggle. Tokens only.
export interface SegmentOption<T extends string> {
  value: T
  label: string
}

export function SegmentedControl<T extends string>({
  options, value, onChange, ariaLabel,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex rounded-ws-sm border border-ws-line bg-ws-steel-3 p-ws-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={[
              'rounded-ws-sm px-ws-3 py-ws-1 text-ws-sm font-medium transition-all',
              active ? 'bg-ws-gold text-ws-text-on-gold' : 'text-ws-text-muted hover:text-ws-text',
            ].join(' ')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
