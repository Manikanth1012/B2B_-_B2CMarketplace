import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useMarket } from '../../lib/MarketContext'
import { getProductImage } from '../../lib/images'
import { defaultChoices, validateChoices, type Choices } from '../../lib/bundles'
import { configureBundle, type Selection, type SelectionLine } from '../../lib/bundleRepo'
import { raiseQuote } from '../../lib/enquiryRepo'
import { round2 } from '../../lib/money'
import { Dialog } from '../ui/Dialog'
import { toast } from '../operator/shared'
import { enquiriesChanged } from '../enquiries/events'
import { onOpenBundle, bundlesChanged, type OpenBundleDetail } from './events'
import { sendBundleTo } from './handoff'
import { useBundleShelf } from './useBundleShelf'
import {
  slotsOf, optionsOf, partsFor, estimate, unavailable, slotHint, togglePick, clearSlot, setPickQty,
  totalsDiffer, BUNDLE_QTY_MAX,
} from './shelf'

type Phase =
  | { kind: 'choose' }
  | { kind: 'working'; what: 'add' | 'quote' }
  | { kind: 'confirm'; selection: Selection; lines: SelectionLine[]; shown: number }
  | { kind: 'quoted'; id: string }

/**
 * The bundle configurator, mounted once per shell and opened by
 * openBundleConfigurator (a bundle card, or Edit bundle on a basket or
 * requisition line).
 *
 * Laid out as the product page is: the parts to choose on the left, the price
 * panel on the right. The panel's figure is an estimate from the price book
 * (priceBundle); the charged price is the database's (configure_bundle), shown
 * for confirmation whenever the two differ.
 */
export function BundleConfiguratorHost({ shop, signedIn = true, onSignIn, onOpenEnquiries }: {
  shop: 'consumer' | 'enterprise'
  signedIn?: boolean
  onSignIn?: () => void
  onOpenEnquiries?: () => void
}) {
  const [detail, setDetail] = useState<OpenBundleDetail | null>(null)
  /* A fresh key per opening, so the configurator starts from the detail it was
     opened with rather than whatever the previous bundle left behind. */
  const [opening, setOpening] = useState(0)
  useEffect(() => onOpenBundle(d => { setDetail(d); setOpening(n => n + 1) }), [])
  if (!detail) return null
  return (
    <BundleConfigurator key={opening} shop={shop} detail={detail} signedIn={signedIn}
      onSignIn={onSignIn} onOpenEnquiries={onOpenEnquiries} onClose={() => setDetail(null)} />
  )
}

