import type React from 'react'

/**
 * The page every account screen sits on: an h1 with an optional subtitle and
 * actions beside it, then the screen's own content, in a container no wider
 * than 1200px on the --bg-alt page colour.
 */
export function AccountPage({ title, subtitle, actions, children }: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="acct-page">
      <div className="acct-page__inner">
        <header className="acct-page__head">
          <div className="acct-page__heading">
            <h1 className="acct-page__title">{title}</h1>
            {subtitle && <p className="acct-page__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="acct-page__actions">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}
