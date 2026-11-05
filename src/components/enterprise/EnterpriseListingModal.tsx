/* What a business listing actually is, opened from a card.
 *
 * Clicking a card on the business catalogue was
 * `toast(`Listing detail: ${p.name}`)` — the card's own title, printed into a
 * bubble that vanished after four seconds. A buyer could add a thing to a
 * requisition and never read what it was, which on this surface means somebody
 * signs off spend against a name and a price.
 *
 * Not the storefront's `PublicProductModal`: a business buyer wants different
 * facts. What it costs per unit and per month, how it is fulfilled, what has to
 * be bought alongside it, and — the one nothing else can tell them — whether
 * the account already holds it, because ordering a second copy of something you
 * are already paying for is the mistake this screen can prevent.
 */
import { useState, useEffect } from 'react'
import { Star, Package } from 'lucide-react'
import { Modal, Btn, EmptyState, fmtInt, StatusPill, toast } from '../operator/shared'
import { RaiseQuoteDialog } from '../enquiries/RaiseQuoteDialog'
import { RaiseDemoDialog } from '../enquiries/RaiseDemoDialog'
import { enquiriesChanged } from '../enquiries/events'
import { demoOffered } from '../../lib/enquiries'
import { cardAction } from '../../lib/storefront'
import { StatusBadge, stockTone } from '../ui'
import { stockLabel } from '../../lib/compare'
import { Callout } from '../OnboardingJourney'
import { supabase } from '../../lib/supabase'
import { getProductImage } from '../../lib/images'
import { day } from '../../lib/enterprise'
import type { EnterpriseListing } from '../../lib/enterpriseRepo'
import type { Subscription } from '../../lib/enterprise'

interface Extra {
  media: { url: string; alt: string | null; role: string }[]
  specs: Record<string, string>
  fulfil: string | null
  rules: { kind: string; targets: string[]; why: string | null }[]
  loadError?: string
}

const NOTHING: Extra = { media: [], specs: {}, fulfil: null, rules: [] }

