import { useState, useEffect } from 'react'
import { loadCategories } from '../lib/storefrontRepo'
import { categoriesFor } from '../lib/storefront'
import type { Category } from '../types'
import type { View } from '../types/view'
import { marketProse } from '../lib/money'
import { useMarket } from '../lib/MarketContext'

interface FooterProps {
  /* `tab` names a section of the account, the same way the account menu does —
     "Help & Support" and the privacy controls are tabs there rather than pages
     of their own, and without it this prop could only reach the ones that are. */
  onNavigate: (view: View, opts?: { category?: string; tab?: string }) => void
}

export function Footer({ onNavigate }: FooterProps) {
  /* Named from the markets table, so the sentence stops being a claim somebody
     has to remember to update. */
  const { book } = useMarket()
  const markets = marketProse(book.markets)

  /* The shop column is the shopper's shelves, read from the catalogue rather
     than typed out. Typed out, it kept a link to Security — a shelf that is
     now business-only — pointing a retail customer at an empty category page.
     A hard-coded navigation is a copy of the rules that never gets updated.

     `categoriesFor`, not `retailCategories`: the latter is the merchandising
     rail on the landing page and reads the audience prose, which files IoT
     under Enterprise even though a retail customer can buy a sensor. What the
     footer wants is every shelf they may shop. */
  const [shelves, setShelves] = useState<Category[]>([])
  useEffect(() => { void loadCategories().then(c => setShelves(categoriesFor(c, 'consumer'))) }, [])

  return (
    <footer style={{ background: 'var(--brand-navy-dark)', color: 'rgba(255,255,255,0.7)', marginTop: '64px' }}>
      <div className="container" style={{ paddingTop: '48px', paddingBottom: '48px' }}>
        {/* Three link columns now rather than five, so the track list is
            written to match. `auto-fit` rather than a fixed count: at 900px the
            five-column version squeezed each heading onto two lines, and a
            column list that only fits one layout is the reason it did. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 2fr) repeat(auto-fit, minmax(150px, 1fr))',
          gap: '32px',
        }}>
          {/* Brand */}
          <div>
            <img src="/assets/brand/6d-logo-white.png" alt="6D Marketplace" style={{ height: '32px', marginBottom: '16px' }} />
            <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, maxWidth: '280px' }}>
              A unified telecom marketplace bringing together plans, devices, security, IoT and
              digital content{markets && ` across ${markets}`}.
            </p>
          </div>

          {/* Links */}
          <FooterCol title="Shop" links={shelves.map(c => ({
            label: c.name,
            onClick: () => onNavigate('category', { category: c.id }),
          }))} />

          {/* Every item here goes somewhere. "Track Order" is the orders list,
              which is where tracking lives; "Help & Support" is the account tab
              of that name, not a page that does not exist. */}
          <FooterCol title="Account" links={[
            { label: 'My Orders', onClick: () => onNavigate('orders') },
            { label: 'Subscriptions', onClick: () => onNavigate('subscriptions') },
            { label: 'Track Order', onClick: () => onNavigate('orders') },
            { label: 'Help & Support', onClick: () => onNavigate('account', { tab: 'support' }) },
            { label: 'Knowledge base', onClick: () => onNavigate('kb') },
          ]} />

          {/* What used to be Company and Legal: About Aventa, Careers, Press,
              Terms of Service, Cookie Policy and Refund Policy were all wired to
              `onClick: () => {}` — eight of the twelve links in this footer went
              nowhere at all. A link that silently does nothing is worse than no
              link: it reads as broken rather than as absent, and it is the kind
              of thing a demo gets asked about.

              They are not replaced with invented pages. A terms of service or a
              refund policy is a legal document somebody has to write and stand
              behind, and making one up to fill a footer slot would be the worst
              possible way to fill it. When there is real copy, this is where it
              goes back.

              "Privacy & your data" survives because it has a real destination —
              the privacy card on the account's security tab, where a customer
              can see what is held and ask for it to be exported or deleted.
              It is named for what it does rather than "Privacy Policy", which
              would promise a document instead of a control. */}
          <FooterCol title="Privacy" links={[
            { label: 'Privacy & your data', onClick: () => onNavigate('account', { tab: 'security' }) },
            { label: 'Who can access this account', onClick: () => onNavigate('account', { tab: 'household' }) },
          ]} />
        </div>

        <div style={{
          marginTop: '40px',
          paddingTop: '24px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 'var(--text-xs)',
        }}>
          <span>© 2026 Aventa Telecom · Powered by 6D Technologies. All rights reserved.</span>
          <div style={{ display: 'flex', gap: '16px' }}>
            <span>India</span>
            <span>UAE</span>
            <span>Kenya</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: { label: string; onClick: () => void }[] }) {
  return (
    <div>
      <h4 style={{ color: 'white', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '16px' }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {links.map((link) => (
          <button
            key={link.label}
            onClick={link.onClick}
            style={{
              fontSize: 'var(--text-sm)',
              color: 'rgba(255,255,255,0.6)',
              textAlign: 'left',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
          >
            {link.label}
          </button>
        ))}
      </div>
    </div>
  )
}
