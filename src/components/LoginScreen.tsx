import { useState, useEffect } from 'react'
import { ShoppingBag, Settings, Store, Building2, ArrowRight, Mail, Lock, Eye, EyeOff, Loader as Loader2 } from 'lucide-react'
import type { Persona, Session } from '../types/view'
import { signIn, requestPasswordReset, SignInError } from '../lib/authRepo'
import { looksLikeEmail, RESET_SENT_MESSAGE } from '../lib/password'
import { useMarket } from '../lib/MarketContext'
import { CONSUMER_SHOPPERS, shopperForMarket } from '../lib/demoShoppers'

interface LoginScreenProps {
  onLogin: (session: Session) => void
  /* The audience the visitor came from. In demo mode it preselects the card and
     fills its credentials in; in real mode it only decides what the heading
     calls them. Neither decides which console opens. */
  prefill?: Persona
  /* Why the visitor is here, when they did not come looking for the login screen
     — adding to the basket sends them through it. Without this the redirect looks
     like the site lost their click. */
  notice?: string
  /* The tour: four persona cards with their passwords typed in. Reached only
     from "Demo sign-in" in the header.

     Everywhere else — the seller console link on Partners, the Retail and
     Enterprise sign-in buttons, the redirect after adding to the basket — is
     the real thing, where somebody types their own address and their own
     password. Those two used to be one screen, so a seller who had just been
     onboarded was shown four demo accounts with somebody else's password
     already in the box, and no way to sign in as themselves. */
  demo?: boolean
  /* Back to where they came from. A sign-in screen with no way out is a dead
     end for the visitor who only wanted to look at the catalogue. */
  onBack?: () => void
  /* How somebody without an account gets one. A password box is the wrong place
     to discover you cannot use it, and the right next step differs by audience:
     a seller applies, a business asks for an account, a shopper registers. */
  onNewAccount?: () => void
}

/* What the real sign-in calls each audience. Not "Consumer Sign-In" — nobody
   arriving from the Retail page thinks of themselves as a consumer, and the
   word is an internal one. */
const REAL_HEADING: Record<Persona, string> = {
  consumer: 'Sign in',
  operator: 'Marketplace sign-in',
  partner: 'Seller sign-in',
  enterprise: 'Business sign-in',
}

const REAL_SUB: Record<Persona, string> = {
  consumer: 'To your account, orders and rewards',
  operator: 'To the marketplace console',
  partner: 'To your seller console',
  enterprise: 'To your company account',
}

/* The way in for somebody who has no account. The operator has none on purpose
   — marketplace staff are issued accounts, and offering a sign-up link would
   say otherwise. */
