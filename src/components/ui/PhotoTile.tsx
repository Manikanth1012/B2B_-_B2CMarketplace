import { useState, type ReactNode } from 'react'

interface PhotoTileProps {
  image: string
  imagePosition?: string
  title: string
  text: ReactNode
  /** 'div' where an h3 would skip a level (e.g. right after the page's h1). */
  headingLevel?: 'h3' | 'div'
  className?: string
}

/** A light card led by a decorative photograph, with the title and text below.
    Not interactive, so it has no hover lift. If the image fails to load the band
    is dropped and the text card stands on its own — never a broken-image glyph. */
export function PhotoTile({ image, imagePosition, title, text, headingLevel = 'h3', className }: PhotoTileProps) {
  const [broken, setBroken] = useState(false)
  const Title = headingLevel
  return (
    <div className={`bento-card bento-card--light photo-tile${className ? ` ${className}` : ''}`}>
      {!broken && (
        <div className="photo-tile__media">
          <img src={image} alt="" loading="lazy" style={{ objectPosition: imagePosition }} onError={() => setBroken(true)} />
        </div>
      )}
      <div className="photo-tile__body">
        <Title className="photo-tile__title">{title}</Title>
        <p className="photo-tile__text">{text}</p>
      </div>
    </div>
  )
}
