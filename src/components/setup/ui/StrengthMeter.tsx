import { scorePassword } from '../password-strength'

// weak → 1 bar / destructive ; medium → 2 bars / warning ; strong → 4 bars / success
const META = {
  weak:   { fill: 1, color: 'var(--destructive)', key: 'weak' },
  medium: { fill: 2, color: 'var(--warning)',     key: 'medium' },
  strong: { fill: 4, color: 'var(--success)',     key: 'strong' },
} as const

interface Props { password: string; label: string } // label = already-translated strength label

export function StrengthMeter({ password, label }: Props) {
  const score = scorePassword(password)
  const { fill, color } = META[score]
  return (
    <div className="strength" aria-hidden={!password}>
      <div className="strength-bars">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="strength-bar"
            style={{ background: password && i < fill ? color : 'var(--border)' }}
          />
        ))}
      </div>
      <span className="strength-label" style={{ color: password ? color : 'var(--muted-foreground)' }}>
        {password ? label : ' '}
      </span>
    </div>
  )
}
