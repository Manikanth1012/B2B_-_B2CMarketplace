import type { ReactNode } from 'react'

export function BentoCard({
  variant = 'light', image, imagePosition, eyebrow, title, text, action,
  interactive = false, className, as: Tag = 'div', children,
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
  children?: ReactNode
}) {
  const cls = [
    'bento-card', `bento-card--${variant}`,
    interactive && 'bento-card--interactive', className,
  ].filter(Boolean).join(' ')

  return (
    <Tag className={cls}>
      {variant === 'image' && image && (
        <img className="bento-card__media" src={image} alt="" loading="lazy"
          style={imagePosition ? { objectPosition: imagePosition } : undefined} />
      )}
      <div className="bento-card__body">
        {eyebrow && <div className="bento-card__eyebrow">{eyebrow}</div>}
        {title && <h3 className="bento-card__title">{title}</h3>}
        {text && <p className="bento-card__text">{text}</p>}
        {children}
        {action && <div className="bento-card__action">{action}</div>}
      </div>
    </Tag>
  )
}
