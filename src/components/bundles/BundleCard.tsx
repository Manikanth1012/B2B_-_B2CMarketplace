import { Layers } from 'lucide-react'
import { useMarket } from '../../lib/MarketContext'
import { getProductImage } from '../../lib/images'
import type { BundleTemplate, BundlePrice } from '../../lib/bundles'
import { StatusBadge } from '../ui/StatusBadge'
import { openBundleConfigurator } from './events'
import { useBundleShelf, useBundleCurrency } from './useBundleShelf'
import { templatesFor, slotsOf } from './shelf'

/* A bundle the buyer puts together, on the same card as a product so it sits
   in the same grid. "Configurable" says it is not one fixed thing; the price is
   the default configuration's, so it reads "from". */
export function BundleCard({ template, from, currency, parts, image }: {
  template: BundleTemplate
  from: BundlePrice
  currency: string
  parts: number
  image: string
}) {
  const { fmtIn } = useMarket()
  const price = fmtIn(from.total, currency)
  const open = () => openBundleConfigurator({ templateId: template.id })
  return (
    <article className="p-card bundle-card">
      <div className="p-card__media">
        <img src={image} alt="" loading="lazy" />
        <span className="p-card__badge">
          <StatusBadge tone="info" icon={null}>Configurable</StatusBadge>
        </span>
      </div>
      <div className="p-card__body">
        <h3 className="p-card__name">
          <button type="button" className="p-card__open" onClick={open}
            aria-label={`${template.name}, configurable bundle from ${price} — choose its parts`}>{template.name}</button>
        </h3>
        <div className="p-card__seller">Bundle of {parts} part{parts === 1 ? '' : 's'} · {template.discount_pct}% off the parts</div>
        {template.description && <p className="p-card__desc">{template.description}</p>}
        <div className="p-card__foot">
          <span className="p-card__price">
            <span className="p-card__unit bundle-card__from">from</span> {price}
            {from.saving > 0 && <span className="p-card__was">{fmtIn(from.parts_total, currency)}</span>}
          </span>
        </div>
        <div className="p-card__actions">
          <button type="button" className="btn btn-sm btn-cyan" onClick={open}>
            <Layers size={14} aria-hidden /> Configure
          </button>
        </div>
      </div>
    </article>
  )
}

/** The bundle cards for one shelf, to sit at the front of a ListingGrid.
    Renders nothing when there are no templates or the read failed, so the shop
    looks exactly as it does without bundles. */
export function BundleCards({ audience, category, search }: {
  audience: 'consumer' | 'enterprise'
  category?: string | null
  search?: string
}) {
  /* Priced in the buyer's own currency, the one the bundle will be sold in,
     whatever the header shows the rest of the shelf in. */
  const { currency } = useBundleCurrency()
  const { shelf } = useBundleShelf(currency)
  if (!currency) return null
  const shown = templatesFor(shelf, audience, currency, { category, search })
  return (
    <>
      {shown.map(({ template, from }) => (
        <BundleCard key={`bundle-${template.id}`} template={template} from={from} currency={currency}
          parts={slotsOf(shelf, template.id).length}
          image={template.image ?? getProductImage(from.lines[0]?.product_id ?? template.id)} />
      ))}
    </>
  )
}

/** Whether a shelf has any bundle cards — for a screen that wraps them in its own section. */
export function useHasBundles(audience: 'consumer' | 'enterprise', category?: string | null): boolean {
  const { currency } = useBundleCurrency()
  const { shelf } = useBundleShelf(currency)
  return !!currency && templatesFor(shelf, audience, currency, { category }).length > 0
}
