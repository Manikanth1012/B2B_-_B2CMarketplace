import type { View } from '../types/view'

interface FooterProps {
  onNavigate: (view: View, opts?: { category?: string }) => void
}

export function Footer({ onNavigate }: FooterProps) {
  return (
    <footer style={{ background: 'var(--brand-navy-dark)', color: 'rgba(255,255,255,0.7)', marginTop: '64px' }}>
      <div className="container" style={{ padding: '48px 24px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
          gap: '32px',
        }}>
          {/* Brand */}
          <div>
            <img src="/assets/brand/6d-logo-white.png" alt="6D Marketplace" style={{ height: '32px', marginBottom: '16px' }} />
            <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, maxWidth: '280px' }}>
              A unified telecom marketplace bringing together plans, devices, security, IoT and digital content across India, UAE and Kenya.
            </p>
          </div>

          {/* Links */}
          <FooterCol title="Shop" links={[
            { label: 'Consumer', onClick: () => onNavigate('category', { category: 'consumer' }) },
            { label: 'Devices', onClick: () => onNavigate('category', { category: 'device' }) },
            { label: 'Digital Content', onClick: () => onNavigate('category', { category: 'content' }) },
            { label: 'IoT', onClick: () => onNavigate('category', { category: 'iot' }) },
            { label: 'Security', onClick: () => onNavigate('category', { category: 'security' }) },
          ]} />

          <FooterCol title="Account" links={[
            { label: 'My Orders', onClick: () => onNavigate('orders') },
            { label: 'Subscriptions', onClick: () => onNavigate('subscriptions') },
            { label: 'Track Order', onClick: () => {} },
            { label: 'Help & Support', onClick: () => {} },
          ]} />

          <FooterCol title="Company" links={[
            { label: 'About Aventa', onClick: () => {} },
            { label: 'Become a Partner', onClick: () => {} },
            { label: 'Careers', onClick: () => {} },
            { label: 'Press', onClick: () => {} },
          ]} />

          <FooterCol title="Legal" links={[
            { label: 'Terms of Service', onClick: () => {} },
            { label: 'Privacy Policy', onClick: () => {} },
            { label: 'Cookie Policy', onClick: () => {} },
            { label: 'Refund Policy', onClick: () => {} },
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
