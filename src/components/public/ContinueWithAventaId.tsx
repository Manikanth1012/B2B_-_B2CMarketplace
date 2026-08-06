import { useState } from 'react'
import { ArrowLeft, ShieldCheck, Check, Info } from 'lucide-react'
import { FormField, TextInput, Btn, toast } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { beginSso, openFromSso, linkToSso, signInWithSso } from '../../lib/ssoRepo'
import { nextStep, carried, stillNeeded, canBind } from '../../lib/sso'
import type { Begun } from '../../lib/sso'
import { DEMO_IDENTITIES } from '../../lib/demoShoppers'
import { signIn } from '../../lib/authRepo'
import type { Session } from '../../types/view'

/* The second door.
 *
 * Somebody who already has an Aventa account has already given the telco their
 * name, number, address and identity documents, and the telco has already
 * verified them. This carries that across instead of asking again.
 *
 * Four things can happen, and the third is the one the screen is built around:
 * an account already exists on the asserted address, and the marketplace will
 * not bind to it until somebody signs into it. A matching email is not proof.
 */

type Stage =
  | { at: 'pick' }
  | { at: 'outcome'; begun: Begun; secret: string }
  | { at: 'password'; begun: Begun; secret: string }

export function ContinueWithAventaId({ onLeave, onRegisterInstead, onDone }: {
  onLeave: () => void
  onRegisterInstead: () => void
  onDone: (session: Session) => void
}) {
  const [stage, setStage] = useState<Stage>({ at: 'pick' })
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')

  const choose = async (subject: string, secret: string) => {
    setBusy(true)
    const res = await beginSso(subject, secret)
    setBusy(false)
    if (!res.ok) { toast(res.reason, 'error'); return }
    setStage({ at: 'outcome', begun: res.begun, secret })
  }

  const proceed = async () => {
    if (stage.at !== 'outcome') return
    const { begun, secret } = stage

    if (begun.outcome === 'provision') {
      setBusy(true)
      const res = await openFromSso(begun.assertion, secret)
      setBusy(false)
      if (!res.ok) { toast(res.reason, 'error'); return }
      toast(`Welcome. You are customer ${res.customer_id}.`)
      onDone(res.session)
      return
    }

    if (begun.outcome === 'signin') {
      setBusy(true)
      const res = await signInWithSso(begun.assertion.subject, secret)
      setBusy(false)
      if (!res.ok) { toast(res.reason, 'error'); return }
      onDone(res.session)
      return
    }

    /* The confirmation. Nothing is bound until a password on that account has
       been typed, which is the entire point of this branch. */
    setStage({ at: 'password', begun, secret })
  }

  const confirmAndLink = async () => {
    if (stage.at !== 'password') return
    const { begun, secret } = stage
    const email = begun.assertion.email

    setBusy(true)
    /* Sign in first. Proving the password is what makes the binding safe, so
       the binding cannot come first and cannot be conditional on anything the
       client decides. `signIn` throws on a bad credential and says the same
       thing either half was wrong — naming which would tell a stranger whether
       the address is registered. */
    let session: Session
    try {
      session = await signIn(email, password)
    } catch (e) {
      setBusy(false)
      toast(e instanceof Error ? e.message : 'That password did not work.', 'error')
      return
    }

    /* Belt and braces against a session that is not the one just asked for —
       `sso_link` refuses this too, and refusing here means the message arrives
       before the round trip rather than as a Postgres error after it. */
    const allowed = canBind(email, begun.assertion)
    if (!allowed.ok) { setBusy(false); toast(allowed.reason, 'error'); return }

    const link = await linkToSso(begun.assertion.subject, secret)
    setBusy(false)
    if (!link.ok) { toast(link.reason, 'error'); return }

    toast('Linked. Either your Aventa ID or your password will sign you in from now on.')
    onDone(session)
  }

  return (
    <div style={{ background: 'var(--bg-alt)', minHeight: '70vh' }}>
      <div className="container" style={{ paddingTop: '32px', paddingBottom: '56px', maxWidth: '640px' }}>
        <button onClick={stage.at === 'pick' ? onLeave : () => setStage({ at: 'pick' })}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: '18px',
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
          }}>
          <ArrowLeft size={15} /> {stage.at === 'pick' ? 'Back' : 'Use a different Aventa ID'}
        </button>

        {stage.at === 'pick' && <Pick busy={busy} onChoose={choose} onRegisterInstead={onRegisterInstead} />}

        {stage.at === 'outcome' && (
          <Outcome begun={stage.begun} busy={busy}
            onProceed={proceed} onRegisterInstead={onRegisterInstead} />
        )}

        {stage.at === 'password' && (
          <Confirm begun={stage.begun} busy={busy} password={password}
            onPassword={setPassword} onConfirm={confirmAndLink} />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- the picker */

function Pick({ busy, onChoose, onRegisterInstead }: {
  busy: boolean
  onChoose: (subject: string, secret: string) => void
  onRegisterInstead: () => void
}) {
  return (
    <>
      <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--text)' }}>
        Continue with Aventa ID
      </h1>
      <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', marginTop: '10px', lineHeight: 1.6 }}>
        If you already have an Aventa account, the marketplace can open one from it. Your name, number,
        address and verified identity come across — there is nothing to fill in.
      </p>

      {/* Said plainly rather than left for somebody to work out. A real provider
          holds its own session and there is no list at all; this stands in for
          having one. */}
      <Callout tone="info" title="This stands in for the Aventa ID sign-in page">
        In a real deployment you would already be signed in to Aventa ID, or would sign in there and come
        straight back. Pick a subscriber below to see what the marketplace does with what it is told.
      </Callout>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '18px' }}>
        {DEMO_IDENTITIES.map(d => (
          <button key={d.subject} type="button" disabled={busy}
            onClick={() => onChoose(d.subject, d.secret)}
            style={{
              textAlign: 'left', cursor: busy ? 'wait' : 'pointer', padding: '13px 15px',
              borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'white',
            }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>{d.who}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {d.shows}
            </div>
          </button>
        ))}
      </div>

      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '20px' }}>
        No Aventa account?{' '}
        <button onClick={onRegisterInstead} style={link}>Create one here instead</button> — it takes a minute.
      </p>
    </>
  )
}

