import type { ReactNode } from 'react'

export function BentoCard({
  variant = 'light', image, imagePosition, eyebrow, title, text, action,
  interactive = false, className, as: Tag = 'div', headingLevel = 3, children,
}: {
  variant?: 'light' | 'dark' | 'image'
  image?: string
  imagePosition?: string
  eyebrow?: string
  title?: ReactNode
  text?: ReactNode
  action?: ReactNode
  interactive?: boolean
  className?: string
  as?: 'div' | 'article'
  /* The title's heading level. 3 by default, which is what every caller had
     before this existed; a card directly under a page's h1 passes 2. */
  headingLevel?: 2 | 3 | 4
  children?: ReactNode
}) {
  const cls = [
    'bento-card', `bento-card--${variant}`,
    interactive && 'bento-card--interactive', className,
  ].filter(Boolean).join(' ')
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  return (
    <Tag className={cls}>
      {variant === 'image' && image && (
        <img className="bento-card__media" src={image} alt="" loading="lazy"
          style={imagePosition ? { objectPosition: imagePosition } : undefined} />
      )}
      <div className="bento-card__body">
        {eyebrow && <div className="bento-card__eyebrow">{eyebrow}</div>}
        {title && <Heading className="bento-card__title">{title}</Heading>}
        {text && <p className="bento-card__text">{text}</p>}
        {children}
        {action && <div className="bento-card__action">{action}</div>}
      </div>
    </Tag>
  )
}