function BundleConfigurator({ shop, detail, signedIn, onSignIn, onOpenEnquiries, onClose }: {
  shop: 'consumer' | 'enterprise'
  detail: OpenBundleDetail
  signedIn: boolean
  onSignIn?: () => void
  onOpenEnquiries?: () => void
  onClose: () => void
}) {
  const { currency: chosen, market, fmtIn } = useMarket()
  const currency = chosen?.code ?? market?.currency ?? 'USD'
  const money = (n: number) => fmtIn(n, currency)
  const { shelf, loading, loadError } = useBundleShelf(currency)

  const template = shelf.templates.find(t => t.id === detail.templateId) ?? null
  const slots = useMemo(() => slotsOf(shelf, detail.templateId), [shelf, detail.templateId])
  const options = useMemo(() => optionsOf(shelf, slots.map(s => s.id)), [shelf, slots])

  const [choices, setChoices] = useState<Choices | null>(detail.choices ?? null)
  const [qty, setQty] = useState(Math.min(BUNDLE_QTY_MAX, Math.max(1, detail.quantity ?? 1)))
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' })
  const [error, setError] = useState<string | null>(null)

  /* The template's defaults once its slots have loaded. */
  useEffect(() => {
    if (choices === null && slots.length > 0) setChoices(defaultChoices(slots, options))
  }, [choices, slots, options])

  const picks = choices ?? {}
  const problems = choices ? validateChoices(slots, options, picks) : {}
  const unpicked = Object.values(picks).flat()
    .map(p => ({ p, why: unavailable(shelf.parts.get(p.product_id), currency) }))
    .find(x => x.why !== null)
  const priced = template ? estimate(partsFor(slots, picks, shelf.parts), template.discount_pct, qty) : null
  const canAct = !!template && template.status === 'live' && !!choices
    && Object.keys(problems).length === 0 && !unpicked && !!priced && phase.kind === 'choose'

  const nameOf = (id: string) => shelf.parts.get(id)?.name ?? id
  const kind = shop === 'consumer' ? 'basket' as const : 'requisition' as const
  const actionLabel = shop === 'consumer' ? 'Add bundle to basket' : 'Add bundle to requisition'

  const handOn = async (selection: Selection) => {
    setPhase({ kind: 'working', what: 'add' })
    const sent = await sendBundleTo(kind, selection.id, detail.replaceSelectionId)
    if (!sent.ok) { setError(sent.error); setPhase({ kind: 'choose' }); return }
    bundlesChanged()
    toast(`${template?.name ?? 'The bundle'} ${detail.replaceSelectionId ? 'updated in' : 'added to'} your ${kind}.`, 'success')
    onClose()
  }

  const add = async () => {
    if (!template || !choices || !priced) return
    setError(null)
    setPhase({ kind: 'working', what: 'add' })
    const res = await configureBundle(template.id, choices, currency, qty)
    if (!res.ok) { setError(res.error); setPhase({ kind: 'choose' }); return }
    if (totalsDiffer(priced.total, res.value.selection.total)) {
      setPhase({ kind: 'confirm', selection: res.value.selection, lines: res.value.lines, shown: priced.total })
      return
    }
    await handOn(res.value.selection)
  }

  const quote = async () => {
    if (!template || !priced) return
    setError(null)
    setPhase({ kind: 'working', what: 'quote' })
    const res = await raiseQuote({
      subject: template.name.slice(0, 120),
      lines: priced.lines.map(l => ({ product_id: l.product_id, quantity: l.quantity, target_unit_price: l.unit_price })),
      note: `Configured as the bundle "${template.name}" (${qty} × bundle), shown at ${money(priced.total)} in total.`,
    })
    if (!res.ok) { setError(res.error); setPhase({ kind: 'choose' }); return }
    enquiriesChanged()
    setPhase({ kind: 'quoted', id: res.id })
  }

  const busy = phase.kind === 'working'
  const title = template?.name ?? 'Bundle'

  /* --------------------------------------------------------------- body -- */
  let body: JSX.Element
  if (loading && !template) {
    body = <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  } else if (!template || slots.length === 0) {
    body = (
      <p className="bcfg__calm">
        This bundle cannot be configured right now{loadError ? ' — bundles did not load' : ''}. Please try again later.
      </p>
    )
  } else if (phase.kind === 'quoted') {
    body = (
      <div className="bcfg__done" role="status">
        <p><strong>Your quote request for {template.name} has been sent.</strong></p>
        <p>The sellers' answer will arrive in Enquiries, where you can follow it and accept the quote.</p>
        <div className="bcfg__row">
          {onOpenEnquiries && (
            <button type="button" className="btn btn-primary bcfg__btn" onClick={() => { onClose(); onOpenEnquiries() }}>Open Enquiries</button>
          )}
          <button type="button" className="btn btn-secondary bcfg__btn" onClick={onClose}>Close</button>
        </div>
      </div>
    )
  } else if (phase.kind === 'confirm') {
    body = (
      <div className="bcfg__confirm">
        <p role="alert">
          The price has changed since this page loaded: you were shown <strong>{money(phase.shown)}</strong>,
          and the bundle now costs <strong>{money(phase.selection.total)}</strong>. Here is the price that will be charged.
        </p>
        <Breakdown
          rows={phase.lines.map(l => ({ key: l.id, name: l.name, quantity: l.quantity, total: round2(l.unit_price * l.quantity) }))}
          partsTotal={phase.selection.parts_total} total={phase.selection.total} money={money} />
        <div className="bcfg__row">
          <button type="button" className="btn btn-primary bcfg__btn" onClick={() => void handOn(phase.selection)}>
            {shop === 'consumer' ? 'Add to basket' : 'Add to requisition'} at {money(phase.selection.total)}
          </button>
          <button type="button" className="btn btn-secondary bcfg__btn" onClick={() => setPhase({ kind: 'choose' })}>Back to choosing</button>
        </div>
      </div>
    )
  } else {
    const image = template.image ?? getProductImage(priced?.lines[0]?.product_id ?? template.id)
    body = (
      <div className="pd pd--compact bcfg">
        <div className="pd__gallery">
          <div className="pd__media bcfg__media"><img src={image} alt="" /></div>
          {template.description && <p className="bcfg__desc">{template.description}</p>}
        </div>

        <div className="pd__main">
          {slots.map(s => {
            const slotOptions = options.filter(o => o.slot_id === s.id)
            const mine = picks[s.id] ?? []
            const single = s.max_pick === 1
            const full = !single && mine.length >= s.max_pick
            const problemId = `bcfg-${s.id}-problem`
            return (
              <fieldset key={s.id} className="bcfg__slot" aria-describedby={problems[s.id] ? problemId : undefined}>
                <legend className="bcfg__legend">{s.label} <span className="bcfg__hint">{slotHint(s)}</span></legend>
                {single && s.min_pick === 0 && (
                  <label className="bcfg__opt">
                    <input type="radio" name={`bcfg-${s.id}`} checked={mine.length === 0}
                      onChange={() => setChoices(clearSlot(picks, s.id))} />
                    <span className="bcfg__opt-name">None</span>
                  </label>
                )}
                {slotOptions.map(o => {
                  const part = shelf.parts.get(o.product_id)
                  const why = unavailable(part, currency)
                  const pick = mine.find(p => p.product_id === o.product_id)
                  const on = !!pick
                  return (
                    <div key={o.id} className={`bcfg__opt-wrap${on ? ' is-on' : ''}`}>
                      <label className="bcfg__opt">
                        <input type={single ? 'radio' : 'checkbox'} name={`bcfg-${s.id}`} checked={on}
                          disabled={busy || (!on && (why !== null || full))}
                          onChange={() => setChoices(togglePick(picks, s, o.product_id))} />
                        <span className="bcfg__opt-name">{part?.name ?? o.product_id}</span>
                        <span className="bcfg__opt-meta">
                          {part?.seller}
                          {part?.list != null && <> · {money(part.list)} each</>}
                          {why && <> · <strong>{why}</strong></>}
                        </span>
                      </label>
                      {on && s.qty_min < s.qty_max && (
                        <Stepper label={part?.name ?? o.product_id} value={pick.quantity} min={s.qty_min} max={s.qty_max} disabled={busy}
                          onChange={q => setChoices(setPickQty(picks, s, o.product_id, q))} />
                      )}
                    </div>
                  )
                })}
                {problems[s.id] && <p id={problemId} className="bcfg__problem">{problems[s.id]}</p>}
              </fieldset>
            )
          })}
        </div>

        <aside className="pd__buy bcfg__panel" aria-label="Your bundle">
          <h3 className="bcfg__panel-title">Your bundle</h3>
          <div aria-live="polite">
            {priced ? (
              <Breakdown
                rows={priced.lines.map(l => ({ key: l.product_id, name: nameOf(l.product_id), quantity: l.quantity, total: l.line_total }))}
                partsTotal={priced.parts_total} total={priced.total} money={money} />
            ) : (
              <p className="bcfg__calm">
                {unpicked ? `${nameOf(unpicked.p.product_id)}: ${unpicked.why}. Choose another.` : 'Choose the parts to see the price.'}
              </p>
            )}
          </div>

          <div className="bcfg__qty">
            <span id="bcfg-qty-label">How many bundles</span>
            <Stepper label="bundles" value={qty} min={1} max={BUNDLE_QTY_MAX} disabled={busy} onChange={setQty} labelledBy="bcfg-qty-label" />
          </div>

          {template.status !== 'live' && (
            <p className="bcfg__problem">This bundle is paused, so it cannot be configured again for now.</p>
          )}
          {error && <p className="bcfg__problem" role="alert">{error}</p>}

          {signedIn ? (
            <>
              <button type="button" className="btn btn-primary bcfg__btn" disabled={!canAct} onClick={() => void add()}>
                {phase.kind === 'working' && phase.what === 'add' ? 'Pricing…' : actionLabel}
              </button>
              {shop === 'enterprise' && (
                <button type="button" className="btn btn-secondary bcfg__btn" disabled={!canAct} onClick={() => void quote()}>
                  {phase.kind === 'working' && phase.what === 'quote' ? 'Sending…' : 'Request a quote for this bundle'}
                </button>
              )}
            </>
          ) : (
            <button type="button" className="btn btn-primary bcfg__btn" onClick={() => { onClose(); onSignIn?.() }}>
              Sign in to add this bundle
            </button>
          )}

          <p className="bcfg__note">
            Priced in {currency}. This is an estimate; the price is fixed when you add the bundle and held for 7 days.
            {shop === 'enterprise' && ' Nothing is ordered until the requisition is approved.'}
          </p>
        </aside>
      </div>
    )
  }

  return (
    <Dialog open onClose={onClose} title={title} wide className="bcfg-dialog">
      {body}
    </Dialog>
  )
}

