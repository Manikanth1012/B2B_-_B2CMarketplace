import { Sparkles, Shield, Truck, Headphones } from 'lucide-react'
import { HERO_IMAGE, getCategoryImage } from '../lib/images'

import type { View } from '../types/view'

interface HeroProps {
  onNavigate: (view: View, opts?: { category?: string }) => void
}

export function Hero({ onNavigate }: HeroProps) {
  return (
    <section style={{ background: 'var(--brand-navy)', color: 'white', overflow: 'hidden', position: 'relative' }}>
      {/* Background image with overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${HERO_IMAGE})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        opacity: '0.15',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse at top right, rgba(0,166,166,0.2), transparent 60%)',
      }} />

      <div className="container" style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '48px',
        alignItems: 'center',
        padding: '64px 24px',
        position: 'relative',
      }}>
        <div>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(0,166,166,0.15)',
            color: 'var(--brand-accent-light)',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            marginBottom: '20px',
          }}>
            <Sparkles size={14} />
            One marketplace for everything telecom
          </span>
          <h1 style={{
            fontSize: 'var(--text-5xl)',
            fontWeight: 800,
            lineHeight: 1.1,
            marginBottom: '20px',
            letterSpacing: '-0.02em',
          }}>
            Plans, devices, security<br />and IoT — all in one place
          </h1>
          <p style={{
            fontSize: 'var(--text-lg)',
            color: 'rgba(255,255,255,0.7)',
            marginBottom: '32px',
            maxWidth: '480px',
          }}>
            Browse mobile plans, stream entertainment, protect your business, and deploy IoT fleets. Powered by Aventa Telecom across India, UAE and Kenya.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button onClick={() => onNavigate('category', { category: 'consumer' })} className="btn btn-primary btn-lg">
              Shop Plans
            </button>
            <button onClick={() => onNavigate('category', { category: 'device' })} className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }}>
              Browse Devices
            </button>
          </div>
        </div>

        {/* Hero visual */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {[
            { label: 'Mobile Plans', cat: 'consumer', color: '#00A6A6' },
            { label: 'Streaming', cat: 'content', color: '#F5A623' },
            { label: 'Security', cat: 'security', color: '#2563EB' },
            { label: 'IoT Fleet', cat: 'iot', color: '#16A34A' },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => onNavigate('category', { category: item.cat })}
              style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-lg)',
                padding: '0',
                textAlign: 'left',
                transition: 'all 200ms ease',
                backdropFilter: 'blur(10px)',
                overflow: 'hidden',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.05)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.transform = 'translateY(0)' }}
            >
              <div style={{
                height: '100px',
                overflow: 'hidden',
                position: 'relative',
              }}>
                <img
                  src={getCategoryImage(item.cat)}
                  alt={item.label}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  /* item.color is a hex literal on purpose: the `80` suffix is hex alpha,
                     which var() cannot participate in. Decorative tint only. */
                  background: `linear-gradient(to top, ${item.color}80, transparent)`,
                }} />
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'white', marginBottom: '2px' }}>{item.label}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.75)' }}>Explore →</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Trust strip */}
      <div style={{ background: 'var(--brand-navy-dark)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="container" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '24px',
          padding: '20px 24px',
        }}>
          {[
            { icon: <Truck size={18} />, label: 'Free delivery on devices', sub: 'On all orders over $50' },
            { icon: <Shield size={18} />, label: 'Instant activation', sub: 'eSIM and digital services' },
            { icon: <Headphones size={18} />, label: '24/7 support', sub: 'Across all time zones' },
            { icon: <Sparkles size={18} />, label: 'Reward points', sub: 'Earn on every purchase' },
          ].map((item) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'rgba(255,255,255,0.7)' }}>
              <div style={{ color: 'var(--brand-accent)' }}>{item.icon}</div>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'white' }}>{item.label}</div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>{item.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