export function EnterpriseListingModal(
  { listing, held, money, onClose, onAdd }: {
    listing: EnterpriseListing | null
    /* Subscriptions the account already holds for this listing. The whole
       reason a buyer opens this before adding it. */
    held: Subscription[]
    money: (n: number) => string
    onClose: () => void
    onAdd: (l: EnterpriseListing) => void
  },
) {
  const [extra, setExtra] = useState<Extra>(NOTHING)
  const [shown, setShown] = useState(0)
  const [asking, setAsking] = useState<'quote' | 'demo' | null>(null)
  useEffect(() => { setAsking(null) }, [listing])
  const asked = (what: string) => {
    setAsking(null)
    toast(`${what} sent to ${listing?.seller ?? 'the seller'}. Follow it on Enquiries.`, 'success')
    enquiriesChanged()
  }

  useEffect(() => {
    if (!listing) { setExtra(NOTHING); setShown(0); return }
    let live = true
    setExtra(NOTHING)
    setShown(0)
    void (async () => {
      const [m, p, r] = await Promise.all([
        supabase.from('product_media').select('url, alt, role').eq('product_id', listing.id).order('sort_order'),
        supabase.from('products').select('specs, fulfil').eq('id', listing.id).maybeSingle(),
        supabase.from('product_rules').select('kind, targets, why').eq('product_id', listing.id).order('sort_order'),
      ])
      if (!live) return
      const errors = [m.error, p.error, r.error].filter(Boolean).map(e => e!.message)
      setExtra({
        media: (m.data ?? []) as Extra['media'],
        specs: ((p.data as { specs?: Record<string, string> } | null)?.specs ?? {}),
        fulfil: (p.data as { fulfil?: string } | null)?.fulfil ?? null,
        rules: (r.data ?? []) as Extra['rules'],
        ...(errors.length ? { loadError: `Some of the detail did not load (${errors.join('; ')}).` } : {}),
      })
    })()
    return () => { live = false }
  }, [listing])

  if (!listing) return null

  /* The catalogue's own photograph is the fallback rather than a blank frame:
     every card on the grid behind this one is showing it. */
  const pictures = extra.media.filter(x => x.role !== 'video')
  const gallery = pictures.length ? pictures.map(x => x.url) : [getProductImage(listing.id)]
  const specs = Object.entries(extra.specs)
  const monthly = listing.model === 'monthly'
  /* The same rule as the catalogue card behind this window: no stock, no add. */
  const action = cardAction('enterprise', listing)

  return (
    <>
    <Modal
      open
      onClose={onClose}
      title={listing.name}
      footer={<Btn variant="secondary" onClick={onClose}>Close</Btn>}>
      {/* Headings: the dialog title is the one h2 (Modal); the sections below are
          h3, so the outline no longer jumps back up a level inside the dialog. */}
      {/* Laid out as the storefront's product page is (product-detail.css):
          photograph and overview on the left, the buying panel on the right.
          The same fields as before; the price and the Add action moved out of
          the footer into the panel, where the decision is made. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {extra.loadError && <Callout tone="danger" title="Some of this did not load">{extra.loadError}</Callout>}

        <div className="pd pd--compact">
          <div className="pd__gallery">
            <div className="pd__media">
              <img src={gallery[Math.min(shown, gallery.length - 1)]} alt={pictures[shown]?.alt ?? ''} />
            </div>
            {gallery.length > 1 && (
              <div className="cpe-thumbs">
                {gallery.map((u, i) => (
                  <button key={u + i} onClick={() => setShown(i)}
                          aria-label={`Picture ${i + 1} of ${gallery.length}`}
                          aria-pressed={i === shown}
                          className={`cpe-thumb${i === shown ? ' is-on' : ''}`}>
                    <img src={u} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <aside className="pd__buy" aria-label="Buy this listing">
            <div className="pd__price">
              {money(listing.price)}
              {monthly && <span className="cpe-per">{listing.unit ? ` ${listing.unit}` : ''}/mo</span>}
              {!monthly && listing.unit && <span className="cpe-per"> {listing.unit}</span>}
            </div>
            <div><StatusBadge tone={stockTone(listing.stock)}>{stockLabel(listing.stock)}</StatusBadge></div>

            {/* Already held — first, because it changes whether to add it at all. */}
            {held.length > 0 && (
              <Callout tone="warning" title={`This account already holds ${held.length === 1 ? 'this' : `${held.length} of these`}`}>
                {held.map(h => (
                  <div key={h.id} style={{ marginTop: '4px' }}>
                    {fmtInt(h.quantity)} {h.unit} on {h.cost_centre ?? 'no cost centre'}, {h.seats_used} assigned
                    {h.status === 'suspended' ? ' — suspended' : `, renewing ${day(h.renews)}`}.
                    {h.seats_used < h.quantity && ` ${h.quantity - h.seats_used} are sitting idle.`}
                  </div>
                ))}
                Assigning what is already licensed costs nothing. Buying more of it costs money.
              </Callout>
            )}

            <Btn variant="primary" disabled={action.disabled}
                 onClick={() => { onAdd(listing); onClose() }}>{action.label}</Btn>

            {/* Asking before buying: a price for a volume, or seeing it work.
                Who answers is the listing's seller. */}
            <div className="enq-ask">
              <Btn variant="secondary" onClick={() => setAsking('quote')}>Request a quote</Btn>
              {demoOffered(listing) && (
                <Btn variant="secondary" onClick={() => setAsking('demo')}>Book a demo</Btn>
              )}
            </div>

            <div className="cpe-note">
              <Package size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              Adding this puts it on a requisition. Nothing is ordered and nothing is charged until the
              requisition is approved by whoever the account's policy names for the amount.
            </div>
          </aside>

          <div className="pd__main">
            <div className="cpe-desc">
              {listing.description || 'No description was supplied for this listing.'}
            </div>

            {listing.rating > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                <Star size={13} style={{ color: 'var(--star)' }} fill="var(--star)" />
                {listing.rating} · {fmtInt(listing.reviews)} reviews from buyers on this marketplace
              </div>
            )}

            {/* What has to be bought with it. A requisition approved without these
                comes back as a support ticket the week the thing is provisioned. */}
            {extra.rules.length > 0 && (
              <div className="pd__section">
                <h3>What this needs alongside it</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {extra.rules.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', fontSize: 'var(--text-sm)' }}>
                      <StatusPill status={r.kind === 'requires' ? 'pending' : 'active'} />
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {r.targets.join(', ')}{r.why ? ` — ${r.why}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pd__section">
              {specs.length === 0
                ? (
                  <>
                    <h3>Specification</h3>
                    <EmptyState message="The seller has not published a specification for this listing." />
                  </>
                )
                : (
                  <details className="pd-acc" open>
                    <summary><h3>Specification</h3></summary>
                    <dl>
                      {specs.map(([k, v]) => (
                        <div key={k} style={{ display: 'contents' }}>
                          <dt>{k}</dt>
                          <dd>{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
            </div>

            <div className="pd__section">
              <h3>Seller</h3>
              <div className="pd-acc">
                <dl style={{ paddingTop: '16px' }}>
                  <dt>Sold by</dt><dd>{listing.seller}</dd>
                  <dt>Category</dt><dd>{listing.sub_category ?? listing.category_id}</dd>
                  <dt>Billing</dt><dd>{monthly ? 'Recurring, cancellable at renewal' : 'One-off purchase'}</dd>
                  <dt>Fulfilled</dt><dd>{fulfilment(extra.fulfil)}</dd>
                  <dt>Availability</dt><dd>{availability(listing.stock)}</dd>
                  <dt>Rated</dt><dd>{listing.rating > 0 ? `${listing.rating} from ${fmtInt(listing.reviews)} reviews` : 'Not rated yet'}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
    {/* Over the listing, which stays open behind; only the top dialog traps. */}
    <RaiseQuoteDialog open={asking === 'quote'} seed={[{ product_id: listing.id, name: listing.name, quantity: 1 }]}
      onClose={() => setAsking(null)} onRaised={() => asked('Quote request')} />
    <RaiseDemoDialog open={asking === 'demo'} product={{ id: listing.id, name: listing.name }}
      onClose={() => setAsking(null)} onRaised={() => asked('Demo request')} />
    </>
  )
}

/* `products.fulfil` holds the five words the catalogue actually uses. Spelling
   them out here rather than showing the raw value, which arrived on screen as
   a lowercase "shipped" in a row of sentences. */
function fulfilment(kind: string | null): string {
  switch (kind) {
    case 'shipped': return 'Shipped to a delivery address'
    case 'provisioned': return 'Provisioned by the seller once approved'
    case 'instant': return 'Available immediately on approval'
    case 'esim': return 'eSIM — a QR code, issued on approval'
    case 'activation': return 'Activated on an existing line'
    default: return kind ?? 'Not stated'
  }
}

/* `products.stock` is a one-word state. "low" on its own reads as a value
   somebody forgot to format. */
function availability(stock: string): string {
  switch (stock) {
    case 'in': return 'In stock'
    case 'low': return 'Low stock — order early'
    case 'out': return 'Out of stock'
    case 'preorder': return 'Pre-order'
    default: return stock
  }
}
