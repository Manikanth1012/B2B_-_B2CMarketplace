import type { CSSProperties } from 'react'

/** A quiet placeholder while content loads. Decorative: hidden from assistive tech. */
export function Skeleton({ lines, block, width, height }: {
  /** A stack of text-height bars; the last is shorter. */
  lines?: number
  /** A single rectangle (card, chart, avatar). */
  block?: boolean
  width?: number | string
  height?: number | string
}) {
  if (lines && lines > 0) {
    return (
      <div className="skeleton-lines" aria-hidden="true" style={{ width }}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="skeleton" style={{ height: height ?? 12, width: i === lines - 1 && lines > 1 ? '60%' : '100%' }} />
        ))}
      </div>
    )
  }
  const style: CSSProperties = { width: width ?? '100%', height: height ?? (block ? 96 : 12) }
  return <span className="skeleton" aria-hidden="true" style={style} />
}
