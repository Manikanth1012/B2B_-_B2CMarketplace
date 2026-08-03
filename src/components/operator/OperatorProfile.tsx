import { useState, useEffect, useCallback } from 'react'
import { Shield, Monitor, KeyRound, Check, TriangleAlert as AlertTriangle } from 'lucide-react'
import { SectionCard, Btn, Modal, FormField, TextInput, Table, Td, StatusPill, toast, fmtDate } from './shared'
import { Callout } from '../OnboardingJourney'
import { useAnchor } from '../useAnchor'
import { supabase } from '../../lib/supabase'
import { currentEmail, changePassword } from '../../lib/authRepo'
import { checkNewPassword, strengthOf, MIN_LENGTH, isDemoAccount } from '../../lib/password'

/* The operator's own record.
 *
 * There was no such screen. The console's avatar menu offered "My profile",
 * "Sign-in & security" and "Sessions", and all three called `setProfileOpen`
 * and nothing else — three buttons that closed the menu, which looks exactly
 * like three buttons that worked.
 *
 * `operator_users` has held the row all along; it was only ever read by Roles &
 * Users, which is the screen for managing *other* people. What this adds is the
 * one thing that screen deliberately does not do: let somebody see and change
 * their own sign-in.
 */

interface OperatorUser {
  id: string
  name: string
  email: string
  role_id: string
  role_name: string
  status: string
  last_active: string | null
  mfa_enabled: boolean
  joined_at: string | null
}

interface OperatorRole {
  id: string
  name: string
  description: string | null
  capabilities: string[] | null
}

/* The console does not keep a session table of its own — `enterprise_sessions`
   is the business persona's. What can be shown honestly is the session the
   browser is actually holding, which is one device and is labelled as such
   rather than dressed up as a list. */
const PASSWORD_POLICY = [
  ['Minimum length', `${MIN_LENGTH} characters`],
  ['Must include', 'Upper and lower case, a digit and a symbol'],
  ['Reuse', 'The last five are refused'],
  ['Lockout', 'Five wrong attempts locks the account for fifteen minutes'],
]

export function OperatorProfile({ anchor }: { anchor?: string }) {
  const [me, setMe] = useState<OperatorUser | null>(null)
  const [role, setRole] = useState<OperatorRole | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const who = await currentEmail()
    setEmail(who)

    /* By the address they signed in with, not by a hard-coded id. The console
       has more than one operator on it and only one of them is looking. */
    const { data } = await supabase.from('operator_users').select('*')
    const rows = (data ?? []) as OperatorUser[]
    const mine = rows.find(u => u.email.toLowerCase() === (who ?? '').toLowerCase()) ?? null
    setMe(mine)

    if (mine) {
      const { data: r } = await supabase.from('operator_roles').select('*').eq('id', mine.role_id).maybeSingle()
      setRole((r ?? null) as OperatorRole | null)
    }
    setLoading(false)
  }, [])
  useEffect(() => { void reload() }, [reload])

  useAnchor(anchor, !loading)

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  if (!me) {
    return (
      <Callout tone="warning" title="No console record for this sign-in">
        You are signed in as {email ?? 'somebody'}, and there is no row in the operator directory for that
        address. Roles &amp; Users is where one is added — until there is, the console cannot say what this
        sign-in is allowed to do.
      </Callout>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>My details</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Your own record on the console — what colleagues see against your actions, and how you sign in.
        </p>
      </div>

      <SectionCard title="About you" subtitle="Every entry in the audit trail is stamped with this name.">
        <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <Field label="Name" value={me.name} />
          <Field label="Sign-in address" value={me.email} />
          <Field label="Role" value={me.role_name} sub={role?.description ?? undefined} />
          <Field label="On the console since" value={me.joined_at ? fmtDate(me.joined_at) : '—'} />
          <Field label="Last active" value={me.last_active ? fmtDate(me.last_active) : 'Not recorded'} />
          <div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Status</div>
            <div style={{ marginTop: '4px' }}><StatusPill status={me.status === 'active' ? 'active' : 'draft'} /></div>
          </div>
        </div>
      </SectionCard>

      {/* ------------------------------------------- sign-in and security -- */}

      <SectionCard anchor="security" title="Sign-in and security"
                   subtitle="Your password and your second factor. Changing somebody else's is on Roles &amp; Users; this is only ever your own.">
        <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Row icon={<KeyRound size={15} />} label="Password"
                 detail={isDemoAccount(me.email)
                   ? 'This is a demo sign-in. Its password is fixed so the walkthrough always works, and it cannot be changed here.'
                   : 'Changed through the marketplace, not by an administrator — nobody else ever knows it.'}>
              <Btn size="sm" variant="secondary" disabled={isDemoAccount(me.email)}
                   onClick={() => setChanging(true)}>Change it</Btn>
            </Row>

            <Row icon={<Shield size={15} />} label="Second factor"
                 tone={me.mfa_enabled ? 'ok' : 'bad'}
                 detail={me.mfa_enabled
                   ? 'On. Every console role requires it, because an operator sign-in can reach every account on the marketplace.'
                   : 'Off. An operator sign-in can reach every account on the marketplace, so this is the one gap worth closing today.'}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: me.mfa_enabled ? 'var(--success)' : 'var(--danger)' }}>
                {me.mfa_enabled ? 'On' : 'Off'}
              </span>
            </Row>
          </div>

          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '10px' }}>Password policy</div>
            {PASSWORD_POLICY.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: '12px', padding: '5px 0', fontSize: 'var(--text-sm)' }}>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{k}</span>
                <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ------------------------------------------------------- sessions -- */}

      <SectionCard anchor="sessions" title="Where you are signed in"
                   subtitle="What this browser is holding. The console keeps no server-side session list, so this is one device and says so rather than inventing a table of them.">
        <Table headers={['Device', 'Signed in', '']}>
          <tr>
            <Td>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Monitor size={14} style={{ color: 'var(--text-tertiary)' }} />
                <div>
                  <div style={{ fontWeight: 600 }}>
                    This browser
                    <span style={{ marginLeft: '6px', fontSize: 'var(--text-xs)', color: 'var(--success)' }}>this one</span>
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{me.email}</div>
                </div>
              </div>
            </Td>
            <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {me.last_active ? fmtDate(me.last_active) : 'This session'}
            </Td>
            <Td right>
              <Btn size="sm" variant="secondary" disabled title="Use sign out in the account menu">Sign out</Btn>
            </Td>
          </tr>
        </Table>
      </SectionCard>

      {changing && (
        <ChangePasswordDialog email={me.email}
                              onClose={() => setChanging(false)}
                              onDone={async () => { setChanging(false); await reload() }} />
      )}
    </div>
  )
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginTop: '2px' }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '3px', lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
}

