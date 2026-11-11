import { useEffect, useId, useState } from 'react'
import { Modal, Btn, FormField, TextInput, TextArea, Select } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { loadProductPrices } from '../../lib/moneyRepo'
import { setAccountPrice, promoteQuoteLine } from '../../lib/priceBookRepo'
import { priceDraftProblems, replacedBy, standingOf } from '../../lib/accountPrices'
import type { AccountPrice, PriceDraft, PriceField, QuoteLineForPromotion } from '../../lib/accountPrices'
import type { BookRow } from '../../lib/marketPricing'
import { day } from '../../lib/enterprise'

/* Setting a price, or turning an accepted quote line into one.
 *
 * Every rule is the database's (guard_account_price, set_account_price); the
 * dialog asks priceDraftProblems for the same sentences first so the operator
 * reads them before pressing anything, and shows the database's own words if
 * it refuses anyway. A price is never edited: setting one ends whatever it
 * would overlap, and the dialog says so — including the case that surprises
 * people, a bounded price inside an open-ended one, which ends the old one for
 * good rather than pausing it. */

export interface SetPriceListing { id: string; name: string; seller: string }

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** What setting `d` does to the prices already on the book, in sentences. Exported for the test. */
export function replacementSentences(
  existing: readonly AccountPrice[], d: PriceDraft, today: string,
  fmt: (n: number, currency: string) => string,
): string[] {
  return replacedBy(existing, d, today).map(r => {
    const old = existing.find(p => p.id === r.id)
    if (!old) return `${r.id} ends on ${day(r.ends_on)}.`
    const what = `${r.id} (${fmt(old.unit_price, old.currency)}, ${standingOf(old, today) === 'scheduled' ? 'due to start' : 'from'} ${day(old.starts_on)})`
    if (r.withdrawn) {
      return `${what} has not started by then, so it will be withdrawn: it never applies.`
    }
    const outlives = d.ends_on !== null && (old.ends_on === null || old.ends_on > d.ends_on)
    const base = `${what} ends on ${day(r.ends_on)}.`
    if (!outlives || d.ends_on === null) return base
    return `${base} It does not come back when the new price ends on ${day(d.ends_on)}: from ${day(addDays(d.ends_on, 1))} this account pays the published price unless another price is set.`
  })
}

