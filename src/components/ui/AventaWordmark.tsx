import { useId } from 'react'

/** The Aventa marketplace wordmark: a gradient "A" and the name. There is no
    Aventa logo file; the 6D mark beside it is the approved asset, never this. */
export function AventaWordmark({ size = 28 }: { size?: number }) {
  const g = useId()
  return (
    <span className="aventa-wordmark" style={{ fontSize: size * 0.82 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id={g} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#168BFF" />
            <stop offset="1" stopColor="#12CDE0" />
          </linearGradient>
        </defs>
        <path d="M16 2 L30 30 H22.5 L16 16.5 L9.5 30 H2 Z" fill={`url(#${g})`} />
        <path d="M11.5 24 H20.5" stroke="#061B3A" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span>Aventa</span>
    </span>
  )
}
