import { blocksOf, embedUrl } from '../lib/kb'
import type { KbBlock } from '../lib/kb'

/* An article's body, rendered.
 *
 * One component rather than the two copies of the same `map` that the full
 * knowledge base and the contextual help panel each had. They were identical
 * while a block was a heading and a paragraph, and would not have stayed
 * identical for five minutes once a block could also be a picture — one of them
 * would have grown the image case and the other would have gone on rendering
 * nothing, which on a help page reads as an article with a gap in it.
 */
export function KbBlocks({ body, compact = false }: { body: unknown; compact?: boolean }) {
  const blocks = blocksOf(body)
  return (
    <>
      {blocks.map((b, i) => <Block key={i} block={b} compact={compact} />)}
    </>
  )
}

function Block({ block, compact }: { block: KbBlock; compact: boolean }) {
  const heading = (
    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '4px' }}>
      {block.heading}
    </div>
  )
  const prose = {
    fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.65,
  } as const
  const caption = {
    fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '5px', lineHeight: 1.5,
  } as const

  if (block.kind === 'image') {
    return (
      <div>
        {heading}
        {/* `alt` is required by the type and by the database, so it is never the
            empty string a decorative image would carry — on a help page every
            picture is load-bearing. */}
        <img src={block.src} alt={block.alt} loading="lazy"
          style={{
            display: 'block', width: '100%', maxWidth: compact ? '100%' : '640px',
            borderRadius: 'var(--radius)', border: '1px solid var(--border-light)',
          }} />
        {block.caption && <div style={caption}>{block.caption}</div>}
      </div>
    )
  }

  if (block.kind === 'video') {
    const src = embedUrl(block.url)
    return (
      <div>
        {heading}
        {/* Null where the URL is not one of the hosts this marketplace frames.
            The link is still offered, because refusing to embed something is not
            a reason to withhold it — and a bare anchor cannot run anything. */}
        {src ? (
          <div style={{
            position: 'relative', width: '100%', maxWidth: compact ? '100%' : '640px',
            aspectRatio: '16 / 9', borderRadius: 'var(--radius)', overflow: 'hidden',
            border: '1px solid var(--border-light)', background: 'var(--bg-alt)',
          }}>
            <iframe src={src} title={block.heading} loading="lazy" allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
          </div>
        ) : (
          <a href={block.url} target="_blank" rel="noreferrer noopener" style={prose}>
            Watch it on the original site ↗
          </a>
        )}
        {block.caption && <div style={caption}>{block.caption}</div>}
      </div>
    )
  }

  return (
    <div>
      {heading}
      <p style={prose}>{block.text}</p>
    </div>
  )
}
