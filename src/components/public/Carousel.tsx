/* The hero carousel.
 *
 * It was a strip, not a slideshow: five 240px pictures in a row, the whole row
 * shifted 256px on each tick. In a frame wide enough for two of them that has
 * a fault built into it — at the last index the row has slid past its own
 * content and you are looking at one picture and a large empty space where the
 * rest of the hero shows through. It reads as broken, and because the movement
 * is a small sideways nudge rather than a change of picture, it reads as not
 * moving at all. Both complaints were about the same thing.
 *
 * One slide fills the frame now and the track moves a whole frame at a time, so
 * there is no arrangement of index and width that shows a gap. It is also what
 * lets each picture carry a caption: two or three words on a strip of thumbnails
 * would be unreadable.
 */
import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { nextIndex, prevIndex, shouldAdvance, SLIDE_MS } from '../../lib/carousel'
import type { Slide } from '../../lib/carousel'

export function Carousel({ slides, alt = 'Marketplace highlight' }: {
  slides: readonly Slide[]
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
      style={{ position: 'relative' }}
    >
      {/* The frame. `overflow: hidden` is here rather than on the region so the
          arrows, which sit just inside the edges, are not clipped by it. */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{
          display: 'flex',
          transition: reduced ? 'none' : 'transform 500ms cubic-bezier(0.4, 0, 0.2, 1)',
          /* A whole frame per slide. The old strip moved by a fixed 256px,
             which only lines up with the frame by coincidence and stops lining
             up at all once the row is shorter than the distance travelled. */
          transform: `translateX(${-index * 100}%)`,
        }}>
          {slides.map((slide, i) => (
            <figure
              key={slide.src}
              /* `flex: 0 0 100%` — exactly one slide wide, never shrunk to make
                 room for its neighbours. */
              style={{ position: 'relative', flex: '0 0 100%', margin: 0 }}
              aria-hidden={i !== index}
            >
              <img
                src={slide.src}
                alt=""
                loading={i === 0 ? 'eager' : 'lazy'}
                style={{ display: 'block', width: '100%', height: '400px', objectFit: 'cover' }}
              />
              {slide.caption && (
                <>
                  {/* A scrim, not a solid bar: the caption has to be legible over
                      whatever the picture happens to be doing underneath it, and
                      these five range from a dark server room to a bright shop
                      counter. */}
                  <div style={{
                    position: 'absolute', inset: 'auto 0 0 0', height: '55%',
                    background: 'linear-gradient(to top, rgba(6,20,40,0.88) 0%, rgba(6,20,40,0.55) 45%, rgba(6,20,40,0) 100%)',
                    pointerEvents: 'none',
                  }} />
                  <figcaption style={{
                    position: 'absolute', left: '20px', right: '20px', bottom: '18px',
                    color: 'white', fontSize: 'var(--text-xl)', fontWeight: 800,
                    letterSpacing: '-0.01em', lineHeight: 1.2,
                    textShadow: '0 1px 12px rgba(0,0,0,0.45)',
                  }}>
                    {slide.caption}
                  </figcaption>
                </>
              )}
            </figure>
          ))}
        </div>
      </div>

      {/* Announced politely so a screen reader is told the slide changed
          without interrupting whatever it is currently reading. */}
      <div aria-live="polite" className="sr-only">
        Slide {index + 1} of {slides.length}{slides[index]?.caption ? `: ${slides[index].caption}` : ''}
      </div>

      <button onClick={() => setIndex(prevIndex(state))} aria-label="Previous slide" style={arrow('left')}>
        <ChevronLeft size={20} />
      </button>
      <button onClick={() => setIndex(nextIndex(state))} aria-label="Next slide" style={arrow('right')}>
        <ChevronRight size={20} />
      </button>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', padding: '12px' }}>
        {slides.map((s, i) => (
          <button
            key={s.src}
            onClick={() => setIndex(i)}
            aria-label={s.caption ? `Go to ${s.caption}` : `Go to slide ${i + 1}`}
            aria-current={i === index ? 'true' : undefined}
            style={{
              width: i === index ? '24px' : '8px', height: '8px', borderRadius: '4px', border: 'none',
              background: i === index ? 'var(--brand-accent-dark)' : 'rgba(255,255,255,0.4)',
              cursor: 'pointer', transition: 'width 200ms ease', padding: 0,
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
              background: 'transparent', color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
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
  position: 'absolute', top: '200px', transform: 'translateY(-50%)',
  ...(side === 'left' ? { left: '10px' } : { right: '10px' }),
  width: '36px', height: '36px', borderRadius: '50%', border: 'none',
  background: 'rgba(255,255,255,0.92)', color: 'var(--text)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', boxShadow: 'var(--shadow-md)',
  zIndex: 2,
})
