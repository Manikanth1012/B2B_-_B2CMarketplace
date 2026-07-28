import { useState } from 'react'
import { ShoppingBag, Settings, ArrowRight, Mail, Lock, Eye, EyeOff, Loader as Loader2 } from 'lucide-react'
import type { Persona } from '../types/view'

interface LoginScreenProps {
  onLogin: (persona: Persona) => void
}

const DEMO_CREDENTIALS = {
  consumer: { email: 'priya.raman@example.com', password: 'demo1234' },
  operator: { email: 'anika.sharma@aventa.com', password: 'operator123' },
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
        onLogin(selected)
      } else {
        setError('Incorrect email or password. Use the pre-filled demo credentials.')
        setLoading(false)
      }
    }, 700)
  }

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
      {/* Logo */}
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
              {/* Consumer card */}
              <button
                onClick={() => pickPersona('consumer')}
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
                  background: 'rgba(0,166,166,0.2)', color: 'var(--brand-accent-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <ShoppingBag size={24} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'white', fontSize: 'var(--text-base)', fontWeight: 700 }}>Consumer</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-sm)', marginTop: '2px' }}>
                    Browse plans, devices & services
                  </div>
                </div>
                <ArrowRight size={20} style={{ color: 'rgba(255,255,255,0.4)' }} />
              </button>

              {/* Operator card */}
              <button
                onClick={() => pickPersona('operator')}
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
                  background: 'rgba(245,166,35,0.15)', color: 'var(--brand-gold)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Settings size={24} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'white', fontSize: 'var(--text-base)', fontWeight: 700 }}>Operator Admin</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-sm)', marginTop: '2px' }}>
                    Manage marketplace operations
                  </div>
                </div>
                <ArrowRight size={20} style={{ color: 'rgba(255,255,255,0.4)' }} />
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Login form */}
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
                  background: selected === 'consumer' ? 'rgba(0,166,166,0.1)' : 'rgba(245,166,35,0.1)',
                  color: selected === 'consumer' ? 'var(--brand-accent)' : 'var(--brand-gold)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selected === 'consumer' ? <ShoppingBag size={20} /> : <Settings size={20} />}
                </div>
                <div>
                  <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>
                    {selected === 'consumer' ? 'Consumer Sign-In' : 'Operator Sign-In'}
                  </h2>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                    {selected === 'consumer' ? 'Priya Raman · Gold member' : 'Anika Sharma · Aventa Communications'}
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
