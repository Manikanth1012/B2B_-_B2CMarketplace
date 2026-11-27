/**
 * An inline trend line: no axes, no gridlines, nothing to hover. Decorative
 * (hidden from assistive technology) unless given a `label`, in which case it
 * is an image with that name, which should say what the trend is ("Up from
 * 4 to 12 over seven months"). Nothing is drawn under two points. The colour
 * is `currentColor`, so a card sets it with CSS.
 */
export function Sparkline({ values, label, className, width = 120, height = 32 }: {
  values: readonly number[]
  label?: string
  className?: string
  width?: number
  height?: number
}) {
  if (values.length < 2) return null
  const pad = 2
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1) * (width - pad * 2) + pad).toFixed(1)},${(height - pad - (v - min) / span * (height - pad * 2)).toFixed(1)}`).join(' ')
  return (
    <svg className={className ? `ui-spark ${className}` : 'ui-spark'} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