export function SetPriceDialog({
  open, onClose, onSaved, account, currencies, listings, prices, today, quote,
}: {
  open: boolean
  onClose: () => void
  onSaved: (id: string) => void
  account: { id: string; company: string; market: string }
  /** The currencies the account's market takes, default first. */
  currencies: readonly string[]
  /** Business listings only. */
  listings: readonly SetPriceListing[]
  /** The account's prices as they stand. */
  prices: readonly AccountPrice[]
  today: string
  /** Promoting a quote line: listing, currency and price come from it and are locked. */
  quote?: QuoteLineForPromotion | null
}) {
  const { fmtIn } = useMarket()
  const fmt = (n: number, c: string) => fmtIn(n, c, { decimals: true })
  const ids = useId()

  const [productId, setProductId] = useState('')
  const [currency, setCurrency] = useState('')
  const [price, setPrice] = useState('')
  const [startsOn, setStartsOn] = useState(today)
  const [endsOn, setEndsOn] = useState('')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState<Partial<Record<PriceField, boolean>>>({})
  const [rows, setRows] = useState<BookRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  /* Fresh on every opening; a quote fills and locks its three fields. */
  useEffect(() => {
    if (!open) return
    setProductId(quote?.product_id ?? '')
    setCurrency(quote?.currency ?? currencies[0] ?? '')
    setPrice(quote?.quoted_unit_price != null ? String(quote.quoted_unit_price) : '')
    setStartsOn(today); setEndsOn(''); setNote('')
    setTouched(quote ? { product_id: true, currency: true, unit_price: true } : {})
    setRefusal(null); setBusy(false)
  }, [open, quote, currencies, today])

  /* Today's published price and floor for the listing, in every currency. */
  useEffect(() => {
    if (!open || !productId) { setRows(null); return }
    let live = true
    setRows(null)
    loadProductPrices(productId).then(r => { if (live) setRows(r) }, () => { if (live) setRows([]) })
    return () => { live = false }
  }, [open, productId])

  const locked = !!quote
  const listing = listings.find(l => l.id === productId)
  const productName = listing?.name ?? quote?.name ?? productId
  const priced = rows?.find(r => r.currency === currency) ?? null
  const unit = price.trim() === '' ? NaN : Number(price)

  const draft: PriceDraft = {
    account_id: account.id, product_id: productId, currency,
    unit_price: Number.isFinite(unit) ? unit : 0,
    starts_on: startsOn, ends_on: endsOn === '' ? null : endsOn, note,
    quote_line_id: quote?.id ?? null,
  }

  const problems: Partial<Record<PriceField, string>> = (() => {
    if (!productId) return {}
    /* Until today's figures arrive, nothing is said about them. */
    const p = priceDraftProblems(draft, {
      today, published: priced ? priced.price : null, floor: priced ? priced.floor_price : null,
      currencies, businessListing: !!listing || locked,
      company: account.company, market: account.market, productName,
    })
    if (rows === null) { delete p.product_id; if (p.unit_price && Number.isFinite(unit) && unit > 0) delete p.unit_price }
    return p
  })()

  const shown = (f: PriceField) => (touched[f] ? problems[f] : undefined)
  const touch = (f: PriceField) => setTouched(t => (t[f] ? t : { ...t, [f]: true }))

  const ready = !!productId && !!currency && rows !== null && Number.isFinite(unit)
    && Object.keys(problems).length === 0
  const replaces = productId && currency && !problems.starts_on && !problems.ends_on
    ? replacementSentences(prices, draft, today, fmt) : []

  async function submit() {
    if (!ready || busy) return
    setBusy(true); setRefusal(null)
    const r = quote
      ? await promoteQuoteLine(quote.id, draft.starts_on, draft.ends_on, draft.note)
      : await setAccountPrice(draft)
    setBusy(false)
    if (!r.ok) { setRefusal(r.error); return }
    onSaved(r.value)
  }

  const err = (f: PriceField) => `${ids}-${f}-err`
  const describe = (f: PriceField, extra?: string) =>
    [shown(f) ? err(f) : undefined, extra].filter(Boolean).join(' ') || undefined
  const errorLine = (f: PriceField) => shown(f)
    ? <div id={err(f)} style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)', marginTop: '4px' }}>{shown(f)}</div>
    : null

  return (
    <Modal open={open} onClose={onClose}
      title={quote ? `Make ${quote.enquiry_id}'s price ${account.company}'s own` : `Set a price for ${account.company}`}
      footer={<>
        <Btn variant="secondary" className="pb-target" onClick={onClose}>Cancel</Btn>
        <Btn className="pb-target" onClick={submit} disabled={!ready || busy}>
          {busy ? 'Setting…' : 'Set the price'}
        </Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {quote && (
          <Callout tone="info" title="From an accepted quote">
            The listing, currency and price are {quote.enquiry_id}'s and cannot change here. The seller's
            floor still applies: a quote under it was one deal, not a standing price.
          </Callout>
        )}

        <FormField label="Listing" required>
          <Select value={productId} disabled={locked} aria-invalid={!!shown('product_id') || undefined}
            aria-describedby={describe('product_id')}
            onChange={e => { setProductId(e.target.value); touch('product_id') }}>
            <option value="">Choose a business listing</option>
            {locked && !listing && <option value={productId}>{productName}</option>}
            {listings.map(l => <option key={l.id} value={l.id}>{l.name} — {l.seller}</option>)}
          </Select>
        </FormField>
        {errorLine('product_id')}

        <FormField label="Currency" required hint={`What ${account.market} trades in. Nothing is converted.`}>
          <Select value={currency} disabled={locked} aria-invalid={!!shown('currency') || undefined}
            aria-describedby={describe('currency')}
            onChange={e => { setCurrency(e.target.value); touch('currency') }}>
            {locked && !currencies.includes(currency) && <option value={currency}>{currency}</option>}
            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </FormField>
        {errorLine('currency')}

        <FormField label={`Account price${currency ? ` (${currency})` : ''}`} required>
          <TextInput inputMode="decimal" value={price} readOnly={locked}
            aria-invalid={!!shown('unit_price') || undefined}
            aria-describedby={describe('unit_price', `${ids}-today`)}
            onChange={e => { setPrice(e.target.value); touch('unit_price') }}
            onBlur={() => touch('unit_price')} />
        </FormField>
        <div id={`${ids}-today`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '-8px' }}>
          {!productId ? 'Choose a listing to see its published price and floor today.'
            : rows === null ? 'Reading today\'s published price and floor…'
            : priced
              ? `Published today ${fmt(priced.price, currency)} · floor ${priced.floor_price === null ? 'none set' : fmt(priced.floor_price, currency)}. An account price sits between them.`
              : `No published price in ${currency} today.`}
        </div>
        {errorLine('unit_price')}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div>
            <FormField label="Starts on" required>
              <TextInput type="date" value={startsOn} min={today} aria-invalid={!!shown('starts_on') || undefined}
                aria-describedby={describe('starts_on')}
                onChange={e => { setStartsOn(e.target.value); touch('starts_on') }} />
            </FormField>
            {errorLine('starts_on')}
          </div>
          <div>
            <FormField label="Ends on" hint="Leave empty for no end. The last day it applies.">
              <TextInput type="date" value={endsOn} min={startsOn} aria-invalid={!!shown('ends_on') || undefined}
                aria-describedby={describe('ends_on')}
                onChange={e => { setEndsOn(e.target.value); touch('ends_on') }} />
            </FormField>
            {errorLine('ends_on')}
          </div>
        </div>

        <FormField label="Note" hint="Optional. What was agreed, and with whom.">
          <TextArea rows={2} value={note} maxLength={400} aria-invalid={!!shown('note') || undefined}
            aria-describedby={describe('note')}
            onChange={e => { setNote(e.target.value); touch('note') }} />
        </FormField>
        {errorLine('note')}

        {replaces.length > 0 && (
          <Callout tone="warning" title="What this replaces">
            <ul style={{ margin: '4px 0 0 16px' }}>
              {replaces.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </Callout>
        )}

        {refusal && (
          <div role="alert">
            <Callout tone="danger" title="The price was not set">{refusal}</Callout>
          </div>
        )}
      </div>
    </Modal>
  )
}
