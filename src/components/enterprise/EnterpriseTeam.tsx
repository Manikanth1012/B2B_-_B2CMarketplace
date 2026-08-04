import { useState, useEffect, useCallback } from 'react'
import {
  UserPlus, Shield, Lock, Check as CheckIcon, Minus, Pencil, Trash2, KeyRound,
} from 'lucide-react'
import {
  SectionCard, Table, Td, StatusPill, StatCard, Btn, toast, Modal, FormField,
  TextInput, TextArea, Select,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { useAccountMoney } from './money'
import { loadAdmin, inviteMember, changeRole, changeStatus, saveRole, deleteRole } from '../../lib/enterpriseAdminRepo'
import type { AdminBook } from '../../lib/enterpriseAdminRepo'
import { loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import {
  CAPABILITIES, MFA_FORCING, roleOf, holders, may, summariseRole,
  securityGaps, when, validateInvite, validateRoleChange, validateStatusChange,
  validateRole, validateRoleDelete,
} from '../../lib/enterpriseAdmin'
import type { EnterpriseRole, Person, RoleDraft, Standing } from '../../lib/enterpriseAdmin'

/* Roles and the people who hold them.
 *
 * This screen used to list five names and offer no verb. The reason it now
 * has verbs — invite, move, suspend, remove, and a permission grid somebody
 * can actually edit — is that the approval policy refers to roles by name.
 * A role is therefore the company's configuration, not our enum, and a
 * company that cannot change it is a company that cannot onboard a new site
 * manager without ringing us.
 *
 * Every action asks the rules module first so the refusal is a sentence, and
 * the database asks again through `guard_enterprise_user()` and
 * `guard_enterprise_role()` so the sentence cannot be talked round.
 */

const TODAY = new Date().toISOString().slice(0, 10)

const BLANK_ROLE: RoleDraft = {
  name: '', description: '', can_raise: true, approves_finance: false, approves_it: false,
  approve_limit: null, can_view_billing: false, can_reveal_bank: false,
  can_manage_users: false, can_set_policy: false, mfa_required: false,
}

export function EnterpriseTeam() {
  const [book, setBook] = useState<AdminBook | null>(null)
  const [account, setAccount] = useState<AccountBook | null>(null)
  const cur = account?.account?.currency ?? 'USD'
  const { money0 } = useAccountMoney(cur)
  const [inviting, setInviting] = useState(false)
  const [managing, setManaging] = useState<Person | null>(null)
  const [editing, setEditing] = useState<{ role?: EnterpriseRole; draft: RoleDraft } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<EnterpriseRole | null>(null)

  const reload = useCallback(async () => {
    const [a, b] = await Promise.all([loadAdmin(), loadAccount()])
    setBook(a)
    setAccount(b)
    return a
  }, [])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const { me, people, roles } = book
  if (!me) {
    return (
      <Callout tone="danger" title="This console is not attached to an account">
        {book.loadError ?? 'No enterprise account is linked to the signed-in user.'}
      </Callout>
    )
  }

  const here = people.filter(p => p.status !== 'removed')
  const active = here.filter(p => p.status === 'active')
  const invited = here.filter(p => p.status === 'invited')
  const suspended = here.filter(p => p.status === 'suspended')
  const gaps = securityGaps(people, roles, TODAY)
  const canManage = may(me, roles, 'can_manage_users')
  const canSetPolicy = may(me, roles, 'can_set_policy')
  const centres = account?.centres ?? []

  const run = async (work: Promise<{ ok: boolean; note?: string; reason?: string }>, after?: () => void) => {
    const r = await work as { ok: true; note?: string } | { ok: false; reason: string }
    if (r.ok) {
      toast(r.note ?? 'Saved')
      await reload()
      after?.()
    } else {
      toast(r.reason, 'error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Team &amp; Roles</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '68ch' }}>
            {here.length} {here.length === 1 ? 'person' : 'people'} across {roles.length} roles. These are the same roles the
            approval policy refers to, so changing what a role may do changes who a requisition routes to.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canSetPolicy && (
            <Btn variant="secondary" onClick={() => setEditing({ draft: { ...BLANK_ROLE } })}>
              <Shield size={14} style={{ verticalAlign: '-2px', marginRight: '6px' }} />Create a role
            </Btn>
          )}
          <Btn variant="primary" disabled={!canManage} onClick={() => setInviting(true)}
               title={canManage ? undefined : 'Only somebody who manages people on this account can invite a colleague'}>
            <UserPlus size={14} style={{ verticalAlign: '-2px', marginRight: '6px' }} />Invite a colleague
          </Btn>
        </div>
      </div>

      {!canManage && (
        <Callout tone="info" title="You can read this list but not change it">
          {roleOf(me, roles)?.name ?? 'Your role'} does not manage people on this account. Ask
          {' '}{active.filter(p => may(p, roles, 'can_manage_users')).map(p => p.name).join(' or ') || 'an administrator'}.
        </Callout>
      )}

      <div className="stat-row">
        <StatCard label="People" value={String(here.length)} sublabel={`${active.length} active`} />
        <StatCard label="Roles" value={String(roles.length)}
                  sublabel={`${roles.filter(r => r.system).length} built-in, ${roles.filter(r => !r.system).length} custom`} />
        <StatCard label="Invited, not yet joined" value={String(invited.length)}
                  sublabel={invited.length ? 'Links expire 14 days after sending' : 'Nothing outstanding'} />
        <StatCard label="Outstanding on security" value={String(gaps.length)}
                  color={gaps.length ? 'var(--danger)' : undefined}
                  sublabel={gaps.length ? gapSummary(gaps) : 'Nothing to act on'} />
      </div>

      {gaps.length > 0 && (
        <SectionCard title="Outstanding on security" subtitle="Worst first. Deliberately a list of names rather than a score — a number out of ten tells nobody what to do.">
          <div style={{ padding: '4px 20px 16px' }}>
            {gaps.map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 0', borderBottom: i < gaps.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                <span style={{ color: g.kind === 'mfa' ? 'var(--danger)' : 'var(--warning)', marginTop: '2px' }}>
                  {g.kind === 'mfa' ? <Lock size={15} /> : <KeyRound size={15} />}
                </span>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{g.what}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title={`People at ${account?.account?.company ?? 'this account'}`}
                   subtitle={`${active.length} active · ${invited.length} invited${suspended.length ? ` · ${suspended.length} suspended` : ''}`}>
        <Table headers={['Name', 'Role', 'What they may do', 'Cost centre', 'Last signed in', 'MFA', 'State', '']}>
          {here.map(p => {
            const r = roleOf(p, roles)
            return (
              <tr key={p.id}>
                <Td>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--brand-navy)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                      {p.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {p.name}
                        {p.id === me.id && <span style={{ marginLeft: '6px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-tertiary)' }}>you</span>}
                        {p.out_of_office && <span style={{ marginLeft: '6px', fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>away</span>}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.email}</div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <div style={{ fontWeight: 600 }}>{r?.name ?? p.role}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.title}</div>
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  {r ? summariseRole(r, cur) : '—'}
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>
                  {centres.find(c => c.id === p.cost_centre)?.name ?? p.cost_centre ?? '—'}
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{when(p.last_sign_in)}</Td>
                <Td right>
                  {p.mfa
                    ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--success)', fontWeight: 600 }}>{p.mfa_method ?? 'On'}</span>
                    : <span style={{ fontSize: 'var(--text-xs)', color: r?.mfa_required ? 'var(--danger)' : 'var(--text-tertiary)', fontWeight: 600 }}>
                        {r?.mfa_required ? 'Required, missing' : 'Off'}
                      </span>}
                </Td>
                <Td right><StatusPill status={p.status === 'invited' ? 'pending' : p.status} /></Td>
                <Td right>
                  <Btn size="sm" variant="secondary" disabled={!canManage || p.id === me.id}
                       title={p.id === me.id ? 'Your own record is on My Details' : undefined}
                       onClick={() => setManaging(p)}>Manage</Btn>
                </Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      <SectionCard
        title="Roles"
        subtitle="A role is a bundle of permissions with a name the approval policy can refer to. Built-in roles can be edited but not deleted, because work is routed to them by name."
      >
        <Table headers={['Role', 'What it is for', 'Approves up to', 'People', '']}>
          {roles.map(r => {
            const held = holders(r.id, people)
            return (
              <tr key={r.id}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {r.id}{r.system ? ' · built-in' : ' · custom'}{r.mfa_required ? ' · second factor required' : ''}
                  </div>
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: '38ch' }}>{r.description}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  {r.approves_finance ? (r.approve_limit === null ? 'any value' : money0(Number(r.approve_limit))) : '—'}
                </Td>
                <Td right>{held.length ? held.length : <span style={{ color: 'var(--text-tertiary)' }}>Nobody</span>}</Td>
                <Td right>
                  <div style={{ display: 'inline-flex', gap: '6px' }}>
                    <Btn size="sm" variant="secondary" disabled={!canSetPolicy}
                         onClick={() => setEditing({ role: r, draft: toDraft(r) })}>
                      <Pencil size={12} style={{ verticalAlign: '-2px' }} />
                    </Btn>
                    <Btn size="sm" variant="secondary" disabled={!canSetPolicy || r.system || held.length > 0}
                         title={r.system ? 'Built-in roles cannot be deleted' : held.length ? 'Somebody still holds this role' : undefined}
                         onClick={() => setConfirmDelete(r)}>
                      <Trash2 size={12} style={{ verticalAlign: '-2px' }} />
                    </Btn>
                  </div>
                </Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      <SectionCard title="What each role may do"
                   subtitle="The whole grid in one place, because “who can sign this” is a question people ask about the account rather than about one role.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: `max(${260 + roles.length * 110}px, min-content)` }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 20px', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border-light)', minWidth: '260px' }}>Capability</th>
                {roles.map(r => (
                  <th key={r.id} style={{ textAlign: 'center', padding: '10px 8px', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border-light)', minWidth: '110px' }}>
                    {r.name}
                    <div style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>
                      {holders(r.id, people).length} {holders(r.id, people).length === 1 ? 'person' : 'people'}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map(c => (
                <tr key={String(c.key)}>
                  <td style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-light)', verticalAlign: 'top' }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{c.label}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '46ch' }}>{c.note}</div>
                  </td>
                  {roles.map(r => (
                    <td key={r.id} style={{ textAlign: 'center', padding: '12px 8px', borderBottom: '1px solid var(--border-light)' }}>
                      {r[c.key] === true
                        ? <CheckIcon size={16} style={{ color: 'var(--success)' }} aria-label="permitted" />
                        : <Minus size={16} style={{ color: 'var(--border)' }} aria-label="not permitted" />}
                      {c.key === 'approves_finance' && r.approves_finance && (
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                          {r.approve_limit === null ? 'no ceiling' : money0(Number(r.approve_limit))}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td style={{ padding: '12px 20px' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Second factor required</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '46ch' }}>
                    Forced on any role that approves or can reveal the payment instruction. Not a preference at that point.
                  </div>
                </td>
                {roles.map(r => (
                  <td key={r.id} style={{ textAlign: 'center', padding: '12px 8px' }}>
                    {r.mfa_required
                      ? <CheckIcon size={16} style={{ color: 'var(--success)' }} aria-label="required" />
                      : <Minus size={16} style={{ color: 'var(--border)' }} aria-label="not required" />}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <InviteModal
        open={inviting} onClose={() => setInviting(false)} book={book} centres={centres} cur={cur}
        onSend={draft => run(inviteMember(draft, book), () => setInviting(false))}
      />

      {managing && (
        <ManageModal
          person={managing} book={book} cur={cur} onClose={() => setManaging(null)}
          onRole={id => run(changeRole(managing, id, book), () => setManaging(null))}
          onStatus={s => run(changeStatus(managing, s, book), () => setManaging(null))}
        />
      )}

      {editing && (
        <RoleModal
          state={editing} book={book} onClose={() => setEditing(null)}
          onChange={draft => setEditing({ ...editing, draft })}
          onSave={() => run(saveRole(editing.draft, book, editing.role), () => setEditing(null))}
        />
      )}

      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(null)} title={`Delete ${confirmDelete.name}`}
               footer={<>
                 <Btn variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Btn>
                 <Btn variant="danger" onClick={() => run(deleteRole(confirmDelete, book), () => setConfirmDelete(null))}>Delete role</Btn>
               </>}>
          <Refusal check={validateRoleDelete(confirmDelete, people, me, roles)} />
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            The column disappears from the grid above. Any audit entry recording somebody acting under it keeps the role name,
            so history still reads.
          </p>
        </Modal>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ the dialogs -- */

function InviteModal({ open, onClose, book, centres, cur, onSend }: {
  open: boolean; onClose: () => void; book: AdminBook
  centres: { id: string; name: string }[]
  /* The account's currency, so an approval limit beside a role name is quoted
     in the money that limit is actually set in. */
  cur: string
  onSend: (draft: { name: string; email: string; title: string; role: string; cost_centre: string | null }) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  /* Default to the least a new colleague can be given and still do something:
     raises, approves nothing, administers nothing. Anything else defaults
     somebody into a signing authority nobody chose for them. */
  const [role, setRole] = useState(
    book.roles.find(r => r.can_raise && !r.approves_finance && !r.approves_it && !r.can_manage_users && !r.can_set_policy)?.id
    ?? book.roles[0]?.id ?? '')
  const [centre, setCentre] = useState<string>('')

  useEffect(() => { if (open) { setName(''); setEmail(''); setTitle(''); setCentre('') } }, [open])

  const draft = { name, email, title, role, cost_centre: centre || null }
  const check = validateInvite(draft, book.roles, book.people, book.me)

  return (
    <Modal open={open} onClose={onClose} title="Invite a colleague"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" disabled={!check.ok} onClick={() => onSend(draft)}>Send invitation</Btn>
           </>}>
      <FormField label="Name" required hint="What colleagues see against every requisition they raise or approve.">
        <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Rohit Menon" autoFocus />
      </FormField>
      <FormField label="Work email" required hint="The invitation goes wherever this points, and becomes their sign-in address.">
        <TextInput value={email} onChange={e => setEmail(e.target.value)} placeholder="rohit.menon@company.com" />
      </FormField>
      <FormField label="Job title" hint="Optional. Left blank, it takes the name of the role.">
        <TextInput value={title} onChange={e => setTitle(e.target.value)} placeholder="Site buyer" />
      </FormField>
      <FormField label="Role" required hint="What they can do on their first day. It can be changed afterwards.">
        <Select value={role} onChange={e => setRole(e.target.value)}>
          {book.roles.map(r => <option key={r.id} value={r.id}>{r.name} — {summariseRole(r, cur)}</option>)}
        </Select>
      </FormField>
      <FormField label="Cost centre" hint="Where their spend lands. Leave blank if they only approve.">
        <Select value={centre} onChange={e => setCentre(e.target.value)}>
          <option value="">Not allocated</option>
          {centres.map(c => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
        </Select>
      </FormField>

      <Refusal check={check} />

      <Callout tone="info" title="What sending this does, and does not do">
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: 'var(--text-sm)' }}>
          <li>A single-use link goes to that address and is valid for 14 days.</li>
          <li>They appear below as <em>invited</em> until they sign in — you cannot accept it for them.</li>
          <li>They set their own password. Nobody here ever sees it, including support.</li>
        </ul>
      </Callout>
    </Modal>
  )
}

function ManageModal({ person, book, cur, onClose, onRole, onStatus }: {
  person: Person; book: AdminBook; cur: string; onClose: () => void
  onRole: (roleId: string) => void
  onStatus: (next: Standing) => void
}) {
  const [role, setRole] = useState(person.role)
  const roleCheck = role === person.role ? null : validateRoleChange(person, role, book.me, book.roles, book.people)
  const current = roleOf(person, book.roles)

  const suspendTo: Standing = person.status === 'suspended' ? 'active' : 'suspended'
  const suspendCheck = validateStatusChange(person, suspendTo, book.me, book.roles, book.people)
  const removeCheck = validateStatusChange(person, 'removed', book.me, book.roles, book.people)

  return (
    <Modal open onClose={onClose} title={person.name}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Close</Btn>
             <Btn variant="primary" disabled={!roleCheck?.ok} onClick={() => onRole(role)}>Save role</Btn>
           </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '18px' }}>
        <Fact label="Reference" value={person.user_ref ?? person.id} />
        <Fact label="Email" value={person.email} />
        <Fact label="On the account since" value={person.joined ?? '—'} />
        <Fact label="Last signed in" value={when(person.last_sign_in)} />
        <Fact label="Second factor" value={person.mfa ? (person.mfa_method ?? 'On') : current?.mfa_required ? 'Required, missing' : 'Off'} />
        <Fact label="Password last changed" value={person.password_changed ?? 'Never set'} />
      </div>

      <FormField label="Role" hint={current ? `Today: ${current.name} — ${summariseRole(current, cur)}` : undefined}>
        <Select value={role} onChange={e => setRole(e.target.value)}>
          {book.roles.map(r => <option key={r.id} value={r.id}>{r.name} — {summariseRole(r, cur)}</option>)}
        </Select>
      </FormField>

      {roleCheck && <Refusal check={roleCheck} />}

      <div style={{ borderTop: '1px solid var(--border-light)', marginTop: '18px', paddingTop: '16px' }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '8px' }}>Access</div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '12px', maxWidth: '60ch' }}>
          Suspending keeps the record and the history and can be lifted. Removing takes access away for good — everything
          they raised, approved or ordered stays on the account with their name on it either way.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Btn size="sm" variant="secondary" disabled={!suspendCheck.ok}
               title={suspendCheck.ok ? undefined : suspendCheck.reason}
               onClick={() => onStatus(suspendTo)}>
            {person.status === 'suspended' ? 'Lift the suspension' : 'Suspend'}
          </Btn>
          <Btn size="sm" variant="danger" disabled={!removeCheck.ok}
               title={removeCheck.ok ? undefined : removeCheck.reason}
               onClick={() => onStatus('removed')}>Remove from the account</Btn>
        </div>
        {!suspendCheck.ok && !removeCheck.ok && (
          <div style={{ marginTop: '10px' }}><Refusal check={removeCheck} /></div>
        )}
      </div>
    </Modal>
  )
}

function RoleModal({ state, book, onClose, onChange, onSave }: {
  state: { role?: EnterpriseRole; draft: RoleDraft }
  book: AdminBook
  onClose: () => void
  onChange: (draft: RoleDraft) => void
  onSave: () => void
}) {
  const { role, draft } = state
  const check = validateRole(draft, book.roles, book.me, role)
  const held = role ? holders(role.id, book.people) : []

  const set = (over: Partial<RoleDraft>) => {
    const next = { ...draft, ...over }
    /* MFA follows the permissions rather than waiting to be remembered. A
       screen that lets somebody tick "approves" and then refuses the save for
       a box they have not seen yet is a screen that hides its own rule. */
    if (MFA_FORCING.some(k => next[k] === true)) next.mfa_required = true
    if (!next.approves_finance) next.approve_limit = null
    onChange(next)
  }

  return (
    <Modal open onClose={onClose} title={role ? `Edit ${role.name}` : 'Create a role'}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" disabled={!check.ok} onClick={onSave}>{role ? 'Save role' : 'Create role'}</Btn>
           </>}>
      <FormField label="Name" required hint="The approval policy refers to roles by name, so make it one people recognise.">
        <TextInput value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="Site manager" autoFocus />
      </FormField>
      <FormField label="What it is for" hint="One sentence. It shows beside the name everywhere the role appears.">
        <TextArea value={draft.description} onChange={e => set({ description: e.target.value })}
                  placeholder="Raises requisitions for one site and follows them through. Approves nothing." />
      </FormField>

      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: '4px 0 8px' }}>What it may do</div>
      {CAPABILITIES.map(c => (
        <label key={String(c.key)} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 0', cursor: 'pointer' }}>
          <input type="checkbox" checked={draft[c.key as keyof RoleDraft] === true}
                 onChange={e => set({ [c.key]: e.target.checked } as Partial<RoleDraft>)}
                 style={{ marginTop: '3px' }} />
          <span>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{c.label}</span>
            <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.note}</span>
          </span>
        </label>
      ))}

      {draft.approves_finance && (
        <FormField label="Approval limit" hint="Leave blank for no ceiling. Anything above the limit escalates to somebody who has one.">
          <TextInput type="number" min={0} value={draft.approve_limit ?? ''}
                     placeholder="No ceiling"
                     onChange={e => set({ approve_limit: e.target.value === '' ? null : Number(e.target.value) })} />
        </FormField>
      )}

      <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 0', cursor: draft.mfa_required && MFA_FORCING.some(k => draft[k] === true) ? 'not-allowed' : 'pointer', opacity: MFA_FORCING.some(k => draft[k] === true) ? 0.7 : 1 }}>
        <input type="checkbox" checked={draft.mfa_required}
               disabled={MFA_FORCING.some(k => draft[k] === true)}
               onChange={e => set({ mfa_required: e.target.checked })} style={{ marginTop: '3px' }} />
        <span>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Require a second factor</span>
          <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {MFA_FORCING.some(k => draft[k] === true)
              ? 'Forced on — this role can approve or reveal the payment instruction, and the database refuses it otherwise.'
              : 'Optional for a role that only raises and reads.'}
          </span>
        </span>
      </label>

      <Refusal check={check} />

      {role && held.length > 0 && (
        <Callout tone="warning" title={`${held.length} ${held.length === 1 ? 'person holds' : 'people hold'} this role`}>
          {held.map(p => p.name).join(', ')}. A change here takes effect for them at their next sign-in, and changes who
          a requisition routes to from now on. Requisitions already decided are unaffected.
        </Callout>
      )}
    </Modal>
  )
}

/* ---------------------------------------------------------------- pieces -- */

function Refusal({ check }: { check: { ok: true; note?: string } | { ok: false; reason: string } }) {
  if (!check.ok) return <Callout tone="danger" title="That is not allowed">{check.reason}</Callout>
  if (check.note) return <Callout tone="info" title="What this does">{check.note}</Callout>
  return null
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{value}</div>
    </div>
  )
}

/* The count and its caption have to add up. "3" over "1 without a second
   factor" reads as though two of them are unaccounted for. */
function gapSummary(gaps: { kind: string }[]): string {
  const n = (kind: string) => gaps.filter(g => g.kind === kind).length
  return [
    n('mfa') ? `${n('mfa')} without a second factor` : null,
    n('reset') ? `${n('reset')} still to set a password` : null,
    n('never-signed-in') ? `${n('never-signed-in')} never signed in` : null,
    n('stale-password') ? `${n('stale-password')} with an old password` : null,
  ].filter(Boolean).join(' · ')
}

function toDraft(r: EnterpriseRole): RoleDraft {
  return {
    id: r.id, name: r.name, description: r.description, can_raise: r.can_raise,
    approves_finance: r.approves_finance, approves_it: r.approves_it,
    approve_limit: r.approve_limit === null ? null : Number(r.approve_limit),
    can_view_billing: r.can_view_billing, can_reveal_bank: r.can_reveal_bank,
    can_manage_users: r.can_manage_users, can_set_policy: r.can_set_policy,
    mfa_required: r.mfa_required,
  }
}
