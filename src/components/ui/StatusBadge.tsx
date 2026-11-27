import type { ReactNode } from 'react'

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/** Dot + words. The dot is decorative; the words carry the state, so a state never rests on colour alone.
 *  `icon` replaces the dot with a shape; pass `null` to show the words only. */
export function StatusBadge({ tone, icon, children }: {
  tone: Tone
  icon?: ReactNode | null
  children: ReactNode
}) {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      {icon === undefined ? <span className="status-badge__dot" aria-hidden="true" /> : icon}
      {children}
    </span>
  )
}
