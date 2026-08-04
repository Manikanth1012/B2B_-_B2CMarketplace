/* What the new-listing wizard has to read before it can ask its questions.
 *
 * Kept apart from `loadSellerRecord`, which every partner screen calls: three
 * of these four reads are only wanted by this one wizard, and adding them to
 * the shared loader would put them on every page that shows a seller anything.
 */
import { supabase } from './supabase'
import type { MarketOption, BundleRules } from './listingDraft'

export interface ListingContext {
  /* Markets this seller is approved to trade in, with the currencies each takes.
     Empty is a real answer — a seller with no approved market cannot list. */
  markets: MarketOption[]
  /* Their own live listings, which is what a bundle may be made of. A bundle of
     somebody else's products is not a bundle, it is a claim about stock they do
     not hold. */
  own: { id: string; name: string; price: number; currency: string }[]
  rules: BundleRules
  loadError?: string
}

const FALLBACK_RULES: BundleRules = { min_components: 2, max_components: 6, max_discount: 18 }

export async function loadListingContext(partnerId: string): Promise<ListingContext> {
  const [mk, mc, mine, br] = await Promise.all([
    supabase.from('partner_markets').select('market_code, state').eq('partner_id', partnerId),
    supabase.from('market_currencies').select('market_code, currency, sort_order').order('sort_order'),
    supabase.from('products').select('id, name, price, currency')
      .eq('partner_id', partnerId).eq('status', 'live').order('name'),
    supabase.from('bundle_rules').select('*').limit(1).maybeSingle(),
    /* `markets` itself is read below rather than here, because it is only
       wanted for the names and the join is cheaper than a fourth round trip. */
  ])

  /* `tax_rate` and `tax_label` come with the name — they are the market's own
     facts and the wizard shows them rather than asking a seller to type one. */
  const { data: names } = await supabase.from('markets').select('code, name, tax_rate, tax_label')

  const errors = [mk.error, mc.error, mine.error, br.error].filter(Boolean).map(e => e!.message)

  const approved = ((mk.data ?? []) as { market_code: string; state: string }[])
    .filter(r => r.state === 'approved')
    .map(r => r.market_code)

  const currencies = (mc.data ?? []) as { market_code: string; currency: string }[]
  const named = (names ?? []) as { code: string; name: string; tax_rate: number; tax_label: string }[]

  const markets: MarketOption[] = approved.map(code => {
    const m = named.find(n => n.code === code)
    return {
      code,
      name: m?.name ?? code,
      currencies: currencies.filter(c => c.market_code === code).map(c => c.currency),
      taxRate: Number(m?.tax_rate ?? 0),
      taxLabel: m?.tax_label ?? 'Tax',
    }
  })

  const rules = (br.data as BundleRules | null) ?? FALLBACK_RULES

  return {
    markets,
    own: ((mine.data ?? []) as { id: string; name: string; price: number; currency: string }[])
      .map(p => ({ ...p, price: Number(p.price) })),
    rules: {
      min_components: Number(rules.min_components),
      max_components: Number(rules.max_components),
      max_discount: Number(rules.max_discount),
    },
    ...(errors.length ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}
