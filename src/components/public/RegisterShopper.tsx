/* Becoming a shopper.
 *
 * The retail page offered "Start shopping", which goes to the catalogue — and
 * the moment somebody tried to put something in a basket they met a sign-in
 * screen with four demo accounts on it and no way to make a fifth.
 *
 * Unlike the seller application this makes a real account on the first screen,
 * because everything a shopper does is owner-scoped and there is nothing to
 * hang a basket on until an auth user exists. So it is one form, and the thing
 * it has to get right is the moment somebody commits a password.
 *
 * Where they register is asked for and explained rather than inferred. It
 * decides the currency they are quoted in and the tax they pay, it does not
 * change afterwards with the storefront picker, and a shopper who finds that
 * out at checkout has been misled by omission.
 */
import { useState, useEffect } from 'react'
import { ArrowLeft, Check, Eye, EyeOff, UserPlus } from 'lucide-react'
import { Btn, FormField, TextInput, Select, toast } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { validateSignUp, passwordStrength, marketNote, MIN_PASSWORD, BLANK_SIGNUP } from '../../lib/register'
import type { SignUpDraft, Strength } from '../../lib/register'
import { registerShopper, emailTaken } from '../../lib/registerRepo'
import { loadMoneyBook } from '../../lib/moneyRepo'
import type { MoneyBook } from '../../lib/moneyRepo'
import type { Session } from '../../types/view'

const BAND: Record<Strength, { label: string; colour: string; fill: string }> = {
  weak: { label: 'Too weak', colour: 'var(--danger)', fill: '25%' },
  fair: { label: 'Fair', colour: 'var(--warning)', fill: '50%' },
  good: { label: 'Good', colour: 'var(--info)', fill: '75%' },
  strong: { label: 'Strong', colour: 'var(--success)', fill: '100%' },
}

