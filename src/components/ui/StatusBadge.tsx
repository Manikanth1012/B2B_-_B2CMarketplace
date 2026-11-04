import type { ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/* A state never rests on colour alone: each tone carries its own shape. */
const ICON: Record<Tone, ReactNode> = {
  success: <CheckCircle2 size={12} aria-hidden />,
  warning: <AlertTriangle size={12} aria-hidden />,
  danger: <XCircle size={12} aria-hidden />,
  info: <Info size={12} aria-hidden />,
  neutral: null,
}

/** `icon` replaces the tone's shape; pass `null` where the words alone carry it. */
export function StatusBadge({ tone, icon, children }: {
  tone: Tone
  icon?: ReactNode | null
  children: ReactNode
}) {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      {icon === undefined ? ICON[tone] : icon}
      {children}
    </span>
  )
}
