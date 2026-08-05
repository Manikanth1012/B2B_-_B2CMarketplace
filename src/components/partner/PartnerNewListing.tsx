import { useState, useEffect } from 'react'
import { Store, ChevronLeft, ChevronRight, Check, Trash2 } from 'lucide-react'
import { SectionCard, FormField, TextInput, TextArea, Select, Btn, toast } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { canListIn, rateAt, approvedCategories } from '../../lib/partnerCommerce'
import { submitForReview } from '../../lib/catalogueRepo'
import { validateBand, bandWarnings, bases } from '../../lib/pricing'
import { ListingMediaStep } from './ListingMediaStep'
import { attachMediaToProduct } from '../../lib/listingMediaRepo'
import { mediaOutstanding } from '../../lib/listingMedia'
import type { MediaItem } from '../../lib/listingMedia'
import {
  LISTING_KINDS, BILLING_PERIODS, modelFor, periodOf, currenciesFor,
  validateMarkets, blankPrices, reconcilePrices, validatePrices,
  validateBundle, componentsTotal, bundleSaving, draftOutstanding, taxPerMarket,
} from '../../lib/listingDraft'
import type { ListingKind, BillingPeriod, PriceRow, BundleComponent } from '../../lib/listingDraft'
import { loadListingContext } from '../../lib/listingDraftRepo'
import type { ListingContext } from '../../lib/listingDraftRepo'

const STEPS = ['Marketplace and type', 'Details and media', 'Pricing and commission', 'Fulfilment', 'Compliance', 'Review and submit']

/* The marketplace picker offers the categories this seller was approved for and
   no others. It used to offer a hard-coded pair that had drifted from the
   record — a Security option to a seller approved for IoT and Devices — which
   is a listing the catalogue desk would have had to reject after the seller had
   done all six steps of work. */
