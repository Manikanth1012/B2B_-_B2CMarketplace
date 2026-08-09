/* Reviewing what has been collected, and asking to spend it.
 *
 * The button that opens this used to be a toast reading "added to requisition",
 * with no requisition behind it. `raiseRequisition` existed and had never been
 * called from anywhere, so this is the screen that connects the shelf to it.
 *
 * The order of the panel is the order of the decision: what is in it, what it
 * comes to, what that will require, and only then the fields an approver needs.
 * A buyer should learn that ₹2,40,000 of sensors needs finance approval before
 * they have written a justification, not after.
 */
import { useState, useEffect } from 'react'
import { X, Trash2, TriangleAlert as AlertTriangle, Check } from 'lucide-react'
import { Btn, toast } from '../operator/shared'
import { useRequisition } from '../../lib/RequisitionContext'
import { verdict, missingFields, missingNote, verticalOf, modelOf } from '../../lib/requisitionBasket'
import type { MissingField } from '../../lib/requisitionBasket'
import { raiseRequisition, loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import { useMarket } from '../../lib/MarketContext'
import { VERTICAL_NAMES } from './data'
import { getProductImage } from '../../lib/images'
import { round2 } from '../../lib/money'

const BLANK = { title: '', reason: '', cost_centre: null as string | null, po_ref: '' }

/* Which control each missing thing is, so pressing Raise can go to it. `lines`
   maps to the title field because an empty requisition has no line to focus —
   the panel says "Nothing here yet" in that state and the footer is not
   rendered at all, so it is unreachable in practice. */
const FIELD_ID: Record<MissingField, string> = {
  lines: 'req-title', title: 'req-title', reason: 'req-reason',
  cost_centre: 'req-cc', po_ref: 'req-po',
}

export function RequisitionPanel({ onRaised }: {
  /* The console is told afterwards, because the queue the buyer is about to be
     sent to is one of the things that just changed. */
  onRaised: () => void
}) {
  const { basket, open, setOpen, setQuantity, remove, empty, total, count } = useRequisition()
  /* The marketplace's formatter, with the currency table in it. This panel used
     to import `money` from `enterprise.ts`, which has no table and writes
     "INR 400,000.00" — every price on the panel, not only the threshold. */
  const { fmtIn } = useMarket()
  const money = (n: number, c: string) => fmtIn(n, c)
  const [draft, setDraft] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  /* Nothing is marked red until somebody has actually tried. A form that scolds
     you for not yet having filled it in is a form that is wrong on open. */
  const [attempted, setAttempted] = useState(false)
  /* The account's own copy, read when the panel opens rather than passed down.
     The policy, the cost centres and the rate table are all things that can
     have moved since the console loaded, and every one of them changes what
     this panel is allowed to say. */
  const [book, setBook] = useState<AccountBook | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    void loadAccount().then(b => { if (live) setBook(b) })
    return () => { live = false }
  }, [open])

  /* Cleared once it has actually been raised, not on every close — a buyer who
     shuts the panel to go and check a budget should not lose their reasoning. */
  useEffect(() => { if (!basket.lines.length) { setDraft(BLANK); setAttempted(false) } }, [basket.lines.length])

  if (!open) return null

  const account = book?.account ?? null
  const me = book?.me ?? null
  const policy = book?.policy ?? null
  const centres = book?.centres ?? []
  const currencies = book?.currencies ?? []
  const rates = book?.rates ?? []
  const today = new Date().toISOString().slice(0, 10)
  const v = account && policy
    /* The preview names the threshold, and without the currency table it names
       it as "INR 400,000.00" beside a basket priced "₹4,00,000.00". */
    ? verdict(basket, account, policy, rates, today, fmtIn)
    : null
  const missing = account ? missingFields(basket, draft, account)
    : [{ field: 'lines' as MissingField, says: book ? 'your account, which did not load' : 'your account to finish loading' }]
  const stopper = missingNote(missing.map(m => m.says))
  const short = (f: MissingField) => attempted && missing.some(m => m.field === f)

  /* Deliberately not disabled while something is missing.

     It was, and the first thing anybody said about this panel was that the
     requisition could not be raised — from a buyer looking at a greyed-out
     button with the fields it wanted scrolled below the fold and the reason in
     small grey type beside it. A control that refuses without saying so, to
     somebody who cannot see the thing it is refusing over, is indistinguishable
     from one that is broken. It stays live, and pressing it takes you to the
     first thing it needs. */
  const blocked = !!(v?.blocked) || !!(me && !me.can_raise) || !account || !policy

  const raise = async () => {
    if (!account || !me || !policy) return
    if (missing.length) {
      setAttempted(true)
      const first = missing[0].field
      const el = document.getElementById(FIELD_ID[first])
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        ;(el as HTMLElement).focus({ preventScroll: true })
      }
      toast(missingNote(missing.map(m => m.says)) ?? 'Something is missing', 'error')
      return
    }
    setBusy(true)
    const res = await raiseRequisition({
      draft: {
        title: draft.title, reason: draft.reason, currency: basket.currency,
        vertical: verticalOf(basket.lines), cost_centre: draft.cost_centre,
        model: modelOf(basket.lines), po_ref: draft.po_ref,
        lines: basket.lines.map(l => ({
          product_id: l.product_id, name: l.name, seller: l.seller,
          partner_id: l.partner_id, quantity: l.quantity, unit_price: l.unit_price,
        })),
      },
      me, account, policy, currencies, rates,
    })
    setBusy(false)
    if (!res.ok) { toast(res.reason, 'error'); return }
    toast(res.note ?? 'Raised', 'success')
    empty()
    setDraft(BLANK)
    setOpen(false)
    onRaised()
  }

  const field = {
    width: '100%', padding: '8px 10px', borderRadius: 'var(--radius)',
    border: '1px solid var(--border)', fontSize: 'var(--text-sm)',
    outline: 'none', color: 'var(--text)', background: 'white',
  } as const
  /* Only after a press. Red on open would be the form telling somebody off for
     not having filled in a form they have just been shown. */
  const wanting = { ...field, border: '1px solid var(--danger)', background: 'var(--danger-bg, #fff5f5)' } as const
  const label = {
    display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600,
    color: 'var(--text-secondary)', marginBottom: '4px',
  } as const

  return (
    <div
      onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Requisition"
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)', background: 'var(--bg-alt)', height: '100%',
          display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)',
        }}
      >
        <header style={{ padding: '16px 20px', background: 'white', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong style={{ fontSize: 'var(--text-base)' }}>Requisition</strong>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {count === 0 ? 'Nothing in it yet'
                : `${count} ${count === 1 ? 'unit' : 'units'} across ${basket.lines.length} ${basket.lines.length === 1 ? 'line' : 'lines'}`}
            </div>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
            <X size={20} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {basket.lines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              <p>Nothing here yet.</p>
              <p style={{ marginTop: '8px' }}>Add from the catalogue and it collects here until you raise it.</p>
            </div>
          ) : (
            <>
              {/* What is in it */}
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                {basket.lines.map((l, i) => (
                  <div key={l.product_id} style={{ display: 'flex', gap: '12px', padding: '12px', borderTop: i ? '1px solid var(--border-light)' : 'none', alignItems: 'center' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg-alt)', flexShrink: 0 }}>
                      <img src={getProductImage(l.product_id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{l.name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {l.seller} · {money(l.unit_price, basket.currency)}{l.model === 'monthly' ? `${l.unit ? ` ${l.unit}` : ''}/mo` : ' each'}
                      </div>
                    </div>
                    <input
                      type="number" min={0} value={l.quantity} aria-label={`Quantity of ${l.name}`}
                      onChange={e => {
                        const n = Number(e.target.value)
                        if (!Number.isInteger(n)) return
                        const r = setQuantity(l.product_id, n)
                        if (!r.ok) toast(r.reason, 'error')
                      }}
                      style={{ ...field, width: '72px', textAlign: 'right' }}
                    />
                    <div style={{ width: 96, textAlign: 'right', fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                      {money(round2(l.quantity * l.unit_price), basket.currency)}
                    </div>
                    <button onClick={() => remove(l.product_id)} aria-label={`Remove ${l.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <div style={{ padding: '12px', borderTop: '1px solid var(--border)', background: 'var(--bg-alt)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    Total{modelOf(basket.lines) === 'monthly' ? ' per month' : ''}
                  </span>
                  <strong style={{ fontSize: 'var(--text-lg)' }}>{money(total, basket.currency)}</strong>
                </div>
              </div>

              {/* What it will require, before anything is typed */}
              {v?.blocked ? (
                <Callout kind="warning" icon={<AlertTriangle size={16} />}>{v.blocked}</Callout>
              ) : v?.note ? (
                <Callout kind={v.need === 'none' ? 'ok' : 'info'} icon={v.need === 'none' ? <Check size={16} /> : <AlertTriangle size={16} />}>
                  {v.note}
                </Callout>
              ) : null}

              {/* Said out loud because `verticalOf` made a choice with a
                  consequence: one firewall among ninety sensors files the whole
                  requisition under security, and that is what puts IT on it. */}
              {v && new Set(basket.lines.map(l => l.vertical)).size > 1 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  Filed under {VERTICAL_NAMES[v.vertical] ?? v.vertical}
                  {v.vertical === 'security' ? ', because it contains a security purchase — that is what asks for IT sign-off.' : ', which is where most of its value sits.'}
                </div>
              )}

              {/* What an approver needs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={label} htmlFor="req-title">What is it for</label>
                  <input id="req-title" style={short('title') ? wanting : field} value={draft.title} placeholder="Cold-chain rollout, depot 4"
                    aria-invalid={short('title')}
                    onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
                </div>
                <div>
                  <label style={label} htmlFor="req-reason">Why it is needed</label>
                  <textarea id="req-reason" style={{ ...(short('reason') ? wanting : field), minHeight: '70px', resize: 'vertical' }} value={draft.reason}
                    placeholder="An approver deciding without this is guessing."
                    aria-invalid={short('reason')}
                    onChange={e => setDraft(d => ({ ...d, reason: e.target.value }))} />
                </div>
                <div>
                  <label style={label} htmlFor="req-cc">Cost centre</label>
                  <select id="req-cc" style={short('cost_centre') ? wanting : field} value={draft.cost_centre ?? ''}
                    aria-invalid={short('cost_centre')}
                    onChange={e => setDraft(d => ({ ...d, cost_centre: e.target.value || null }))}>
                    <option value="">Pick one</option>
                    {centres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {account?.po_required && (
                  <div>
                    <label style={label} htmlFor="req-po">Purchase order</label>
                    <input id="req-po" style={short('po_ref') ? wanting : field} value={draft.po_ref} placeholder="PO-8891"
                      aria-invalid={short('po_ref')}
                      onChange={e => setDraft(d => ({ ...d, po_ref: e.target.value }))} />
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                      This account requires one on every invoice.
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {basket.lines.length > 0 && (
          <footer style={{ padding: '14px 20px', background: 'white', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* The reason the button is off, rather than a button that is off
                and says nothing. */}
            {me && !me.can_raise ? (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
                Your role on this account cannot raise a requisition. Ask a colleague who can, or an administrator to move you to a role that raises.
              </div>
            ) : stopper && (
              <div style={{ fontSize: 'var(--text-xs)', color: attempted ? 'var(--danger)' : 'var(--text-tertiary)', fontWeight: attempted ? 600 : 400 }}>
                {stopper}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
              <Btn variant="secondary" size="sm" onClick={() => { empty(); toast('Emptied', 'info') }}>Empty it</Btn>
              <Btn variant="primary" onClick={raise} disabled={blocked || busy}>
                {/* Never "Raise and order": raising writes a pending
                    requisition and nothing else. Confirming it on Approvals is
                    what places the order, even when nobody else has to sign. */}
                {busy ? 'Raising…'
                  : v?.need === 'none' ? `Raise — ${money(total, basket.currency)}`
                  : `Raise for approval — ${money(total, basket.currency)}`}
              </Btn>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}

function Callout({ kind, icon, children }: { kind: 'ok' | 'info' | 'warning'; icon: React.ReactNode; children: React.ReactNode }) {
  const tone = kind === 'ok' ? { bg: 'var(--success-bg)', fg: 'var(--success)' }
    : kind === 'warning' ? { bg: 'var(--warning-bg)', fg: 'var(--warning)' }
    : { bg: 'var(--info-bg)', fg: 'var(--info)' }
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 'var(--radius-md)', background: tone.bg,
      border: `1px solid ${tone.fg}`, color: tone.fg, fontSize: 'var(--text-sm)',
      display: 'flex', gap: '8px', alignItems: 'flex-start',
    }}>
      <span style={{ flexShrink: 0, marginTop: '2px' }}>{icon}</span>
      <span>{children}</span>
    </div>
  )
}
