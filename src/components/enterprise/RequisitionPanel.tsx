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
import { useState, useEffect, useRef } from 'react'
import { X, Trash2, TriangleAlert as AlertTriangle, Check } from 'lucide-react'
import { Btn, toast } from '../operator/shared'
import { useRequisition } from '../../lib/RequisitionContext'
import { verdict, missingFields, missingNote, verticalOf, modelOf, isOffContract, contractChanges, applyContractChanges } from '../../lib/requisitionBasket'
import type { MissingField, BasketLine, Basket, ContractChange } from '../../lib/requisitionBasket'
import { DEFAULT_RULES, showsOffContract, offContractReasonProblem } from '../../lib/accountPrices'
import type { OffContractRule, AccountPrice, BuyingRules } from '../../lib/accountPrices'
import { loadAccountPrices, loadBuyingRules } from '../../lib/priceBookRepo'
import { loadPriceBookResult } from '../../lib/moneyRepo'
import { OffContractMarker } from '../pricebooks/PriceTag'
import { raiseRequisition, loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import { useMarket } from '../../lib/MarketContext'
import { useFocusTrap, isTopmostTrap } from '../ui/useFocusTrap'
import { VERTICAL_NAMES } from './data'
import { getProductImage } from '../../lib/images'
import { round2 } from '../../lib/money'
import { RaiseQuoteDialog } from '../enquiries/RaiseQuoteDialog'
import { enquiriesChanged } from '../enquiries/events'
import { groupBySelection } from '../../lib/bundles'
import { BUNDLE_FALLBACK_NAME, requisitionBundleBlock } from '../../lib/bundleLines'
import { BundleGroup } from '../bundles/BundleGroup'
import { requisitionSink } from '../bundles/sinks'

const BLANK = { title: '', reason: '', cost_centre: null as string | null, po_ref: '' }

/* Which control each missing thing is, so pressing Raise can go to it. `lines`
   maps to the title field because an empty requisition has no line to focus —
   the panel says "Nothing here yet" in that state and the footer is not
   rendered at all, so it is unreachable in practice. */
const FIELD_ID: Record<Exclude<MissingField, 'off_contract_reason'>, string> = {
  lines: 'req-title', title: 'req-title', reason: 'req-reason',
  cost_centre: 'req-cc', po_ref: 'req-po',
}

/* One reason field per line off the price book, so each has its own id. Built
   from the product id (a basket holds one ordinary line per product) with
   anything an id would not like replaced. */
export const offReasonId = (product_id: string) => `req-offreason-${product_id.replace(/[^A-Za-z0-9_-]/g, '_')}`
/* The line itself, for when Raise stops on a line whose price moved and there is no field to go to. */
export const lineId = (product_id: string) => `req-line-${product_id.replace(/[^A-Za-z0-9_-]/g, '_')}`

/* The sentence Raise answers with when a line's price or standing moved while the drawer was open. */
export const PRICES_MOVED = 'Your account\'s prices changed since these lines were added. Check the changed lines and raise again.'

/**
 * Today's prices and rules, read again as Raise is pressed, and what they change.
 *
 * Null when any read fails: the caller then raises as it always did, on the
 * figures the drawer already holds, and the database's price guard still
 * refuses a line whose price has moved, in its own words.
 */
async function recheck(account_id: string, basket: Basket, today: string):
  Promise<{ prices: AccountPrice[]; rules: BuyingRules; changes: ContractChange[] } | null> {
  try {
    const [ap, br, pb] = await Promise.all([
      loadAccountPrices(account_id), loadBuyingRules(account_id), loadPriceBookResult(basket.currency),
    ])
    if (!ap.ok || !br.ok || !pb.ok) {
      console.warn(`Today's prices could not be re-read before raising, so the requisition goes on the figures shown (${
        [ap, br, pb].map(r => (r.ok ? '' : r.error)).filter(Boolean).join('; ')}).`)
      return null
    }
    const rules = br.value.account_id ? br.value : { ...br.value, account_id }
    return { prices: ap.value, rules, changes: contractChanges(basket, { prices: ap.value, published: pb.value }, account_id, today) }
  } catch (e) {
    console.warn(`Today's prices could not be re-read before raising (${e instanceof Error ? e.message : 'the request failed'}).`)
    return null
  }
}

export function RequisitionPanel({ onRaised, onQuoteRequested }: {
  /* The console is told afterwards, because the queue the buyer is about to be
     sent to is one of the things that just changed. */
  onRaised: () => void
  /* After "Request a quote for this basket" is sent: the console goes to Enquiries. */
  onQuoteRequested?: () => void
}) {
  const [quoting, setQuoting] = useState(false)
  const { basket, open, setOpen, setQuantity, remove, setReason, removeBundle, empty, total, count, applyChanges } = useRequisition()
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
  useEffect(() => { if (!basket.lines.length) { setDraft(BLANK); setAttempted(false); setMoved([]) } }, [basket.lines.length])

  /* The lines Raise last stopped on because today's prices moved them, as they were and are. */
  const [moved, setMoved] = useState<ContractChange[]>([])
  /* Where focus goes once the drawer has re-rendered with the changed lines (a reason field may only appear then). */
  const focusNext = useRef<string | null>(null)
  useEffect(() => {
    const id = focusNext.current
    if (!id) return
    const el = document.getElementById(id)
    if (!el) return
    focusNext.current = null
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.focus({ preventScroll: true })
  })

  /* Escape closes it, and focus goes back to whatever opened it. The panel is a
     modal dialog, so leaving focus on a control that has just been unmounted
     would drop a keyboard user at the top of the page. */
  const drawer = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    /* Taken before the drawer moves focus. A click that did not focus its
       button (Safari, a programmatic click) leaves <body> active, so fall back
       to the header control, which marks itself as the opener. */
    const active = document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body
      ? active
      : document.querySelector<HTMLElement>('[data-requisition-opener]')
    drawer.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isTopmostTrap(drawer.current)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); opener?.focus() }
  }, [open, setOpen])
  /* Tab stays inside the drawer while it is open. Called after the effect above
     on purpose: effects run in order, so the opener is recorded before the trap
     moves focus into the drawer, and on close this effect's cleanup hands focus
     back before the trap's runs. */
  useFocusTrap(drawer, open)

  if (!open) return null

  const account = book?.account ?? null
  const me = book?.me ?? null
  const policy = book?.policy ?? null
  const centres = book?.centres ?? []
  const currencies = book?.currencies ?? []
  const rates = book?.rates ?? []
  const today = new Date().toISOString().slice(0, 10)
  /* The account's own prices and buying rules. Before price books exist on the
     database these come back empty and 'allow', and the panel is as it was. */
  const prices = book?.prices ?? []
  const rules = book?.rules ?? DEFAULT_RULES(account?.id ?? '')
  const rule = rules.off_contract
  /* Decision 20: an account with no price in force and rule 'allow' would see
     every line flagged, so the marker is hidden then. */
  const shows = showsOffContract(rules, prices, today)
  const offLine = (l: BasketLine) => shows && isOffContract(l)
  const v = account && policy
    /* The preview names the threshold, and without the currency table it names
       it as "INR 400,000.00" beside a basket priced "₹4,00,000.00". */
    ? verdict(basket, account, policy, rates, today, fmtIn, { rule })
    : null
  const missing = account ? missingFields(basket, draft, account, { rule, shows })
    : [{ field: 'lines' as MissingField, says: book ? 'your account, which did not load' : 'your account to finish loading' }]
  /* Where pressing Raise takes somebody: for a missing reason, the first line
     whose reason the database would refuse. */
  const fieldId = (f: MissingField, lines: readonly BasketLine[] = basket.lines, showing = shows): string => {
    if (f !== 'off_contract_reason') return FIELD_ID[f]
    const first = lines.find(l => showing && isOffContract(l) && offContractReasonProblem(l.off_contract_reason) !== null)
    return first ? offReasonId(first.product_id) : 'req-title'
  }
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
  /* A configured bundle holds its price for seven days; after that it has to
     be priced again before it can be raised. The database decides the rest
     (parts still on sale) when the requisition is written. */
  const now = new Date().toISOString()
  const bundleBlockOf = (id: string) => {
    const mine = basket.lines.filter(l => l.bundle_selection_id === id)
    return requisitionBundleBlock(mine[0]?.bundle, mine, basket.currency, now)
  }
  const stuckBundle = [...new Set(basket.lines.map(l => l.bundle_selection_id).filter((x): x is string => !!x))]
    .map(bundleBlockOf).find(b => b.kind !== 'ok')
  const blocked = !!(v?.blocked) || !!(me && !me.can_raise) || !account || !policy || !!stuckBundle

  const raise = async () => {
    if (!account || !me || !policy) return
    if (missing.length) {
      setAttempted(true)
      const first = missing[0].field
      const el = document.getElementById(fieldId(first))
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        ;(el as HTMLElement).focus({ preventScroll: true })
      }
      toast(missingNote(missing.map(m => m.says)) ?? 'Something is missing', 'error')
      return
    }
    setBusy(true)
    /* Today's prices and rules, read again: a price can start, end or be
       withdrawn while the drawer is open, and the database would refuse a line
       priced the old way. A failed read raises on what is shown, as before. */
    let lines = basket.lines
    let rulesNow: BuyingRules = rules
    let pricesNow: readonly AccountPrice[] = prices
    const fresh = await recheck(account.id, basket, today)
    if (fresh) {
      rulesNow = fresh.rules
      pricesNow = fresh.prices
      setBook(b => (b ? { ...b, prices: fresh.prices, rules: fresh.rules } : b))
      const showsNow = showsOffContract(fresh.rules, fresh.prices, today)
      if (fresh.changes.length) applyChanges(fresh.changes)
      lines = applyContractChanges(basket, fresh.changes).lines
      /* A standing that moved behind a hidden marker (decision 20) changes
         nothing the buyer sees or the database refuses, so it is taken quietly. */
      const stopOn = fresh.changes.filter(c =>
        c.was.unit_price !== c.now.unit_price || (showsNow && c.was.on_contract !== c.now.on_contract))
      if (stopOn.length) {
        setMoved(stopOn)
        setBusy(false)
        const first = stopOn[0]
        const asks = fresh.rules.off_contract === 'reason' && showsNow && !first.now.on_contract
        focusNext.current = asks ? offReasonId(first.product_id) : lineId(first.product_id)
        toast(PRICES_MOVED, 'error')
        return
      }
      setMoved([])
      /* The rules may have moved too: a reason may now be asked for. */
      const again = missingFields({ ...basket, lines }, draft, account, { rule: fresh.rules.off_contract, shows: showsNow })
      if (again.length) {
        setBusy(false)
        setAttempted(true)
        focusNext.current = fieldId(again[0].field, lines, showsNow)
        toast(missingNote(again.map(m => m.says)) ?? 'Something is missing', 'error')
        return
      }
    }
    const ruleNow = rulesNow.off_contract
    const showsNow = showsOffContract(rulesNow, pricesNow, today)
    const res = await raiseRequisition({
      draft: {
        title: draft.title, reason: draft.reason, currency: basket.currency,
        vertical: verticalOf(lines), cost_centre: draft.cost_centre,
        model: modelOf(lines), po_ref: draft.po_ref,
        lines: lines.map(l => ({
          product_id: l.product_id, name: l.name, seller: l.seller,
          partner_id: l.partner_id, quantity: l.quantity, unit_price: l.unit_price,
          quote_line_id: l.quote_line_id ?? null,
          bundle_selection_id: l.bundle_selection_id ?? null,
          /* Only where the rules ask for one, on a line off the price book.
             A database without price books has no column to take it. */
          ...(ruleNow === 'reason' && showsNow && isOffContract(l) && l.off_contract_reason?.trim()
            ? { off_contract_reason: l.off_contract_reason.trim() } : {}),
        })),
      },
      me, account, policy, currencies, rates, prices: pricesNow, rules: rulesNow,
    })
    setBusy(false)
    if (!res.ok) { toast(res.reason, 'error'); return }
    setMoved([])
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

  /* Lines already at a quoted price are not asked about again. */
  const toQuote = basket.lines.filter(l => !l.quote_line_id && !l.bundle_selection_id)
    .map(l => ({ product_id: l.product_id, name: l.name, quantity: l.quantity }))

  return (
    <>
    <div
      onClick={() => setOpen(false)}
      className="req-drawer-backdrop"
    >
      <div
        ref={drawer} tabIndex={-1}
        role="dialog" aria-modal="true" aria-label="Requisition"
        onClick={e => e.stopPropagation()}
        className="req-drawer"
      >
        <header className="req-drawer__head">
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

        <div className="req-drawer__body">
          {basket.lines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              <p>Nothing here yet.</p>
              <p style={{ marginTop: '8px' }}>Add from the catalogue and it collects here until you raise it.</p>
            </div>
          ) : (
            <>
              {/* What is in it */}
              <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                {groupBySelection(basket.lines).map((g, gi) => g.selectionId ? (() => {
                  const meta = g.lines[0].bundle
                  return (
                    <div key={g.selectionId} style={{ padding: '12px', borderTop: gi ? '1px solid var(--border-light)' : 'none' }}>
                      <BundleGroup
                        name={meta?.name ?? BUNDLE_FALLBACK_NAME}
                        parts={g.lines.map(l => ({ key: l.product_id, name: l.name, seller: l.seller, quantity: l.quantity, lineTotal: round2(l.quantity * l.unit_price) }))}
                        total={round2(g.lines.reduce((n, l) => n + round2(l.quantity * l.unit_price), 0))}
                        fmt={n => money(n, basket.currency)}
                        block={bundleBlockOf(g.selectionId!)}
                        editable={meta ? {
                          selectionId: g.selectionId!, templateId: meta.templateId, choices: meta.choices,
                          quantity: meta.quantity, currency: meta.currency,
                        } : null}
                        sink={requisitionSink}
                        onRemove={() => removeBundle(g.selectionId!)}
                      />
                    </div>
                  )
                })() : g.lines.map((l) => (
                  <div key={l.product_id} id={lineId(l.product_id)} tabIndex={-1}
                    aria-describedby={moved.some(c => c.product_id === l.product_id) ? `${lineId(l.product_id)}-moved` : undefined}
                    style={{ padding: '12px', borderTop: gi ? '1px solid var(--border-light)' : 'none' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg-alt)', flexShrink: 0 }}>
                      <img src={getProductImage(l.product_id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{l.name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {l.seller} · {money(l.unit_price, basket.currency)}{l.model === 'monthly' ? `${l.unit ? ` ${l.unit}` : ''}/mo` : ' each'}
                      </div>
                    </div>
                    {/* A quoted line holds the quoted quantity; it can be removed, not changed. */}
                    {l.quote_line_id ? (
                      <div style={{ width: '72px', textAlign: 'right', fontSize: 'var(--text-sm)' }}>
                        <div>{l.quantity}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600 }}>Quoted</div>
                      </div>
                    ) : (
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
                    )}
                    <div style={{ width: 96, textAlign: 'right', fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                      {money(round2(l.quantity * l.unit_price), basket.currency)}
                    </div>
                    <button onClick={() => remove(l.product_id)} aria-label={`Remove ${l.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {(() => {
                    const c = moved.find(m => m.product_id === l.product_id)
                    return c ? <MovedNote id={`${lineId(l.product_id)}-moved`} change={c} shows={shows}
                      fmt={n => money(n, basket.currency)} /> : null
                  })()}
                  {offLine(l) && (
                    <OffContractLine line={l} rule={rule} attempted={attempted} field={field} wanting={wanting} label={label}
                      onReason={reason => {
                        const r = setReason(l.product_id, reason)
                        if (!r.ok) toast(r.reason, 'error')
                      }} />
                  )}
                  </div>
                )))}
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
          <footer className="req-drawer__foot">
            {/* The reason the button is off, rather than a button that is off
                and says nothing. */}
            {me && !me.can_raise ? (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
                Your role on this account cannot raise a requisition. Ask a colleague who can, or an administrator to move you to a role that raises.
              </div>
            ) : moved.length > 0 ? (
              <div role="status" style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', fontWeight: 600 }}>
                {PRICES_MOVED}
              </div>
            ) : stuckBundle ? (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', fontWeight: 600 }}>
                {stuckBundle.says}
              </div>
            ) : stopper && (
              <div style={{ fontSize: 'var(--text-xs)', color: attempted ? 'var(--danger)' : 'var(--text-tertiary)', fontWeight: attempted ? 600 : 400 }}>
                {stopper}
              </div>
            )}
            {/* Asking the seller to price the basket first. The basket stays as it is. */}
            {/* Not offered to a member who cannot raise: raise_quote refuses them. */}
            {toQuote.length > 0 && !(me && !me.can_raise) && (
              <>
                <Btn variant="secondary" onClick={() => setQuoting(true)} style={{ minHeight: '44px' }}>
                  Request a quote for this basket
                </Btn>
                {/* A quote is in the account's currency, and its lines can only
                    join a requisition in that currency. */}
                {account && basket.currency && basket.currency !== account.currency && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    A quote comes back in {account.currency}, your account&rsquo;s currency, not the {basket.currency} this
                    requisition is priced in. Once accepted, its lines go into a requisition in {account.currency}, so
                    this one would have to be raised or emptied first.
                  </div>
                )}
              </>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
              <Btn variant="secondary" size="sm" onClick={() => { empty(); toast('Emptied', 'info') }}>Empty it</Btn>
              <button className="btn btn-cyan" onClick={raise} disabled={blocked || busy}>
                {/* Never "Raise and order": raising writes a pending
                    requisition and nothing else. Confirming it on Approvals is
                    what places the order, even when nobody else has to sign. */}
                {busy ? 'Raising…'
                  : v?.need === 'none' ? `Raise — ${money(total, basket.currency)}`
                  : `Raise for approval — ${money(total, basket.currency)}`}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
    {/* A sibling of the drawer, not inside it: a click on its backdrop must
        not reach the drawer's, which would close the drawer as well. */}
    <RaiseQuoteDialog open={quoting} seed={toQuote} currency={account?.currency} shownIn={basket.currency || null} onClose={() => setQuoting(false)}
      onRaised={() => {
        setQuoting(false)
        toast('Quote request sent. Your requisition is unchanged.', 'success')
        enquiriesChanged()
        setOpen(false)
        onQuoteRequested?.()
      }} />
    </>
  )
}

/* Under a line bought off the account's price book: the marker, and what the
   buying rules ask of it. Under 'reason' a field the database will check
   (guard_requisition_line_contract: 5 to 300 characters, trimmed); under
   'approval' the sentence saying where it goes; under 'allow' the marker only. */
function OffContractLine({ line, rule, attempted, field, wanting, label, onReason }: {
  line: Pick<BasketLine, 'product_id' | 'name' | 'off_contract_reason'>
  rule: OffContractRule
  attempted: boolean
  field: React.CSSProperties; wanting: React.CSSProperties; label: React.CSSProperties
  onReason: (reason: string) => void
}) {
  const id = offReasonId(line.product_id)
  const problem = rule === 'reason' ? offContractReasonProblem(line.off_contract_reason, line.name) : null
  const showProblem = attempted && !!problem
  return (
    <div style={{ marginTop: '8px', paddingLeft: '60px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <OffContractMarker />
      {rule === 'approval' && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Goes to a finance approver because it is off your price book
        </div>
      )}
      {rule === 'reason' && (
        <div>
          <label style={label} htmlFor={id}>Why buy {line.name} off your price book</label>
          <textarea id={id} rows={2} maxLength={300}
            value={line.off_contract_reason ?? ''}
            aria-invalid={showProblem}
            aria-describedby={`${id}-hint${showProblem ? ` ${id}-error` : ''}`}
            onChange={e => onReason(e.target.value)}
            style={{ ...(showProblem ? wanting : field), minHeight: '44px', resize: 'vertical' }} />
          <div id={`${id}-hint`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            Your buying rules ask for a reason, 5 to 300 characters. The approver reads it.
          </div>
          {showProblem && (
            <div id={`${id}-error`} style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', fontWeight: 600, marginTop: '4px' }}>
              {problem}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* Under a line Raise stopped on: what moved, in the requisition's money. */
function MovedNote({ id, change, shows, fmt }: { id: string; change: ContractChange; shows: boolean; fmt: (n: number) => string }) {
  const priced = change.was.unit_price !== change.now.unit_price
  const standing = change.was.on_contract !== change.now.on_contract
  const parts: string[] = []
  if (priced) parts.push(`Price now ${fmt(change.now.unit_price)} (was ${fmt(change.was.unit_price)})`)
  if (standing && change.now.on_contract) parts.push('now on your price book')
  else if (standing && shows) parts.push('now off your price book')
  const text = parts.join(', ')
  return (
    <div id={id} style={{ marginTop: '8px', paddingLeft: '60px', fontSize: 'var(--text-xs)', color: 'var(--danger)', fontWeight: 600 }}>
      {text.charAt(0).toUpperCase() + text.slice(1)}
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