/* The per-part lines, the parts at list, the bundle price and the saving.
   Which parts sit at a seller's minimum is not the buyer's business and is
   not shown. */
function Breakdown({ rows, partsTotal, total, money }: {
  rows: { key: string; name: string; quantity: number; total: number }[]
  partsTotal: number
  total: number
  money: (n: number) => string
}) {
  const saving = round2(partsTotal - total)
  return (
    <div className="bcfg__breakdown">
      <ul className="bcfg__lines">
        {rows.map(r => (
          <li key={r.key}><span>{r.name} × {r.quantity}</span><span>{money(r.total)}</span></li>
        ))}
      </ul>
      {saving > 0 && <div className="bcfg__sum"><span>Bought separately</span><span>{money(partsTotal)}</span></div>}
      <div className="bcfg__sum bcfg__sum--total"><span>Bundle price</span><span className="pd__price">{money(total)}</span></div>
      {saving > 0 && <div className="bcfg__save">You save {money(saving)}</div>}
    </div>
  )
}

function Stepper({ label, value, min, max, disabled, onChange, labelledBy }: {
  label: string; value: number; min: number; max: number; disabled?: boolean
  onChange: (n: number) => void; labelledBy?: string
}) {
  return (
    <div className="bcfg__stepper" role="group" aria-label={labelledBy ? undefined : `Quantity of ${label}`} aria-labelledby={labelledBy}>
      <button type="button" aria-label={`Fewer ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={16} aria-hidden />
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={`More ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={16} aria-hidden />
      </button>
    </div>
  )
}
