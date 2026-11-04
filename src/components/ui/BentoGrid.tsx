import type { CSSProperties, ReactNode } from 'react'

/** A bento grid: `cols` columns on desktop, two on tablet, one on a phone. */
export function BentoGrid({ cols = 4, className, children }: {
  cols?: number
  className?: string
  children: ReactNode
}) {
  return (
    <div className={['bento', className].filter(Boolean).join(' ')} style={{ '--bento-cols': cols } as CSSProperties}>
      {children}
    </div>
  )
}

/** One cell. `span` columns wide and `rows` rows tall on desktop; collapses below. */
export function BentoCell({ span = 1, rows = 1, children }: {
  span?: 1 | 2 | 3
  rows?: 1 | 2
  children: ReactNode
}) {
  return (
    <div data-span={span > 1 ? span : undefined} data-rows={rows > 1 ? rows : undefined}>
      {children}
    </div>
  )
}