export function PartnerNewListing({ partnerId }: { partnerId: string }) {
  const [rec, setRec] = useState<SellerRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [subCategory, setSubCategory] = useState('')
  const [vertical, setVertical] = useState('')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [price, setPrice] = useState('')
  /* The band the operator may move within, and the basis the price is quoted
     on. Both were decorative before: a "List price" input bound to nothing and
     a discount dropdown that read as a promise and stored no answer. */
  const [floor, setFloor] = useState('')
  const [list, setList] = useState('')
  const [includesTax, setIncludesTax] = useState(true)
  const [cost, setCost] = useState('')
  const [model, setModel] = useState('oneoff')
  /* The listing's photographs, uploaded as they are picked and attached to the
     product once submitting has created one. `draftId` groups this wizard
     session's files in the bucket; it is minted once rather than per render, or
     every upload would land in a folder of its own. */
  const [media, setMedia] = useState<MediaItem[]>([])
  const [draftId] = useState(() => `LST-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)
  /* Bound at last. It was an input with a placeholder and no `value` or
     `onChange`, so eight carefully chosen search tags went nowhere and the
     submission below sent `tags: []`. */
  const [tags, setTags] = useState('')
  /* The kind of listing, at last held rather than displayed. The three radios
     were `defaultChecked` with no state behind them, which is why a bundle and
     a single product asked exactly the same questions: the answer was thrown
     away the moment it was given. */
  const [kind, setKind] = useState<ListingKind>('single')
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly')
  /* Where it is sold, and what that means it must be priced in. A seller's
     approved markets come from `partner_markets`; the wizard never showed them
     and every listing was implicitly sold everywhere they could trade. */
  const [ctx, setCtx] = useState<ListingContext | null>(null)
  const [markets, setMarkets] = useState<string[]>([])
  const [prices, setPrices] = useState<PriceRow[]>([])
  const [components, setComponents] = useState<BundleComponent[]>([])

  useEffect(() => {
    loadListingContext(partnerId).then(c => {
      setCtx(c)
      /* Opened on everywhere they may trade, because that is what was
         implicitly true before and is the common case. Unticking is the
         deliberate act — a listing certified for one market only. */
      setMarkets(c.markets.map(m => m.code))
    })
  }, [partnerId])

  /* The price rows follow the markets. Typed figures survive, because changing
     one market should not clear the two prices already entered. */
  useEffect(() => {
    if (!ctx) return
    const want = currenciesFor(markets, ctx.markets)
    setPrices(prev => (prev.length ? reconcilePrices(prev, want) : blankPrices(want)))
  }, [markets, ctx])

  useEffect(() => {
    loadSellerRecord(partnerId).then(r => {
      setRec(r)
      /* Open on a category they may actually use, so the first thing on screen
         is not an option that will be refused. */
      setVertical(prev => prev || approvedCategories(r.approvals, r.categories)[0] || '')
      setLoading(false)
    })
  }, [partnerId])

  /* The first currency is the one the commission and tax panels are worked in.
     They are inherently single-currency — a commission rate applied to three
     figures in three currencies is three answers — so the primary market's is
     the one shown, and it is named wherever it appears. */
  const primary = prices[0]?.currency ?? 'USD'
  const priceNum = parseFloat(prices[0]?.price ?? price) || 0
  const costNum = parseFloat(cost) || 0
  /* The rate the seller is actually settled at, read from their plan. */
  const rate = rec?.plan ? rateAt(rec.plan, 0) : 0
  const comm = +(priceNum * rate / 100).toFixed(2)
  const fee = +(priceNum * 0.019 + 0.20).toFixed(2)
  const net = +(priceNum - comm - fee).toFixed(2)
  const floorNum = parseFloat(prices[0]?.floor ?? floor) || 0
  const listNum = parseFloat(prices[0]?.list ?? list) || 0
  /* The primary market's rate. It was a piece of state initialised to '18' and
     bound to a text box — so every commission and margin figure on this step
     was worked out at India's GST whoever the seller was and wherever they
     sold. There is nothing to type: the rate belongs to the market. */
  const rateNum = ctx?.markets.find(m => m.code === markets[0])?.taxRate ?? 0
  const bandProblem = priceNum > 0
    ? validateBand({ price: priceNum, floor: floorNum, list: listNum || priceNum, cost: costNum })
    : null
  const bandNotes = priceNum > 0
    ? bandWarnings({ price: priceNum, floor: floorNum, list: listNum || priceNum, cost: costNum })
    : []
  const split = bases({ price: priceNum, price_includes_tax: includesTax, tax_rate: rateNum })
  /* One row per market, each with its own rate — worked out from `markets`
     rather than from anything the seller typed. */
  const taxRows = ctx ? taxPerMarket(markets, ctx.markets, prices, includesTax) : []
  const margin = costNum > 0 ? +(net - costNum).toFixed(2) : net

  /* This used to end in a toast and write nothing, so a seller could submit all
     day and the operator's queue never moved. It now creates the listing in
     `pending` and the review record the catalogue desk decides on — the same
     two rows every other submission in the queue is made of. */
  const handleSubmit = async () => {
    if (bandProblem) { toast(bandProblem, 'error'); return }
    if (!name.trim() || priceNum <= 0) {
      toast('A listing needs a name and a price before it can be submitted', 'error')
      return
    }
    /* Checked here as well as shown on the media step. The step's sentence is
       guidance while there is still work to do; this is the point at which a
       listing with no photograph would otherwise reach the catalogue desk and
       be rejected for it after six steps of work. */
    const shape = {
      kind, name, markets, prices, components,
      billingPeriod: kind === 'subscription' ? billingPeriod : null,
    }
    const short = draftOutstanding(shape)
    if (short.length) {
      toast(`Still needs ${short.join(', ')}.`, 'error')
      return
    }
    const wheres = validateMarkets(markets, ctx?.markets ?? [])
    if (!wheres.ok) { toast(wheres.reason, 'error'); return }
    const priced = validatePrices(prices)
    if (!priced.ok) { toast(priced.reason, 'error'); setStep(2); return }
    if (kind === 'bundle' && ctx) {
      const made = validateBundle(components, priceNum, ctx.rules)
      if (!made.ok) { toast(made.reason, 'error'); setStep(1); return }
    }

    const missingMedia = mediaOutstanding(media)
    if (missingMedia.length) {
      toast(`The media step still needs ${missingMedia.join(' and ')}.`, 'error')
      setStep(1)
      return
    }
    if (rec) {
      /* Checked again at submit, not only when the picker was built: the
         approval can be withdrawn between opening this wizard and finishing it. */
      const verdict = canListIn(vertical, rec.approvals, id => rec.categories.find(c => c.id === id)?.name ?? id)
      if (!verdict.ok) { toast(verdict.reason, 'error'); return }
    }

    setSaving(true)
    const res = await submitForReview({
      draft: {
        partnerId, categoryId: vertical, subCategory: subCategory || 'General',
        name, description: desc, price: priceNum, cost: costNum,
        floorPrice: floorNum || priceNum,
        listPrice: listNum || priceNum,
        priceIncludesTax: includesTax,
        /* The primary market's rate, because `products.tax_rate` is one column
           and this listing may be sold under three. It records what the seller
           quoted against; what a buyer is actually charged comes from their own
           market, which is why the wizard no longer asks for a figure. */
        taxRate: rateNum,
        /* The kind decides whether it recurs; the period says how often. */
        model: modelFor(kind),
        fulfil: modelFor(kind) === 'oneoff' ? 'shipped' : 'provisioned',
        billingPeriod: kind === 'subscription' ? billingPeriod : null,
        markets,
        prices: prices.map(r => ({
          currency: r.currency,
          price: parseFloat(r.price) || 0,
          floor: parseFloat(r.floor) || 0,
          list: parseFloat(r.list) || 0,
        })),
        components: components.map(c => ({ product_id: c.product_id, quantity: c.quantity })),
        /* Eight at most, trimmed, blanks dropped — the hint under the field
           says up to eight and this is what makes that true. */
        tags: tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 8),
      },
      submittedBy: rec?.partner?.contact ?? 'Seller operations',
    })
    setSaving(false)
    if (!res.ok) { toast(res.reason, 'error'); return }

    /* The photographs are already in storage; this is what points the product
       at them. Reported rather than swallowed if it fails — a listing in the
       queue with no pictures is a rejection waiting to happen, and the seller
       needs to know it is that rather than something they did. */
    if (res.productId) {
      const attached = await attachMediaToProduct(res.productId, media)
      if (!attached.ok) toast(attached.reason, 'error')
    }

    toast(res.note ?? `${name} is in the marketplace review queue`)
    setStep(0); setName(''); setPrice(''); setCost(''); setDesc(''); setSubCategory('')
    setFloor(''); setList(''); setTags(''); setMedia([])
    setKind('single'); setComponents([])
    setMarkets(ctx?.markets.map(m => m.code) ?? []); setPrices([])
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const approved = rec ? approvedCategories(rec.approvals, rec.categories) : []

  /* Nothing to sell in is not an empty form — it is a different answer, and
     walking somebody through six steps that end in a refusal is worse than
     saying so at the top. */
  if (approved.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>New listing</h1>
        </div>
        <Callout tone="warning" title="You are not approved to sell in any category yet">
          Approval is granted when your application clears, and it is what every listing is checked against.
          The onboarding page shows which gate you are on.
        </Callout>
      </div>
    )
  }

  const bodies: React.ReactNode[] = [
    // Step 0: Marketplace and type
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <FormField label="Which marketplace" hint="Only the categories you were approved to sell in.">
          <Select value={vertical} onChange={e => setVertical(e.target.value)}>
            {approved.map(id => (
              <option key={id} value={id}>{rec?.categories.find(c => c.id === id)?.name ?? id}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Sub-category" hint="How buyers narrow a search inside that marketplace.">
          <TextInput value={subCategory} onChange={e => setSubCategory(e.target.value)} placeholder="e.g. Sensors" />
        </FormField>
      </div>
      <div>
        <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)', marginBottom: '8px', display: 'block' }}>Listing type</label>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {LISTING_KINDS.map(t => (
            <label key={t.id} style={{
              display: 'flex', gap: '8px', alignItems: 'flex-start',
              border: `1px solid ${kind === t.id ? 'var(--brand-accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)', padding: '9px 11px', flex: '1 1 0', cursor: 'pointer',
            }}>
              <input type="radio" name="nlType" checked={kind === t.id}
                onChange={() => setKind(t.id)} style={{ marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{t.label}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{t.blurb}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Asked only where it means something. A one-off purchase has no billing
          period, and the database refuses the pair the other way round. */}
      {kind === 'subscription' && (
        <FormField label="How often it bills"
          hint="The price on the next step is the price for one of these, not a monthly equivalent.">
          <Select value={billingPeriod} onChange={e => setBillingPeriod(e.target.value as BillingPeriod)}>
            {BILLING_PERIODS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </Select>
        </FormField>
      )}

      {/* Where it may be sold. The list is the seller's own approved markets —
          it was never shown, so a seller could not tell which countries they
          were listing into, and every listing went to all of them. */}
      <div>
        <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)', marginBottom: '4px', display: 'block' }}>
          Where it is sold
        </label>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
          The markets you are approved to trade in. Untick anywhere this particular listing is not
          certified or cannot be delivered — each one you keep asks for its own price.
        </div>
        {ctx && ctx.markets.length === 0 ? (
          <Callout tone="warning" title="You have no approved markets">
            A listing has to be sold somewhere. The marketplace desk grants markets alongside categories.
          </Callout>
        ) : (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {(ctx?.markets ?? []).map(m => {
              const on = markets.includes(m.code)
              return (
                <label key={m.code} style={{
                  display: 'flex', gap: '8px', alignItems: 'flex-start',
                  border: `1px solid ${on ? 'var(--brand-accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)', padding: '9px 11px', flex: '1 1 180px', cursor: 'pointer',
                }}>
                  <input
                    type="checkbox" checked={on} style={{ marginTop: '3px' }}
                    onChange={() => setMarkets(prev =>
                      on ? prev.filter(c => c !== m.code) : [...prev, m.code])}
                  />
                  <div>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{m.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {m.currencies.join(' · ')}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        )}
      </div>
    </div>,

    // Step 1: Details
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <FormField label="Listing name" hint="Buyers search this text. Avoid marketing language and model codes only you use.">
        <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Nimbus Air Quality sensor" />
      </FormField>
      <FormField label="Description" hint="Two to four sentences. Claims about performance need evidence at the compliance gate.">
        <TextArea value={desc} onChange={e => setDesc(e.target.value)} placeholder="What it does, what is in the box, what it needs to work" />
      </FormField>
      <FormField label="Search tags" hint="Up to eight, comma separated.">
        <TextInput value={tags} onChange={e => setTags(e.target.value)} placeholder="IP67, 5-year battery, LoRaWAN" />
      </FormField>
      {/* What a bundle is actually made of. This is the question that made a
          bundle a bundle and was never asked — the radio button said Bundle and
          the form then collected a single product. */}
      {kind === 'bundle' && ctx && (
        <div>
          <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)', marginBottom: '4px', display: 'block' }}>
            What is in the bundle
          </label>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
            {ctx.rules.min_components} to {ctx.rules.max_components} of your own live listings, and at most{' '}
            {ctx.rules.max_discount}% off what they cost bought separately. Somebody else's product is not
            yours to bundle.
          </div>

          {ctx.own.length === 0 ? (
            <Callout tone="warning" title="You have no live listings yet">
              A bundle is made of listings that already exist. Publish the parts first.
            </Callout>
          ) : (
            <>
              {components.map(c => (
                <div key={c.product_id} style={{
                  display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 10px',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '8px',
                }}>
                  <div style={{ flex: 1, fontSize: 'var(--text-sm)' }}>
                    {c.name}
                    <span style={{ color: 'var(--text-tertiary)' }}> · {c.unit_price.toFixed(2)} each</span>
                  </div>
                  <input
                    type="number" min={1} value={c.quantity}
                    aria-label={`Quantity of ${c.name}`}
                    onChange={e => setComponents(prev => prev.map(x =>
                      x.product_id === c.product_id ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                    style={{ width: '72px', padding: '6px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'right' }}
                  />
                  <button
                    onClick={() => setComponents(prev => prev.filter(x => x.product_id !== c.product_id))}
                    aria-label={`Remove ${c.name}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}

              <Select
                value=""
                onChange={e => {
                  const pick = ctx.own.find(o => o.id === e.target.value)
                  if (!pick) return
                  if (components.some(c => c.product_id === pick.id)) {
                    toast(`${pick.name} is already in this bundle — change its quantity instead.`, 'error')
                    return
                  }
                  setComponents(prev => [...prev, {
                    product_id: pick.id, name: pick.name, quantity: 1, unit_price: pick.price,
                  }])
                }}
              >
                <option value="">Add one of your listings…</option>
                {ctx.own.filter(o => !components.some(c => c.product_id === o.id)).map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>

              {components.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '8px' }}>
                  Bought separately: <strong>{componentsTotal(components).toFixed(2)}</strong>
                  {priceNum > 0 && (
                    <> · this bundle at {priceNum.toFixed(2)} is{' '}
                      <strong>{bundleSaving(priceNum, components)}%</strong> off</>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <ListingMediaStep
        partnerId={partnerId}
        draftId={draftId}
        media={media}
        onChange={setMedia}
      />
    </div>,

    // Step 2: Pricing
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* A price per currency, because a price is chosen per market and not
          converted from another. The wizard used to ask for one figure in
          dollars while the seller traded in three markets taking three
          currencies — so two of the three were invented later, or never set. */}
      <div>
        <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)', marginBottom: '4px', display: 'block' }}>
          Prices{kind === 'subscription' ? ` — per ${periodOf(billingPeriod)?.label.toLowerCase() ?? 'period'} charge` : ''}
        </label>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
          One row for every currency the markets you chose trade in. Each is a figure you set, not a
          conversion of another — a buyer in each market is quoted in their own money.
        </div>

        {prices.length === 0 ? (
          <Callout tone="warning" title="Nothing to price yet">
            Choose where this listing is sold on the first step, and its currencies appear here.
          </Callout>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr', gap: '10px', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>
              <span>Currency</span><span>Asking price</span><span>Minimum</span><span>Maximum</span>
            </div>
            {prices.map((r, i) => (
              <div key={r.currency} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr', gap: '10px', alignItems: 'center' }}>
                <strong style={{ fontSize: 'var(--text-sm)' }}>{r.currency}</strong>
                {(['price', 'floor', 'list'] as const).map(field => (
                  <TextInput
                    key={field} type="number" placeholder="0.00"
                    aria-label={`${field === 'price' ? 'Asking price' : field === 'floor' ? 'Minimum price' : 'Maximum price'} in ${r.currency}`}
                    value={r[field]}
                    onChange={e => setPrices(prev => prev.map((x, n) => n === i ? { ...x, [field]: e.target.value } : x))}
                  />
                ))}
              </div>
            ))}
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Minimum is the least you will accept — it is what lets the marketplace put this in a bundle.
              Maximum is what a saving is measured against. Leave either blank to use the asking price.
            </div>
          </div>
        )}
      </div>

      <FormField label={`Cost price (${primary})`} hint="What it costs you to deliver. Never shown to buyers.">
        <TextInput type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" />
      </FormField>

      {/* The basis is the seller's to declare. The rate is not.

          This used to be a "Tax rate (%)" text box defaulting to 18 — India's
          GST — on a listing sold in three markets charging three different
          taxes. A seller cannot answer that question with one number, and the
          number is not theirs anyway: `markets` records that India charges 18%
          GST, Kenya 16% VAT and the UAE 5% VAT, and whichever applies is
          decided by where the buyer is, not by where the seller typed. */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '16px', alignItems: 'start' }}>
        <FormField label="Your price is quoted"
          hint="The one thing about tax that is yours to say.">
          <Select value={includesTax ? 'inc' : 'ex'} onChange={e => setIncludesTax(e.target.value === 'inc')}>
            <option value="inc">Including tax — what the buyer pays</option>
            <option value="ex">Excluding tax — the buyer adds it</option>
          </Select>
        </FormField>

        <div>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
            What each market charges
          </div>
          {taxRows.length === 0 ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Choose where this is sold and each market's own tax appears here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {taxRows.map(t => (
                <div key={t.code} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', fontSize: 'var(--text-sm)', alignItems: 'baseline' }}>
                  <span>
                    <strong>{t.name}</strong>
                    <span style={{ color: 'var(--text-tertiary)' }}> · {t.label} {t.rate}%</span>
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                    {t.gross > 0
                      ? <>buyer pays <strong>{t.currency} {t.gross.toFixed(2)}</strong>, you book{' '}
                          <strong>{t.net.toFixed(2)}</strong>, {t.label} {t.tax.toFixed(2)}</>
                      : <>no {t.currency} price yet</>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* What the minimum buys the seller, said where the minimum is entered —
          the input itself is a column in the table above now.

          There used to be a second "Minimum price (USD)" field down here, and a
          Billing select offering One-off / Monthly / Annual. Both are gone: the
          floor is per currency because the price is, and the billing question is
          asked once on the first step, where the four periods live. That select
          also offered `annual`, which `products.model` has never accepted — it
          would have been refused on submit if anything had read it. */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '13px 15px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
          The minimum is what lets the marketplace put your listing in a bundle. It may discount down to
          that figure and no further — below it is your margin, not theirs to spend. Leave it at the
          asking price and nothing is ever discounted, which also means the bundles most volume comes
          from cannot include you.
          {priceNum > 0 && floorNum > 0 && floorNum < priceNum && (
            <div style={{ marginTop: '5px', fontWeight: 700, color: 'var(--success)' }}>
              In {primary} you are offering up to {(priceNum - floorNum).toFixed(2)} off —{' '}
              {Math.round(((priceNum - floorNum) / priceNum) * 100)}% of the asking price.
            </div>
          )}
        </div>
        {bandProblem && <Callout tone="danger">{bandProblem}</Callout>}
        {bandNotes.map((w, i) => <Callout key={i} tone="warning">{w}</Callout>)}
      </div>
      {priceNum > 0 && (
        <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'var(--bg-alt)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '12px' }}>What you receive on each sale</div>
          <div style={{ display: 'flex', height: '28px', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '12px' }}>
            <div style={{ width: `${(net / priceNum) * 100}%`, background: 'var(--brand-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
              You ${fmt(net)}
            </div>
            <div style={{ width: `${(comm / priceNum) * 100}%`, background: '#5E4B9B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
              Comm
            </div>
            <div style={{ width: `${(fee / priceNum) * 100}%`, background: '#B8A4E8' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: 'var(--text-sm)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>Sale price</span><span style={{ fontWeight: 600 }}>${fmt(priceNum)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>Commission at {rate}%{rec?.plan ? ` · ${rec.plan.name}` : ''}</span><span>less ${fmt(comm)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>Payment and per-order fees</span><span>less ${fmt(fee)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid var(--border)' }}><span style={{ fontWeight: 700 }}>{costNum > 0 ? 'Your margin' : 'Settles to you'}</span><span style={{ fontWeight: 800 }}>${fmt(margin)}</span></div>
          </div>
        </div>
      )}
    </div>,

    // Step 3: Fulfilment
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <FormField label="How is it delivered">
        <Select>
          <option>Shipped by you</option>
          <option>Instant digital delivery</option>
          <option>Provisioned by you after order</option>
        </Select>
      </FormField>
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '10px' }}>Buyers will see this pipeline:</div>
        <div style={{ display: 'flex', gap: '0', alignItems: 'flex-start' }}>
          {['Placed', 'Packed', 'In transit', 'Delivered'].map((s, i) => (
            <div key={s} style={{ flex: '1 1 0', minWidth: '100px', textAlign: 'center' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%', margin: '0 auto 6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'var(--text-xs)', fontWeight: 700,
                background: i === 0 ? 'var(--success-bg)' : 'var(--bg-alt)',
                color: i === 0 ? 'var(--success)' : 'var(--text-tertiary)',
                border: i === 0 ? '2px solid var(--success)' : '2px solid var(--border)',
              }}>
                {i === 0 ? <Check size={14} /> : i + 1}
              </div>
              <div style={{ fontSize: 'var(--text-xs)' }}>{s}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <FormField label="Dispatch target" hint="Missing this target repeatedly affects your seller rating.">
          <Select>
            <option>Same working day</option>
            <option>Next working day</option>
            <option>Within 3 working days</option>
          </Select>
        </FormField>
        <FormField label="Returns window">
          <Select>
            <option>14 days (marketplace standard)</option>
            <option>30 days</option>
            <option>Not applicable — digital entitlement</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Fulfilment API endpoint" hint="Which of your endpoints the marketplace calls when an order is placed.">
        <Select>
          <option value="">Manual — no API call, I will work from the portal</option>
          <option>Fulfilment Webhook · Sandbox · api.nimbus-sensors.example/fulfil/callback</option>
        </Select>
      </FormField>
    </div>,

    // Step 4: Compliance
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* What was chosen on "Where it is sold", read back — not asked again.
          This was a second row of five hard-coded countries with
          `defaultChecked` and no `onChange`: it recorded nothing, it disagreed
          with the step that does, and two of the five — Singapore and Germany —
          are markets the marketplace does not trade in at all. A seller could
          tick Germany here and declare radio type approval for it.

          The declarations below say "every selected market", so what is
          selected has to be the real answer or the declaration is about
          nothing. */}
      <div>
        <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)', marginBottom: '8px', display: 'block' }}>
          Markets you are declaring for
        </label>
        {markets.length === 0 ? (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--warning)' }}>
            None chosen yet. Go back to “Where it is sold” — these declarations are made per market.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {markets.map(code => {
              const m = ctx?.markets.find(x => x.code === code)
              return (
                <span key={code} style={{
                  display: 'flex', gap: '6px', alignItems: 'center',
                  border: '1px solid var(--border)', borderRadius: '20px', padding: '5px 11px',
                  background: 'var(--bg-alt)', fontSize: 'var(--text-sm)',
                }}>
                  {m?.name ?? code}
                </span>
              )
            })}
          </div>
        )}
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '6px' }}>
          Set on “Where it is sold”, and limited to the markets you are approved to trade in.
        </div>
      </div>
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '10px' }}>Declarations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {[
            ['Radio type approval held for every selected market', 'Required for anything that transmits'],
            ['Product complies with local safety and labelling rules', 'Evidence may be requested at review'],
            ['No randomised paid rewards or loot mechanics', 'Marketplace policy 7.4'],
            ['Personal data handling disclosed in the listing', 'Where the product collects any'],
          ].map((d, i) => (
            <label key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" style={{ marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: 'var(--text-sm)' }}>{d[0]}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{d[1]}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
      <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'var(--info-bg)', border: '1px solid var(--info)', fontSize: 'var(--text-sm)', color: 'var(--info)' }}>
        Declarations are checked at review. A listing that clears review but is later found non-compliant is delisted and the sales are reversed.
      </div>
    </div>,

    // Step 5: Review
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '10px' }}>Preview</div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', maxWidth: '300px' }}>
          <div style={{ height: '120px', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Store size={32} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <div style={{ padding: '12px' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{name || 'Untitled listing'}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{rec?.partner?.name ?? partnerId}</div>
            <div style={{ fontWeight: 700, marginTop: '8px' }}>{priceNum ? `$${fmt(priceNum)}` : '—'}</div>
          </div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '10px' }}>Summary</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-sm)' }}>
          <SummaryRow label="Marketplace" value={rec?.categories.find(c => c.id === vertical)?.name ?? vertical} />
          <SummaryRow label="Price" value={priceNum ? `$${fmt(priceNum)}${model === 'monthly' ? ' per month' : ''}` : 'Not set'} />
          <SummaryRow label="Commission" value={`${rate}% · ${priceNum ? `$${fmt(comm)}` : '—'}`} />
          <SummaryRow label="You receive" value={priceNum ? `$${fmt(net)}` : '—'} />
          <SummaryRow label="Fulfilment" value="Shipped by you" />
        </div>
        <div style={{ marginTop: '16px', padding: '12px', borderRadius: 'var(--radius)', background: 'var(--warning-bg)', border: '1px solid var(--warning)', fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
          <strong>After you submit:</strong> The catalogue team reviews within one working day. You are told why if it is rejected, and can resubmit. Listing is free — you pay {rate}% commission only when it sells.
        </div>
      </div>
    </div>,
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>New Listing</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Product onboarding — six steps from category to submission. Nothing is published until the marketplace clears it.
        </p>
      </div>

      {/* Wizard rail */}
      <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'white' }}>
        {STEPS.map((st, i) => (
          <div key={st} style={{
            flex: '1 1 0', padding: '10px 12px', fontSize: 'var(--text-sm)',
            display: 'flex', gap: '8px', alignItems: 'center',
            borderRight: i < STEPS.length - 1 ? '1px solid var(--border)' : 'none',
            color: i < step ? 'var(--success)' : i === step ? 'var(--brand-navy)' : 'var(--text-tertiary)',
            background: i === step ? 'var(--bg-alt)' : 'transparent',
            fontWeight: i === step ? 600 : 400,
          }}>
            <span style={{
              width: '20px', height: '20px', borderRadius: '50%',
              border: '1px solid', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10px', flexShrink: 0,
              borderColor: i < step ? 'var(--success)' : i === step ? 'var(--brand-navy)' : 'var(--border)',
              background: i < step ? 'var(--success-bg)' : i === step ? 'var(--brand-navy)' : 'transparent',
              color: i < step ? 'var(--success)' : i === step ? 'white' : 'var(--text-tertiary)',
            }}>
              {i < step ? <Check size={10} /> : i + 1}
            </span>
            {st}
          </div>
        ))}
      </div>

      <SectionCard title={STEPS[step]} subtitle={`Step ${step + 1} of ${STEPS.length}`}>
        <div style={{ padding: '20px' }}>
          {bodies[step]}
        </div>
      </SectionCard>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Btn variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ChevronLeft size={14} /> Back
        </Btn>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginRight: '12px' }}>
          {step === STEPS.length - 1 ? 'Submitting sends this to the catalogue team' : 'Your progress is saved as you go'}
        </span>
        {step === STEPS.length - 1
          ? <Btn variant="primary" disabled={saving} onClick={handleSubmit}>{saving ? 'Submitting…' : 'Submit for review'}</Btn>
          : <Btn variant="primary" onClick={() => setStep(step + 1)}>Continue <ChevronRight size={14} /></Btn>}
      </div>
    </div>
  )
}

function fmt(n: number) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}