function Row({ icon, label, detail, tone, children }: {
  icon: React.ReactNode; label: string; detail: string
  tone?: 'ok' | 'warn' | 'bad'; children: React.ReactNode
}) {
  const colour = tone === 'ok' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : 'var(--text-tertiary)'
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <span style={{ color: colour, flexShrink: 0, marginTop: '2px' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: '2px' }}>{detail}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function ChangePasswordDialog({ email, onClose, onDone }: {
  email: string; onClose: () => void; onDone: () => Promise<void>
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)

  const check = checkNewPassword(next, again, email)
  const strength = strengthOf(next)

  return (
    <Modal open onClose={onClose} title="Change your password"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!check.ok || !current || busy} onClick={async () => {
          setBusy(true)
          try {
            /* The current one is asked for and verified. Supabase's own
               `updateUser` does not ask, so a stolen session could otherwise
               change the password and lock the owner out. */
            await changePassword(current, next)
            toast('Password changed. Your other sessions keep working until they expire.')
            await onDone()
          } catch (e) {
            toast(e instanceof Error ? e.message : 'That did not save', 'error')
          } finally { setBusy(false) }
        }}>{busy ? 'Saving…' : 'Change it'}</Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="warning" title="An operator sign-in reaches every account here">
          That is the reason for the length and for the second factor — a console password is not
          protecting one account, it is protecting all of them.
        </Callout>

        <FormField label="Your current password" required
                   hint="Asked for so a session somebody else has cannot change it.">
          <TextInput type="password" value={current} onChange={e => setCurrent(e.target.value)} />
        </FormField>

        <FormField label="New password" required
                   hint={`At least ${MIN_LENGTH} characters, with upper and lower case, a digit and a symbol.`}>
          <TextInput type="password" value={next} onChange={e => setNext(e.target.value)} />
        </FormField>

        {next.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: 'var(--text-xs)' }}>
            {strength.level >= 2
              ? <Check size={13} style={{ color: 'var(--success)' }} />
              : <AlertTriangle size={13} style={{ color: 'var(--warning)' }} />}
            <span style={{ color: strength.level >= 2 ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
              {strength.label}
            </span>
          </div>
        )}

        <FormField label="Type it again" required>
          <TextInput type="password" value={again} onChange={e => setAgain(e.target.value)} />
        </FormField>

        {!check.ok && next.length > 0 && <Callout tone="danger">{check.reason}</Callout>}
      </div>
    </Modal>
  )
}
