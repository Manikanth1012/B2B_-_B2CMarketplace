import { useState } from 'react'
import { ShoppingBag, Settings, Store, Building2, ArrowRight, Mail, Lock, Eye, EyeOff, Loader as Loader2 } from 'lucide-react'
import type { Persona, Session } from '../types/view'

interface LoginScreenProps {
  onLogin: (session: Session) => void
}

const DEMO_CREDENTIALS: Record<Persona, { email: string; password: string }> = {
  consumer: { email: 'priya.raman@example.com', password: 'demo1234' },
  operator: { email: 'anika.sharma@aventa.com', password: 'operator123' },
  partner: { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' },
  enterprise: { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' },
}

const PERSONA_META: Record<Persona, { label: string; sub: string; user: string; icon: React.ReactNode; accentBg: string; accentFg: string; accentColor: string }> = {
  consumer: {
    label: 'Consumer',
    sub: 'Browse plans, devices & services',
    user: 'Priya Raman · Gold member',
    icon: <ShoppingBag size={24} />,
    accentBg: 'rgba(0,166,166,0.2)',
    accentFg: 'var(--brand-accent-light)',
    accentColor: 'var(--brand-accent)',
  },
  operator: {
    label: 'Operator Admin',
    sub: 'Manage marketplace operations',
    user: 'Anika Sharma · Aventa Communications',
    icon: <Settings size={24} />,
    accentBg: 'rgba(245,166,35,0.15)',
    accentFg: 'var(--brand-gold)',
    accentColor: 'var(--brand-gold)',
  },
  partner: {
    label: 'Partner / Seller',
    sub: 'Onboard products, manage orders & settlement',
    user: 'Rajesh Kumar · Nimbus Sensors',
    icon: <Store size={24} />,
    accentBg: 'rgba(94,75,155,0.2)',
    accentFg: '#B8A4E8',
    accentColor: '#7C63D6',
  },
  enterprise: {
    label: 'Enterprise Buyer',
    sub: 'Procure IoT, security & devices with approvals',
    user: 'Vikram Shah · SmartBuild Ltd',
    icon: <Building2 size={24} />,
    accentBg: 'rgba(0,107,107,0.25)',
    accentFg: '#4FCDCD',
    accentColor: '#006B6B',
  },
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [selected, setSelected] = useState<Persona | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const pickPersona = (p: Persona) => {
    setSelected(p)
    setEmail(DEMO_CREDENTIALS[p].email)
    setPassword(DEMO_CREDENTIALS[p].password)
    setError('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    setError('')
    setLoading(true)
    const creds = DEMO_CREDENTIALS[selected]
    setTimeout(() => {
      if (email.trim() === creds.email && password === creds.password) {
        onLogin({
          persona: selected,
          partnerId: selected === 'partner' ? 'PTR-1004' : undefined,
        })
      } else {
        setError('Incorrect email or password. Use the pre-filled demo credentials.')
        setLoading(false)
      }
    }, 700)
  }

  const personaCards: Persona[] = ['consumer', 'operator', 'partner', 'enterprise']

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, var(--brand-navy-dark) 0%, var(--brand-navy) 50%, var(--brand-navy-light) 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-6)',
    }}>
      <div style={{ marginBottom: 'var(--space-8)', textAlign: 'center' }}>
        <img src="/assets/brand/6d-logo-white.png" alt="6D Marketplace" style={{ height: '40px', margin: '0 auto' }} />
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)', letterSpacing: '0.05em' }}>
          TELECOM MARKETPLACE PLATFORM
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 440 }}>
        {!selected ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
              <h1 style={{ color: 'white', fontSize: 'var(--text-3xl)', fontWeight: 800, marginBottom: 'var(--space-2)' }}>
                Welcome back
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 'var(--text-base)' }}>
                Choose how you'd like to sign in
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {personaCards.map((p) => {
                const meta = PERSONA_META[p]
                return (
                  <button
                    key={p}
                    onClick={() => pickPersona(p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                      padding: 'var(--space-5) var(--space-6)',
                      borderRadius: 'var(--radius-lg)',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      cursor: 'pointer',
                      transition: 'all 200ms ease',
                      textAlign: 'left',
                      width: '100%',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(0,201,201,0.4)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.transform = 'translateY(0)' }}
                  >
                    <div style={{
                      width: 48, height: 48, borderRadius: 'var(--radius-md)',
                      background: meta.accentBg, color: meta.accentFg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {meta.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'white', fontSize: 'var(--text-base)', fontWeight: 700 }}>{meta.label}</div>
                      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-sm)', marginTop: '2px' }}>
                        {meta.sub}
                      </div>
                    </div>
                    <ArrowRight size={20} style={{ color: 'rgba(255,255,255,0.4)' }} />
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <div style={{
              background: 'white',
              borderRadius: 'var(--radius-xl)',
              padding: 'var(--space-8)',
              boxShadow: 'var(--shadow-xl)',
            }}>
              <button
                onClick={() => setSelected(null)}
                style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                ← Back to persona selection
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 'var(--radius)',
                  background: PERSONA_META[selected].accentBg,
                  color: PERSONA_META[selected].accentColor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {PERSONA_META[selected].icon}
                </div>
                <div>
                  <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>
                    {PERSONA_META[selected].label} Sign-In
                  </h2>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                    {PERSONA_META[selected].user}
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                    Email address
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      style={{
                        width: '100%', padding: '12px 12px 12px 42px',
                        borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                        fontSize: 'var(--text-sm)', outline: 'none', color: 'var(--text)',
                        transition: 'border-color 150ms ease',
                      }}
                      onFocus={(e) => e.target.style.borderColor = 'var(--brand-accent)'}
                      onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 'var(--space-5)' }}>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
                    Password
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      required
                      style={{
                        width: '100%', padding: '12px 42px 12px 42px',
                        borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                        fontSize: 'var(--text-sm)', outline: 'none', color: 'var(--text)',
                        transition: 'border-color 150ms ease',
                      }}
                      onFocus={(e) => e.target.style.borderColor = 'var(--brand-accent)'}
                      onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', padding: 0, display: 'flex' }}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div style={{
                    padding: '10px 14px', borderRadius: 'var(--radius)',
                    background: 'var(--danger-bg)', color: 'var(--danger)',
                    fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)',
                  }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%', padding: '14px',
                    borderRadius: 'var(--radius)',
                    background: 'var(--brand-accent)', color: 'white',
                    fontSize: 'var(--text-base)', fontWeight: 700,
                    border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    transition: 'all 150ms ease',
                  }}
                  onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = 'var(--brand-accent-dark)' }}
                  onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = 'var(--brand-accent)' }}
                >
                  {loading ? (
                    <><Loader2 size={20} className="spin" /> Signing in…</>
                  ) : (
                    <>Sign In <ArrowRight size={18} /></>
                  )}
                </button>
              </form>

              <div style={{
                marginTop: 'var(--space-5)', padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius)', background: 'var(--bg-alt)',
                fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center',
              }}>
                Demo credentials are pre-filled — just click Sign In
              </div>
            </div>
          </>
        )}
      </div>

      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-8)' }}>
        © 2026 6D Marketplace. All rights reserved.
      </p>
    </div>
  )
}