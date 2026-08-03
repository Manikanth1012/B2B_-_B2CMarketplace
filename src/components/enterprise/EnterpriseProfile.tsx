import { useState, useEffect, useCallback } from 'react'
import {
  User, Shield, Lock, Wallet, TrendingUp as ChartIcon, Building2, FileText, ClipboardCheck,
  Monitor, Eye, KeyRound, CircleCheck as CheckCircle, CircleAlert as AlertCircle,
} from 'lucide-react'
import {
  SectionCard, Btn, toast, Modal, FormField, TextInput, Select, StatCard, Table, Td,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { useAnchor } from '../useAnchor'
import { useAccountMoney } from './money'
import { EvidenceLink } from '../EvidenceLink'
import type { Viewer } from '../../lib/evidence'
import {
  loadAdmin, saveProfile, setAway, setDelegate, setMfa, endSession, endOtherSessions,
} from '../../lib/enterpriseAdminRepo'
import type { AdminBook } from '../../lib/enterpriseAdminRepo'
import { loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import { changePassword } from '../../lib/authRepo'
import {
  PASSWORD_POLICY, CAPABILITIES, roleOf, summariseRole, may, delegateOptions,
  validateDelegate, validatePassword, passwordStrength, creditPosition, creditReview,
  onboardingProgress, maskAccount, maskTail, maskTaxId, when, money0, daysBetween,
} from '../../lib/enterpriseAdmin'
import type { Person } from '../../lib/enterpriseAdmin'
import { day } from '../../lib/enterprise'

/* My Details, for the person who runs a buying account.
 *
 * It used to be a name, a phone number and two policy lines. Everything a
 * buying account is actually opened on — the company register check, the tax
 * registration, the credit assessment, the direct debit mandate — was
 * collected at onboarding and then shown nowhere, so a finance controller
 * could not answer "what is our limit, when is it reviewed, and which account
 * do you collect from" without ringing somebody.
 *
 * The two halves are deliberately different in kind. The top is yours and
 * editable: your name, how things are shown to you, your sign-in and your
 * cover while away. The bottom is the marketplace's record of a credit
 * decision — readable, exportable, but not editable here, because a buyer who
 * can raise their own credit limit does not have a credit limit.
 */

const TODAY = new Date().toISOString().slice(0, 10)
const TIMEZONES = ['Asia/Kolkata (IST)', 'Asia/Dubai (GST)', 'Europe/London (GMT)', 'America/New_York (EST)', 'Africa/Nairobi (EAT)']
const DATE_FORMATS = ['DD MMM YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY']
const MFA_METHODS = ['Authenticator app', 'SMS to your phone', 'Hardware security key']

export function EnterpriseProfile({ anchor }: { anchor?: string }) {
  const [book, setBook] = useState<AdminBook | null>(null)
  const [account, setAccount] = useState<AccountBook | null>(null)
  const [draft, setDraft] = useState<{ name: string; title: string; phone: string; timezone: string; language: string; date_format: string } | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [turningOnMfa, setTurningOnMfa] = useState(false)

  const reload = useCallback(async () => {
    const [a, b] = await Promise.all([loadAdmin(), loadAccount()])
    setBook(a)
    setAccount(b)
    if (a.me) {
      setDraft({
        name: a.me.name, title: a.me.title, phone: a.me.phone ?? '',
        timezone: a.me.timezone, language: a.me.language, date_format: a.me.date_format,
      })
    }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const cur = account?.account?.currency ?? 'USD'
  const { money0 } = useAccountMoney(cur)

  useAnchor(anchor, book !== null && account !== null)

  if (!book || !account) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const me = book.me
  if (!me || !account.account) {
    return (
      <Callout tone="danger" title="This console is not attached to an account">
        {book.loadError ?? account.loadError ?? 'No enterprise account is linked to the signed-in user.'}
      </Callout>
    )
  }

  const org = account.account
  const role = roleOf(me, book.roles)
  const sessions = book.sessions.filter(s => s.member_id === me.id)
  const canSeeBilling = may(me, book.roles, 'can_view_billing')
  const canRevealBank = may(me, book.roles, 'can_reveal_bank')
  const billing = book.billing
  const credit = billing ? creditPosition(billing, account.invoices, cur) : null
  const review = billing ? creditReview(billing, TODAY) : null
  const progress = onboardingProgress(book.onboarding)
  /* The account's own id is the folder its onboarding pack is filed under, and
     it is already on the screen — no round trip needed to know who is asking. */
  const viewer: Viewer = { persona: 'enterprise', accountId: org.id }
  const delegate = book.people.find(p => p.id === me.delegate_id) ?? null

  const run = async (work: Promise<{ ok: boolean; note?: string; reason?: string }>, after?: () => void) => {
    const r = await work as { ok: true; note?: string } | { ok: false; reason: string }
    if (r.ok) { toast(r.note ?? 'Saved'); await reload(); after?.() }
    else toast(r.reason, 'error')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>My Details</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {me.title} · {org.company} · on the account since {day(me.joined)}
          </p>
        </div>
        <Btn variant="primary" disabled={!draft} onClick={() => draft && run(saveProfile(draft, me))}>Save changes</Btn>
      </div>

      {me.must_reset && (
        <Callout tone="danger" title="Your password has to be set before your next sign-in">
          <Btn size="sm" variant="danger" onClick={() => setChangingPassword(true)}>Set it now</Btn>
        </Callout>
      )}

      {me.out_of_office && (
        <Callout tone="warning" title="You are marked as away">
          {delegate
            ? `Approvals and tasks route to ${delegate.name} while you are out.`
            : 'No delegate is set, so anything assigned to you will simply wait.'}
        </Callout>
      )}

      {/* ------------------------------------------------------------- you -- */}

      <SectionCard title="About you" subtitle="What colleagues see against every requisition you raise or approve.">
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 16px' }}>
          <FormField label="Name" required>
            <TextInput value={draft?.name ?? ''} onChange={e => draft && setDraft({ ...draft, name: e.target.value })} />
          </FormField>
          <FormField label="Job title">
            <TextInput value={draft?.title ?? ''} onChange={e => draft && setDraft({ ...draft, title: e.target.value })} />
          </FormField>
          <FormField label="Work email" hint="Your sign-in address. Changing it is a confirmed round trip on both addresses, so it is not edited here.">
            <TextInput value={me.email} disabled readOnly style={{ background: 'var(--bg-alt)', color: 'var(--text-tertiary)' }} />
          </FormField>
          <FormField label="Phone" hint="Used only for urgent alerts about this account, never for marketing.">
            <TextInput value={draft?.phone ?? ''} onChange={e => draft && setDraft({ ...draft, phone: e.target.value })} placeholder="Not on file" />
          </FormField>
        </div>

        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '10px', paddingTop: '4px', borderTop: '1px solid var(--border-light)' }}>
            <span style={{ display: 'inline-block', paddingTop: '14px' }}>How things are shown to you</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 16px' }}>
            <FormField label="Time zone" hint="Timestamps, cycle dates and invoice due dates follow this.">
              <Select value={draft?.timezone ?? ''} onChange={e => draft && setDraft({ ...draft, timezone: e.target.value })}>
                {TIMEZONES.map(t => <option key={t}>{t}</option>)}
              </Select>
            </FormField>
            <FormField label="Language" hint="Only English is available in this build.">
              <Select value={draft?.language ?? 'English'} onChange={e => draft && setDraft({ ...draft, language: e.target.value })}>
                <option>English</option>
              </Select>
            </FormField>
            <FormField label="Date format">
              <Select value={draft?.date_format ?? ''} onChange={e => draft && setDraft({ ...draft, date_format: e.target.value })}>
                {DATE_FORMATS.map(f => <option key={f}>{f}</option>)}
              </Select>
            </FormField>
          </div>
        </div>
      </SectionCard>

      {/* ---------------------------------------------------------- access -- */}

      <SectionCard title="Your access" subtitle="What your role lets you do, and what it deliberately does not.">
        <div style={{ padding: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '18px' }}>
            <Fact icon={<Shield size={15} />} label="Role" value={role?.name ?? me.role} note={role ? summariseRole(role, cur) : undefined} />
            <Fact icon={<Building2 size={15} />} label="Organisation" value={org.company} note={org.legal_name} />
            <Fact icon={<User size={15} />} label="Your reference" value={me.user_ref ?? me.id} note={`Cost centre ${me.cost_centre ?? 'not allocated'}`} />
            <Fact icon={<ClipboardCheck size={15} />} label="On the account since" value={day(me.joined)} note={`Last signed in ${when(me.last_sign_in).toLowerCase()}`} />
          </div>

          {role && (
            <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '14px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {CAPABILITIES.map(c => (
                  <span key={String(c.key)} style={{
                    fontSize: 'var(--text-xs)', fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--radius-full)',
                    background: role[c.key] === true ? 'var(--success-bg)' : 'var(--bg-alt)',
                    color: role[c.key] === true ? 'var(--success)' : 'var(--text-tertiary)',
                  }}>
                    {role[c.key] === true ? '✓ ' : '– '}{c.label}
                  </span>
                ))}
              </div>
              {role.approves_finance && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '12px' }}>
                  You approve on value {role.approve_limit === null ? 'with no ceiling' : `up to ${money0(Number(role.approve_limit))}`}.
                  You still cannot approve a requisition you raised yourself — separation of duties is not waived for the person at the top.
                </p>
              )}
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '10px', maxWidth: '72ch' }}>
                You cannot change your own role. That is deliberate — it is the control that stops one account quietly granting
                itself everything. Somebody else who manages people has to do it.
              </p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* -------------------------------------------- sign-in and security -- */}

      <SectionCard anchor="security" title="Sign-in and security" subtitle="Your password, your second factor and everywhere you are signed in.">
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
          <div>
            <Row label="Password"
                 detail={me.password_changed
                   ? `Last changed ${day(me.password_changed)} — ${Math.floor(daysBetween(me.password_changed, TODAY) / 30)} months ago`
                   : 'Never set. You sign in by a one-time link until you set one.'}>
              <Btn size="sm" variant="secondary" onClick={() => setChangingPassword(true)}>Change it</Btn>
            </Row>

            <Row label="Second factor"
                 detail={me.mfa
                   ? `On, using ${(me.mfa_method ?? 'an authenticator').toLowerCase()}.`
                   : role?.mfa_required
                     ? `Required by ${role.name} and not set up. You cannot approve anything until it is.`
                     : 'Not set up. Not required by your role, but worth having.'}
                 tone={me.mfa ? 'ok' : role?.mfa_required ? 'bad' : 'warn'}>
              {me.mfa
                ? <Btn size="sm" variant="secondary" onClick={() => run(setMfa(me, false, '', book))}>Turn off</Btn>
                : <Btn size="sm" variant="primary" onClick={() => setTurningOnMfa(true)}>Set it up</Btn>}
            </Row>

            <Row label="Signed in on" detail={`${sessions.length} device${sessions.length === 1 ? '' : 's'}, including this one.`}>
              <Btn size="sm" variant="secondary" disabled={sessions.filter(s => !s.current).length === 0}
                   onClick={() => run(endOtherSessions(me, book))}>Sign out elsewhere</Btn>
            </Row>
          </div>

          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '10px' }}>Password policy</div>
            {[
              ['Minimum length', `${PASSWORD_POLICY.minLength} characters`],
              ['Must include', PASSWORD_POLICY.needs],
              ['Reuse', PASSWORD_POLICY.reuse],
              ['Lockout', PASSWORD_POLICY.lockout],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: '12px', padding: '5px 0', fontSize: 'var(--text-sm)' }}>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{k}</span>
                <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{v}</span>
              </div>
            ))}
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '10px', borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
              {PASSWORD_POLICY.rotation}
            </p>
          </div>
        </div>

        {sessions.length > 0 && (
          <Table headers={['Device', 'Where', 'Started', 'Last seen', '']}>
            {sessions.map(s => (
              <tr key={s.id}>
                <Td>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Monitor size={14} style={{ color: 'var(--text-tertiary)' }} />
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {s.device}
                        {s.current && <span style={{ marginLeft: '6px', fontSize: 'var(--text-xs)', color: 'var(--success)' }}>this one</span>}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{s.browser}</div>
                    </div>
                  </div>
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>
                  {s.location}
                  <div style={{ color: 'var(--text-tertiary)' }}>{s.ip}{s.trusted ? ' · recognised' : ' · not recognised before'}</div>
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{when(s.started)}</Td>
                <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{when(s.last_seen)}</Td>
                <Td right>
                  <Btn size="sm" variant="secondary" disabled={s.current}
                       title={s.current ? 'Use sign out in the account menu' : undefined}
                       onClick={() => run(endSession(s))}>Sign out</Btn>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {/* ------------------------------------------------------ while away -- */}

      <SectionCard title="While you are away" subtitle="A delegate can act in your place. The audit log still records who actually acted.">
        <div style={{ padding: '20px' }}>
          <label style={{ display: 'flex', gap: '10px', alignItems: 'center', cursor: 'pointer', marginBottom: '14px' }}>
            <input type="checkbox" checked={me.out_of_office} onChange={e => run(setAway(me, e.target.checked, book))} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Mark me as away</span>
          </label>
          <FormField label="Delegate" hint={validateDelegate(me, me.delegate_id, book.people, book.roles, cur).ok
            ? (validateDelegate(me, me.delegate_id, book.people, book.roles, cur) as { note?: string }).note
            : undefined}>
            <Select value={me.delegate_id ?? ''} disabled={!me.out_of_office}
                    onChange={e => run(setDelegate(me, e.target.value || null, book, cur))}>
              <option value="">Nobody — work waits for me</option>
              {delegateOptions(me, book.people).map(p => (
                <option key={p.id} value={p.id}>{p.name} · {roleOf(p, book.roles)?.name ?? p.role}</option>
              ))}
            </Select>
          </FormField>
        </div>
      </SectionCard>

      {/* ----------------------------------------------------- how you pay -- */}

      {canSeeBilling && billing && (
        <SectionCard title="How you pay us" subtitle="A buyer is the mirror of a seller: what you hold here is a payment instruction, not a settlement account.">
          <div style={{ padding: '20px' }}>
            {billing.verified
              ? <Callout tone="success" title={`Mandate verified on ${day(billing.verified_on)} by ${billing.verified_by}`}>
                  Collections run on the due date of each invoice, and nothing is collected outside one.
                </Callout>
              : <Callout tone="warning" title="The mandate is not verified">
                  Invoices fall due for manual payment until it is.
                </Callout>}

            <div style={{ marginTop: '16px' }}>
              <Line label="Method" value={billing.method} />
              <Line label="Bank" value={billing.bank ?? '—'} />
              <Line label="Account holder" value={billing.holder ?? '—'} />
              <Line label="Account number" value={revealed ? (billing.account_number ?? '—') : maskAccount(billing.account_number)} mono />
              <Line label={billing.local_label ?? 'Sort code'} value={revealed ? (billing.local_code ?? '—') : maskTail(billing.local_code, 3)} mono />
              <Line label="Mandate reference" value={revealed ? (billing.mandate_ref ?? '—') : maskTail(billing.mandate_ref, 4)} mono />
              <Line label="Mandate signed" value={billing.mandate_signed_on ? `${day(billing.mandate_signed_on)} by ${billing.mandate_signed_by}` : '—'} />
              <Line label="If a collection fails" value={billing.fallback} />
              <Line label="Payment terms" value={billing.terms} />
              <Line label="Invoices sent to" value={billing.billing_contact} />
              <Line label="Invoice format" value={billing.invoice_delivery} />
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', minWidth: '240px' }}>
                Masked on purpose. A mandate reference is enough for somebody to quote convincingly, so showing it in full is a
                separate, logged action.
              </span>
              {canRevealBank
                ? revealed
                  ? <Btn size="sm" variant="secondary" onClick={() => setRevealed(false)}>Hide it again</Btn>
                  : <Btn size="sm" variant="secondary" onClick={() => setRevealing(true)}>
                      <Eye size={13} style={{ verticalAlign: '-2px', marginRight: '6px' }} />Show in full
                    </Btn>
                : <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <Lock size={12} />Only {book.roles.filter(r => r.can_reveal_bank).map(r => r.name).join(' and ')} can reveal this
                  </span>}
            </div>
          </div>
        </SectionCard>
      )}

      {/* ------------------------------------------------- credit position -- */}

      {canSeeBilling && credit && billing && review && (
        <SectionCard title="Credit position" subtitle="What the account owes right now against the limit it was assessed on.">
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginBottom: '16px' }}>
              <StatCard label="Limit" value={money0(credit.limit)} sublabel={billing.terms} />
              <StatCard label="Committed" value={money0(credit.committed)} sublabel="Invoiced and not yet paid" />
              <StatCard label="Headroom" value={money0(credit.headroom)}
                        color={credit.state === 'clear' ? undefined : credit.state === 'watch' ? 'var(--warning)' : 'var(--danger)'}
                        sublabel={`${credit.pct}% of the line drawn`} />
              <StatCard label="Next review" value={review.due ? day(review.due) : '—'}
                        color={review.overdue ? 'var(--danger)' : undefined}
                        sublabel={review.overdue ? 'Overdue' : review.inDays !== null ? `in ${review.inDays} days` : ''} />
            </div>

            <div style={{ height: '8px', borderRadius: '4px', background: 'var(--bg-alt)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.min(100, credit.pct)}%`,
                background: credit.state === 'clear' ? 'var(--success)' : credit.state === 'watch' ? 'var(--warning)' : 'var(--danger)',
              }} />
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '12px' }}>{credit.note}</p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '6px' }}>{review.note}</p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '10px', maxWidth: '72ch' }}>
              <strong>What happens at the limit.</strong> {billing.at_limit_note}
            </p>
          </div>
        </SectionCard>
      )}

      {/* ------------------------------------------ registration and tax -- */}

      <SectionCard title="Company registration" subtitle="What the account was opened against. Held by the marketplace and not editable here.">
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          <Fact icon={<Building2 size={15} />} label="Registered name" value={org.legal_name} note={`Trading as ${org.company}`} />
          <Fact icon={<FileText size={15} />} label="Account reference" value={org.id} note={`${org.segment === 'large' ? 'Large' : org.segment === 'mid' ? 'Mid-market' : 'Small'} · ${org.industry}`} />
          <Fact icon={<User size={15} />} label="Size on file" value={`${org.staff.toLocaleString('en-GB')} staff`} note={`${org.sites} site${org.sites === 1 ? '' : 's'}`} />
          <Fact icon={<Wallet size={15} />} label="Payment terms" value={org.terms} note={`Financial year starts ${day(org.fy_starts)}`} />
          <Fact icon={<ChartIcon size={15} />} label="Budget this year" value={money0(Number(org.budget_year))} note={`Currency ${org.currency}`} />
          <Fact icon={<CheckCircle size={15} />} label="Status" value={org.status === 'active' ? 'Active' : org.status} note="Set by the marketplace finance desk" />
        </div>
      </SectionCard>

      <SectionCard title="Tax registration" subtitle="Your place of supply decides the rate on every invoice we raise.">
        <div style={{ padding: '20px' }}>
          <Callout tone="info" title="It comes from the registered address, not the delivery address">
            Which is why changing a site does not change the tax on your invoices.
          </Callout>
          <div style={{ marginTop: '16px' }}>
            <Line label={org.reg_type} value={maskTaxId(org.registration)} mono />
            <Line label="Place of supply" value={org.place_of_supply} />
            <Line label="Reverse charge" value={org.reverse_charge ? 'Applies — you account for the tax' : 'Does not apply'} />
            <Line label="Exempt" value={org.tax_exempt ? `Yes — certificate ${org.exempt_cert ?? 'on file'}` : 'No'} />
            <Line label="Purchase order required on every invoice" value={org.po_required ? 'Yes — an invoice without one is rejected by your payables, so we refuse to raise one' : 'No'} />
            <Line label="Cost centre shown on invoice lines" value={org.cost_centre_on_invoice ? 'Yes' : 'No'} />
          </div>
        </div>
      </SectionCard>

      {/* --------------------------------------------- the onboarding record -- */}

      <SectionCard title="What was checked when the account was opened"
                   subtitle={`${progress.done} of ${progress.total} complete · the same record our finance desk reads`}>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            A buying account is a credit and compliance decision, not a sign-up. This is the evidence it was opened on.
          </p>
          {book.onboarding.map(c => (
            <div key={c.id} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '12px 14px', background: 'var(--bg-alt)' }}>
                <span style={{ color: c.state === 'done' ? 'var(--success)' : 'var(--warning)' }}>
                  {c.state === 'done' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {c.state === 'done' ? `${day(c.done_on)} · ${c.done_by}` : `Due ${day(c.due_on)}`}
                  </div>
                </div>
                <span style={{
                  fontSize: 'var(--text-xs)', fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--radius-full)',
                  background: c.state === 'done' ? 'var(--success-bg)' : 'var(--warning-bg)',
                  color: c.state === 'done' ? 'var(--success)' : 'var(--warning)',
                }}>{c.state === 'done' ? 'Complete' : 'Due'}</span>
              </div>
              <div style={{ padding: '12px 14px' }}>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>{c.detail}</p>
                {c.documents.length > 0 && (
                  <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-light)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {c.documents.map((d, i) => (
                      <div key={d.name} style={{ display: 'flex', gap: '9px', alignItems: 'center' }}>
                        <FileText size={14} style={{ color: 'var(--text-tertiary)' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{d.name}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{d.kind} · {d.size}</div>
                        </div>
                        {/* Paths are kept in the documents' own order, so the
                            index is the join. A pack whose two arrays disagree
                            would hand somebody the wrong file, which is why the
                            migration asserts they are the same length. */}
                        <EvidenceLink viewer={viewer} doc={{ id: `${c.id}-${i + 1}`, name: d.name, path: c.document_paths[i] ?? null }} compact />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ---------------------------------------------------------- dialogs -- */}

      <PasswordModal open={changingPassword} onClose={() => setChangingPassword(false)} email={me.email} onDone={reload} />

      {turningOnMfa && (
        <MfaModal me={me} onClose={() => setTurningOnMfa(false)}
                  onSet={method => run(setMfa(me, true, method, book), () => setTurningOnMfa(false))} />
      )}

      {revealing && billing && (
        <Modal open onClose={() => setRevealing(false)} title="Show the full payment instruction"
               footer={<>
                 <Btn variant="secondary" onClick={() => setRevealing(false)}>Cancel</Btn>
                 <Btn variant="danger" onClick={() => { setRevealed(true); setRevealing(false); toast('Shown. An entry naming you has gone to the audit log.') }}>Show it</Btn>
               </>}>
          <Callout tone="warning" title="This is logged with your name against it">
            A direct debit mandate reference is enough for somebody to quote convincingly. Closing the panel hides it again.
          </Callout>
        </Modal>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- dialogs -- */

function PasswordModal({ open, onClose, email, onDone }: {
  open: boolean; onClose: () => void; email: string; onDone: () => Promise<void>
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) { setCurrent(''); setNext(''); setAgain('') } }, [open])

  const check = validatePassword(next, again)
  const strength = passwordStrength(next)

  const submit = async () => {
    if (!current) { toast('Enter your current password.', 'error'); return }
    setBusy(true)
    try {
      await changePassword(current, next)
      toast('Password changed. Nobody at the marketplace can see it, including support.')
      await onDone()
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Change your password"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" disabled={!check.ok || busy} onClick={submit}>{busy ? 'Changing…' : 'Change password'}</Btn>
           </>}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: '14px' }}>{email}</p>
      <FormField label="Current password" required
                 hint="Asked for because a stolen session should not be able to change a password and lock the owner out.">
        <TextInput type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
      </FormField>
      <FormField label="New password" required>
        <TextInput type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
      </FormField>
      {next && (
        <div style={{ marginTop: '-8px', marginBottom: '14px' }}>
          <div style={{ height: '5px', borderRadius: '3px', background: 'var(--bg-alt)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${strength.score / 5 * 100}%`, background: strength.score <= 2 ? 'var(--danger)' : strength.score === 3 ? 'var(--warning)' : 'var(--success)' }} />
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {strength.label}{!check.ok ? ` — ${check.reason}` : ''}
          </div>
        </div>
      )}
      <FormField label="Confirm the new password" required>
        <TextInput type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} />
      </FormField>
      <Callout tone="info" title="After you change it">
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: 'var(--text-sm)' }}>
          <li>This session stays signed in. Sessions elsewhere are listed above and can be ended individually.</li>
          <li>{PASSWORD_POLICY.reuse}.</li>
          <li>Nobody at the marketplace can see your password, including support.</li>
        </ul>
      </Callout>
    </Modal>
  )
}

function MfaModal({ me, onClose, onSet }: { me: Person; onClose: () => void; onSet: (method: string) => void }) {
  const [method, setMethod] = useState(MFA_METHODS[0])
  return (
    <Modal open onClose={onClose} title="Set up a second factor"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" onClick={() => onSet(method)}>Turn it on</Btn>
           </>}>
      <FormField label="Method" hint="An authenticator app is the strongest of these. SMS is better than nothing and worse than an app.">
        <Select value={method} onChange={e => setMethod(e.target.value)}>
          {MFA_METHODS.map(m => <option key={m}>{m}</option>)}
        </Select>
      </FormField>
      <Callout tone="info" title="What this changes">
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: 'var(--text-sm)' }}>
          <li>You will be asked for a code at your next sign-in on a device we do not recognise.</li>
          <li>Approvals you sign carry it, which is what makes them defensible in an audit.</li>
          <li>{me.name}, this is on your own account only — colleagues set up their own.</li>
        </ul>
      </Callout>
    </Modal>
  )
}

/* ----------------------------------------------------------------- pieces -- */

function Fact({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note?: string }) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--text-tertiary)', marginTop: '2px' }}>{icon}</span>
      <div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{value}</div>
        {note && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{note}</div>}
      </div>
    </div>
  )
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '16px', padding: '8px 0', borderBottom: '1px solid var(--border-light)', fontSize: 'var(--text-sm)' }}>
      <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '62%', fontFamily: mono ? 'var(--font-mono, monospace)' : undefined }}>{value}</span>
    </div>
  )
}

function Row({ label, detail, tone, children }: {
  label: string; detail: string; tone?: 'ok' | 'warn' | 'bad'; children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
      <span style={{ color: tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : 'var(--text-tertiary)', marginTop: '2px' }}>
        <KeyRound size={15} />
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: tone === 'bad' ? 'var(--danger)' : 'var(--text-tertiary)' }}>{detail}</div>
      </div>
      {children}
    </div>
  )
}