const NEW_ACCOUNT: Record<Persona, { lead: string; cta: string }> = {
  consumer: { lead: 'New here?', cta: 'Create an account' },
  operator: { lead: 'Marketplace accounts are issued by your administrator.', cta: 'Back to the marketplace' },
  partner: { lead: 'Not selling with us yet?', cta: 'Apply to sell' },
  enterprise: { lead: 'No account for your company yet?', cta: 'Ask for one' },
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

export function LoginScreen(
  { onLogin, prefill, notice, demo = false, onBack, onNewAccount }: LoginScreenProps,
) {
  /* In real mode there is nothing to select — the form is the screen. `selected`
     still carries the audience, so the heading and its icon are the right ones. */
  const [selected, setSelected] = useState<Persona | null>(demo ? prefill ?? null : prefill ?? 'consumer')
  /* Empty in real mode. Filling a stranger's password into a live sign-in box is
     the whole thing this separation exists to stop. */
  const [email, setEmail] = useState(demo && prefill ? DEMO_CREDENTIALS[prefill].email : '')
  const [password, setPassword] = useState(demo && prefill ? DEMO_CREDENTIALS[prefill].password : '')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  /* The reset flow replaces the form in place rather than opening a modal — the
     visitor is already looking at the one field it needs. */
  const [resetting, setResetting] = useState(false)
  const [resetNotice, setResetNotice] = useState('')
  /* Which demo shopper the consumer card is filled with, or null while it is
     still following the market picker. Null rather than a number so that
     changing the market in the header keeps moving it, and clicking one of the
     two chips pins it. */
  const [shopper, setShopper] = useState<number | null>(null)

  /* The market the visitor chose in the header. A demo that offers a market
     picker and then signs everybody in as the same Indian shopper has not
     offered a choice, it has offered a decoration. */
  const { market } = useMarket()
  const suggested = shopperForMarket(market?.code)
  const activeShopper = shopper ?? suggested

  /* Keep the boxes in step with whichever shopper is active — the market
     resolving after mount, or one of the chips being clicked. Only in demo
     mode, and only on the consumer card: filling a stranger's password into a
     live sign-in box is the thing this separation exists to stop. */
  useEffect(() => {
    if (!demo || selected !== 'consumer') return
    setEmail(CONSUMER_SHOPPERS[activeShopper].email)
    setPassword(CONSUMER_SHOPPERS[activeShopper].password)
  }, [demo, selected, activeShopper])

  const pickPersona = (p: Persona) => {
    setSelected(p)
    /* Back to following the picker rather than to Priya, so coming back from
       another card in a Kenyan demo does not quietly reset the country. */
    setShopper(null)
    setEmail(p === 'consumer' ? CONSUMER_SHOPPERS[suggested].email : DEMO_CREDENTIALS[p].email)
    setPassword(p === 'consumer' ? CONSUMER_SHOPPERS[suggested].password : DEMO_CREDENTIALS[p].password)
    setError('')
  }

  /* The card selects which credentials to prefill. It does NOT decide which
     console opens — that comes back from the server with the JWT. Deriving it
     from the card would hand an operator a consumer session for signing in from
     the wrong tile. */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      onLogin(await signIn(email, password, demo))
    } catch (err) {
      setError(err instanceof SignInError ? err.message : 'Could not reach the sign-in service. Try again.')
      setLoading(false)
    }
  }

  const personaCards: Persona[] = ['consumer', 'operator', 'partner', 'enterprise']

  /* Whose wording the form wears. In demo mode a card has been picked by now; in
     real mode it is whichever page they came from, and the shopper's is the
     sensible default for somebody who arrived directly. */
  const audience: Persona = selected ?? 'consumer'

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
        {notice && (
          <div
            /* Announced, because arriving here is the consequence of a click the
               visitor made somewhere else. */
            role="status"
            style={{
              marginBottom: 'var(--space-6)', padding: 'var(--space-4)',
              borderRadius: 'var(--radius)', background: 'rgba(0,166,166,0.16)',
              border: '1px solid rgba(0,166,166,0.4)', color: 'white',
              fontSize: 'var(--text-sm)', textAlign: 'center', lineHeight: 1.5,
            }}
          >
            {notice}
          </div>
        )}
        {demo && !selected ? (
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
                      /* A floor so a description that wraps to two lines does not
                         make its card taller than the rest. Four choice cards in a
                         stack should read as one list, not a ragged column. */
                      minHeight: '104px',
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
              {/* In demo mode this goes back to the four cards. In real mode
                  there are no cards to go back to, so it leaves the sign-in
                  screen entirely — otherwise a visitor who only wanted to look
                  at the catalogue is stranded on a password box. */}
              {(demo || onBack) && (
                <button
                  onClick={() => (demo ? setSelected(null) : onBack?.())}
                  style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {demo ? '← Back to persona selection' : '← Back to the marketplace'}
                </button>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 'var(--radius)',
                  background: PERSONA_META[audience].accentBg,
                  color: PERSONA_META[audience].accentColor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {PERSONA_META[audience].icon}
                </div>
                <div>
                  <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>
                    {demo ? `${PERSONA_META[audience].label} Sign-In` : REAL_HEADING[audience]}
                  </h2>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                    {/* The demo screen names the person whose password is in the
                        box. The real one has no idea who is about to sign in and
                        does not pretend to. */}
                    {!demo ? REAL_SUB[audience]
                      : audience === 'consumer'
                        ? `${CONSUMER_SHOPPERS[activeShopper].who} · ${CONSUMER_SHOPPERS[activeShopper].where}`
                        : PERSONA_META[audience].user}
                  </p>
                </div>
              </div>

              {/* Which country's shopper to be. Only the consumer has two, and a
                  marketplace that trades in three countries is worth little in a
                  demo that can only ever open the first. Demo mode only — the
                  real sign-in has no business prefilling anybody. */}
              {demo && audience === 'consumer' && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-5)' }}>
                  {CONSUMER_SHOPPERS.map((c, i) => (
                    <button
                      key={c.email}
                      type="button"
                      onClick={() => { setShopper(i); setEmail(c.email); setPassword(c.password); setError('') }}
                      style={{
                        flex: 1, textAlign: 'left', cursor: 'pointer',
                        padding: '9px 11px', borderRadius: 'var(--radius)',
                        border: `1px solid ${i === activeShopper ? 'var(--brand-accent)' : 'var(--border)'}`,
                        background: i === activeShopper ? 'rgba(0,166,166,0.06)' : 'white',
                      }}
                    >
                      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{c.where}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '1px' }}>{c.money}</div>
                    </button>
                  ))}
                </div>
              )}

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

                {/* Reset lives with the password field, which is where somebody
                    realises they have forgotten it. */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'calc(-1 * var(--space-3))', marginBottom: 'var(--space-4)' }}>
                  <button
                    type="button"
                    onClick={async () => {
                      setError('')
                      if (!looksLikeEmail(email)) { setError('Enter your email address first, then choose Forgot password.'); return }
                      setResetting(true)
                      await requestPasswordReset(email)
                      setResetting(false)
                      /* Always the same words, whether or not that address has an
                         account — saying otherwise tells a stranger who is registered. */
                      setResetNotice(RESET_SENT_MESSAGE)
                    }}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.65)', fontSize: 'var(--text-xs)', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  >
                    {resetting ? 'Sending…' : 'Forgot password?'}
                  </button>
                </div>

                {resetNotice && (
                  <div role="status" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', borderRadius: 'var(--radius)', background: 'rgba(0,166,166,0.16)', border: '1px solid rgba(0,166,166,0.4)', color: 'white', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
                    {resetNotice}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%', padding: '14px',
                    borderRadius: 'var(--radius)',
                    background: 'var(--brand-accent-dark)', color: 'white',
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
                fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
                textAlign: 'center', lineHeight: 1.6,
              }}>
                {demo
                  ? 'Demo credentials are pre-filled — just click Sign In'
                  : /* Which console opens is the account's business, not this
                       page's. Somebody who both sells and buys holds two
                       accounts and signs in to whichever they meant. */
                    'Sign in with the address and password on your account. Whichever console it belongs to is the one that opens.'}
              </div>

              {!demo && onNewAccount && (
                <div style={{
                  marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)',
                  color: 'var(--text-tertiary)', textAlign: 'center',
                }}>
                  {NEW_ACCOUNT[audience].lead}{' '}
                  <button
                    type="button"
                    onClick={onNewAccount}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      font: 'inherit', color: 'var(--brand-accent-dark)', fontWeight: 700,
                      textDecoration: 'underline',
                    }}
                  >{NEW_ACCOUNT[audience].cta}</button>
                </div>
              )}
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