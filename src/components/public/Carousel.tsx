import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { nextIndex, prevIndex, shouldAdvance, SLIDE_MS } from '../../lib/carousel'

export function Carousel({ slides, alt = 'Marketplace highlight' }: {
  slides: readonly string[]
  alt?: string
}) {
  const [index, setIndex] = useState(0)
  const [hovering, setHovering] = useState(false)
  const [stopped, setStopped] = useState(false)
  /* Held as state, not a ref: the pause control and the slide transition both
     render differently under reduced motion, and a ref would not re-render.
     The listener keeps us honest if the preference changes mid-visit. */
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  /* Hovering and focusing pause the rotation for as long as they last. Stopping
     is the visitor's own decision and outlives both. */
  const paused = hovering || stopped

  useEffect(() => {
    const state = { index, count: slides.length, paused }
    if (!shouldAdvance(state, reduced)) return
    const t = setTimeout(() => setIndex(nextIndex(state)), SLIDE_MS)
    return () => clearTimeout(t)
  }, [index, paused, reduced, slides.length])

  if (slides.length === 0) return <></>

  const state = { index, count: slides.length, paused }
  /* Nothing moves on its own with one slide or under reduced motion, so a
     control offering to stop it would be a lie. */
  const canAutoAdvance = slides.length > 1 && !reduced

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
      /* aria-roledescription is only honoured on an element that already has a
         role, and a bare div has none — without this the whole carousel, label
         included, is invisible to a screen reader. */
      role="region"
      aria-roledescription="carousel"
      aria-label={alt}
      style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}
    >
      <div style={{ display: 'flex', gap: '16px', padding: '4px', transition: reduced ? 'none' : 'transform 400ms ease', transform: `translateX(calc(${-index} * (240px + 16px)))` }}>
        {slides.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            loading={i === 0 ? 'eager' : 'lazy'}
            aria-hidden={i !== index}
            style={{ width: '240px', height: '400px', objectFit: 'cover', borderRadius: 'var(--radius-md)', flexShrink: 0 }}
          />
        ))}
      </div>

      {/* Announced politely so a screen reader is told the slide changed
          without interrupting whatever it is currently reading. */}
      <div aria-live="polite" className="sr-only">Slide {index + 1} of {slides.length}</div>

      <button onClick={() => setIndex(prevIndex(state))} aria-label="Previous slide" style={arrow('left')}>
        <ChevronLeft size={20} />
      </button>
      <button onClick={() => setIndex(nextIndex(state))} aria-label="Next slide" style={arrow('right')}>
        <ChevronRight size={20} />
      </button>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', padding: '12px' }}>
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === index ? 'true' : undefined}
            style={{
              width: i === index ? '24px' : '8px', height: '8px', borderRadius: '4px', border: 'none',
              background: i === index ? 'var(--brand-accent-dark)' : 'var(--border)',
              cursor: 'pointer', transition: 'width 200ms ease',
            }}
          />
        ))}

        {/* Pausing on hover and focus leaves out anyone on a touch screen, and
            anyone who never puts focus here. Six seconds a slide is past the
            five the guideline allows, so the stop has to be a real control. */}
        {canAutoAdvance && (
          <button
            onClick={() => setStopped(s => !s)}
            aria-label={stopped ? 'Start automatic slide rotation' : 'Stop automatic slide rotation'}
            style={{
              marginLeft: '8px', width: '24px', height: '24px', borderRadius: '50%', border: 'none',
              background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
          >
            {stopped ? <Play size={13} /> : <Pause size={13} />}
          </button>
        )}
      </div>
    </div>
  )
}

const arrow = (side: 'left' | 'right'): React.CSSProperties => ({
  position: 'absolute', top: '40%',
  ...(side === 'left' ? { left: '8px' } : { right: '8px' }),
  width: '36px', height: '36px', borderRadius: '50%', border: 'none',
  background: 'rgba(255,255,255,0.92)', color: 'var(--text)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', boxShadow: 'var(--shadow-md)',
})
