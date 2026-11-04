import { Sparkles, Shield, Truck, Headphones } from 'lucide-react'
import { BentoGrid, BentoCell, BentoCard } from './ui'
import { useMarket } from '../lib/MarketContext'
import { money, rateOn, convert, charmPrice, format } from '../lib/money'

import type { View } from '../types/view'
import { marketProse } from '../lib/money'

interface HeroProps {
  onNavigate: (view: View, opts?: { category?: string }) => void
}

/** The free-delivery threshold, as the marketplace states it. */
const FREE_DELIVERY_OVER = money(50, 'USD')

export function Hero({ onNavigate }: HeroProps) {
  const { book, currency } = useMarket()
  const markets = marketProse(book.markets)

  /* "Orders over $50" was printed to a shopper in Nairobi being quoted in
     shillings, where fifty dollars is not a number they can act on. Unlike a
     price this really is one rule converted — the marketplace has one delivery
     threshold, not one per market — so it is converted at today's rate and
     charm-rounded, which is what a threshold on a banner looks like everywhere.
     Falls back to the dollar figure if there is no rate rather than printing a
     number arrived at by no route at all. */
  const threshold = (() => {
    const to = currency?.code
    if (!to || to === FREE_DELIVERY_OVER.currency) {
      return format(FREE_DELIVERY_OVER, book.currencies, { decimals: false })
    }
    const today = new Date().toISOString().slice(0, 10)
    const r = rateOn(book.rates, FREE_DELIVERY_OVER.currency, to, today)
    if (!r) return format(FREE_DELIVERY_OVER, book.currencies, { decimals: false })
    const c = convert(FREE_DELIVERY_OVER, to, r.rate, r.as_of, book.currencies)
    return format(money(charmPrice(c.money.amount, to), to), book.currencies, { decimals: false })
  })()

  const quickLinks = [
    { label: 'Add-ons & Travel', cat: 'consumer' },
    { label: 'Streaming', cat: 'content' },
    { label: 'Security', cat: 'security' },
    { label: 'IoT Fleet', cat: 'iot' },
  ]
  const trust = [
    { icon: <Truck size={18} aria-hidden="true" />, label: 'Free delivery on devices', sub: `On all orders over ${threshold}` },
    { icon: <Shield size={18} aria-hidden="true" />, label: 'Instant activation', sub: 'eSIM and digital services' },
    { icon: <Headphones size={18} aria-hidden="true" />, label: '24/7 support', sub: 'Across all time zones' },
    { icon: <Sparkles size={18} aria-hidden="true" />, label: 'Reward points', sub: 'Earn on every purchase' },
  ]

  return (
    <section className="container home-band" aria-label="Welcome">
      <BentoGrid cols={4}>
        <BentoCell span={2}>
          <BentoCard variant="light" className="retail-hero">
            <span className="pill" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} aria-hidden="true" />
              One marketplace for everything telecom
            </span>
            <h1 className="retail-hero__title">
              {/* Not "plans". A new line is onboarded in self-care, retail POS or
                  CRM, where the identity check is — promising one here is the
                  first thing a shopper would find untrue. */}
              Devices, add-ons, security<br />and IoT — all in one place
            </h1>
            <p className="retail-hero__lede">
              Top up the line you already have, stream entertainment, protect your business, and deploy
              IoT fleets. Powered by Aventa Telecom{markets && ` across ${markets}`}.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={() => onNavigate('category', { category: 'consumer' })} className="btn btn-cyan btn-lg">
                Shop add-ons
              </button>
              <button onClick={() => onNavigate('category', { category: 'device' })} className="btn btn-secondary btn-lg">
                Browse Devices
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {quickLinks.map((q) => (
                <button key={q.label} onClick={() => onNavigate('category', { category: q.cat })} className="btn btn-secondary btn-sm">
                  {q.label}
                </button>
              ))}
            </div>
          </BentoCard>
        </BentoCell>
        {trust.map((t) => (
          <BentoCell key={t.label}>
            <div className="bento-card bento-card--light trust-tile">
              {t.icon}
              <h3 className="trust-tile__title">{t.label}</h3>
              <p className="trust-tile__text">{t.sub}</p>
            </div>
          </BentoCell>
        ))}
      </BentoGrid>
    </section>
  )
}