/* ------------------------------------------------- what it decided, and why */

function Outcome({ begun, busy, onProceed, onRegisterInstead }: {
  begun: Begun; busy: boolean; onProceed: () => void; onRegisterInstead: () => void
}) {
  const step = nextStep(begun)
  const rows = carried(begun.assertion)

  return (
    <>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{step.title}</h1>
      <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', marginTop: '10px', lineHeight: 1.6 }}>
        {step.detail}
      </p>

      {step.step === 'stop' ? (
        <div style={{ marginTop: '22px' }}>
          {/* A refusal here is about a fact the telco holds, so there is nothing
              to retry. The way on is the ordinary form. */}
          <Btn onClick={onRegisterInstead}>Create an account instead</Btn>
        </div>
      ) : (
        <>
          {step.step !== 'enter' && (
            <div style={{
              background: 'white', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: '18px', marginTop: '20px',
            }}>
              <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '10px' }}>
                What Aventa is telling the marketplace
              </h2>
              {rows.map(r => (
                <div key={r.label} style={{
                  display: 'flex', justifyContent: 'space-between', gap: '16px',
                  padding: '7px 0', borderBottom: '1px solid var(--border-light)',
                }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>{r.label}</span>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, textAlign: 'right' }}>
                    {r.value}
                    {/* Which of these the telco actually verified, rather than
                        letting a plan name sit beside a checked address and
                        imply both were. */}
                    {r.verified && (
                      <ShieldCheck size={13} style={{ marginLeft: 6, verticalAlign: '-2px', color: 'var(--success)' }} />
                    )}
                  </span>
                </div>
              ))}
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '10px' }}>
                <ShieldCheck size={11} style={{ verticalAlign: '-1px', color: 'var(--success)' }} /> verified by Aventa
                on {begun.assertion.kyc_verified_on}. The rest is held by Aventa but not verified.
              </p>
            </div>
          )}

          {step.step === 'open' && (
            <div style={{ marginTop: '16px' }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '6px' }}>
                What you will still be asked for
              </h3>
              {/* "Nothing to fill in" followed by a payment form at checkout is
                  a promise that was not quite true. */}
              {stillNeeded().map(s => (
                <div key={s} style={{ display: 'flex', gap: '7px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', padding: '2px 0' }}>
                  <Info size={14} style={{ marginTop: 2, flexShrink: 0, color: 'var(--text-tertiary)' }} /> {s}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: '22px' }}>
            <Btn disabled={busy} onClick={onProceed}>{busy ? 'Working…' : step.action}</Btn>
          </div>
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------- proving it is theirs */

function Confirm({ begun, busy, password, onPassword, onConfirm }: {
  begun: Begun; busy: boolean; password: string
  onPassword: (v: string) => void; onConfirm: () => void
}) {
  return (
    <>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>
        Sign in once to link them
      </h1>
      <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', marginTop: '10px', lineHeight: 1.6 }}>
        This proves the marketplace account on <strong>{begun.assertion.email}</strong> is yours. After this,
        either your Aventa ID or your password will sign you in.
      </p>

      {/* The reason the step exists, said out loud. Somebody asked for a
          password in the middle of a "no fuss" journey is owed an explanation,
          and the explanation is the security property. */}
      <Callout tone="info" title="Why you are being asked">
        A matching email address is not proof the account is yours. Anyone who could make Aventa assert your
        address would otherwise be handed whatever sits on it — your orders, your wallet and your points.
        This is asked once and never again.
      </Callout>

      <div style={{
        background: 'white', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: '20px', marginTop: '18px',
      }}>
        <FormField label="Marketplace password for this account" required>
          <TextInput type="password" value={password} autoFocus
            onChange={e => onPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && password) onConfirm() }} />
        </FormField>
        <Btn disabled={busy || !password} onClick={onConfirm}>
          {busy ? 'Linking…' : 'Sign in and link'}
        </Btn>
      </div>
    </>
  )
}

const link: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand-accent)', fontSize: 'inherit', fontWeight: 600,
  textDecoration: 'underline', textUnderlineOffset: '3px',
}