export function RegisterShopper({ onLeave, onSignIn, onRegistered }: {
  onLeave: () => void
  onSignIn: () => void
  onRegistered: (session: Session, customerId: string) => void
}) {
  const [draft, setDraft] = useState<SignUpDraft>(BLANK_SIGNUP)
  const [book, setBook] = useState<MoneyBook | null>(null)
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [taken, setTaken] = useState(false)

  useEffect(() => { void loadMoneyBook().then(setBook) }, [])

  const markets = book?.markets ?? []
  const set = (over: Partial<SignUpDraft>) => setDraft({ ...draft, ...over })
  const strength = passwordStrength(draft.password, { name: draft.name, email: draft.email })
  const note = book ? marketNote(draft.market, book.markets, book.accepted) : null
  const check = validateSignUp(draft, markets)

  /* Asked once, when they leave the box, rather than on every keystroke — a
     lookup per character is a lookup that says "taken" while somebody is still
     typing the address that is not. */
  const checkEmail = async () => {
    if (!draft.email.includes('@')) { setTaken(false); return }
    setTaken(await emailTaken(draft.email))
  }

  const submit = async () => {
    if (!check.ok) { toast(check.reason, 'error'); return }
    setBusy(true)
    const res = await registerShopper(draft, markets)
    setBusy(false)
    if (!res.ok) { toast(res.reason, 'error'); return }
    toast(`Welcome. You are customer ${res.customer_id}.`)
    onRegistered(res.session, res.customer_id)
  }

  return (
    <div style={{ background: 'var(--bg-alt)', minHeight: '70vh' }}>
      <div className="container" style={{ paddingTop: '32px', paddingBottom: '56px', maxWidth: '720px' }}>
        <button onClick={onLeave} style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: '18px',
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
        }}>
          <ArrowLeft size={15} /> Back to retail
        </button>

        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--text)' }}>
          Create your account
        </h1>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', marginTop: '10px', lineHeight: 1.6 }}>
          One account for plans, devices, entertainment and home — one basket, one bill and one
          support queue. It takes a minute and you can shop straight afterwards.
        </p>

        <div style={{
          background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          padding: '22px', marginTop: '22px',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '4px 18px' }}>
            <FormField label="Your name" required>
              <TextInput value={draft.name} onChange={e => set({ name: e.target.value })}
                         placeholder="As it should appear on your bill" />
            </FormField>
            <FormField label="Mobile number" required hint="What plans and top-ups are attached to">
              <TextInput value={draft.msisdn} onChange={e => set({ msisdn: e.target.value })}
                         placeholder="+91 98860 41127" />
            </FormField>
            <FormField label="Email" required hint="This is how you sign in">
              <TextInput type="email" value={draft.email}
                         onChange={e => { set({ email: e.target.value }); setTaken(false) }}
                         onBlur={() => void checkEmail()} />
            </FormField>
            <FormField label="City" required hint="Where deliveries go">
              <TextInput value={draft.city} onChange={e => set({ city: e.target.value })} />
            </FormField>
          </div>

          {taken && (
            <div style={{ marginTop: '4px', marginBottom: '12px' }}>
              <Callout tone="warning" title="That address already has an account">
                <button onClick={onSignIn} style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--brand-accent-dark)', fontWeight: 700, fontSize: 'var(--text-sm)',
                }}>Sign in instead</button>, or use the password reset on that screen if you
                cannot get in.
              </Callout>
            </div>
          )}

          <FormField label="Password" required
                     hint={`At least ${MIN_PASSWORD} characters. Three ordinary words beat one clever one.`}>
            <div style={{ position: 'relative' }}>
              <TextInput
                type={show ? 'text' : 'password'}
                value={draft.password}
                onChange={e => set({ password: e.target.value })}
                style={{ paddingRight: '40px' }}
              />
              <button
                type="button" onClick={() => setShow(v => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)',
                  display: 'flex', alignItems: 'center',
                }}>
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </FormField>

          {/* Only once there is something to judge. A meter that says "too weak"
              at the first keystroke is telling somebody off for typing. */}
          {draft.password.length > 0 && (
            <div style={{ marginTop: '-6px', marginBottom: '14px' }}>
              <div style={{ height: '4px', borderRadius: '2px', background: 'var(--bg-alt)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: BAND[strength].fill, background: BAND[strength].colour, borderRadius: '2px' }} />
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: BAND[strength].colour, fontWeight: 700, marginTop: '4px' }}>
                {BAND[strength].label}
              </div>
            </div>
          )}

          <FormField label="Where you are" required
                     hint="Decides what you are quoted in and the tax you pay. It does not change with the storefront picker.">
            <Select value={draft.market} onChange={e => set({ market: e.target.value })}>
              <option value="">Choose one</option>
              {markets.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
            </Select>
          </FormField>

          {note && (
            <div style={{ marginTop: '-4px', marginBottom: '14px' }}>
              <Callout tone="info" title="What that means">{note}</Callout>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn variant="primary" onClick={submit} disabled={busy}>
              <UserPlus size={14} /> {busy ? 'Creating your account…' : 'Create account and start shopping'}
            </Btn>
            {!check.ok && draft.name !== '' && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flex: 1, minWidth: '200px' }}>
                {check.reason}
              </span>
            )}
          </div>
        </div>

        <div style={{ marginTop: '18px' }}>
          <Callout tone="info" title="What you get straight away">
            <ul style={{ margin: '4px 0 0 16px' }}>
              <li>A basket that survives signing out, and one bill across everything you buy.</li>
              <li>Reward points from your first order — you start at Bronze and earn up from there.</li>
              <li>One support queue, whoever the seller is.</li>
            </ul>
          </Callout>
        </div>

        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '18px' }}>
          Already have an account?{' '}
          <button onClick={onSignIn} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: 'var(--brand-accent-dark)', fontWeight: 700, fontSize: 'var(--text-sm)',
          }}>Sign in</button>.
        </p>
      </div>
    </div>
  )
}
