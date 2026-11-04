import { ArrowRight, Zap } from 'lucide-react'
import type { PublicPage } from '../../../types/view'
import { BentoGrid, BentoCell, BentoCard, NetworkGlobe } from '../../ui'
import { HOME_ART } from '../../../lib/home'

export function HomeHero({ markets, onNavigate }: {
  /** The live market list as prose, e.g. "India, Kenya and the UAE"; empty hides the clause. */
  markets: string
  onNavigate: (p: PublicPage) => void
}) {
  return (
    <section className="container home-band" aria-label="Welcome">
      <BentoGrid cols={3}>
        <BentoCell span={2} rows={2}>
          <BentoCard variant="dark" className="hero-main">
            <span className="hero-eyebrow"><Zap size={14} aria-hidden /> The complete telecom marketplace</span>
            <h1 className="hero-title">
              One marketplace.<br /><span className="hero-title__accent">Every kind of buyer.</span>
            </h1>
            <p className="hero-lede">
              Discover devices, connectivity, digital services, security and IoT solutions from a
              connected ecosystem{markets ? ` — across ${markets}` : ''}.
            </p>
            <div className="hero-ctas">
              <button className="btn btn-lg btn-cyan" onClick={() => onNavigate('retail')}>
                Shop Retail <ArrowRight size={16} aria-hidden />
              </button>
              <button className="btn btn-lg btn-outline-light" onClick={() => onNavigate('enterprise')}>
                Explore Enterprise <ArrowRight size={16} aria-hidden />
              </button>
              <button className="btn btn-lg btn-outline-light" onClick={() => onNavigate('partner')}>
                Become a Partner <ArrowRight size={16} aria-hidden />
              </button>
            </div>
            <div className="hero-art"><NetworkGlobe /></div>
          </BentoCard>
        </BentoCell>

        <BentoCell>
          <BentoCard
            variant="image" image={HOME_ART.business} imagePosition="right center" className="hero-side"
            eyebrow="For Businesses" title="Accelerate your digital transformation"
            text="Connectivity, IoT and security for your estate, on contract terms."
            action={<button className="ui-link ui-link--light" onClick={() => onNavigate('enterprise')}>
              Explore Enterprise <ArrowRight size={14} aria-hidden /></button>}
          />
        </BentoCell>
        <BentoCell>
          <BentoCard
            variant="image" image={HOME_ART.partners} imagePosition="right center" className="hero-side"
            eyebrow="For Partners" title="Grow together with 6D"
            text="List your products and reach every buyer on the marketplace."
            action={<button className="ui-link ui-link--light" onClick={() => onNavigate('partner')}>
              Become a Partner <ArrowRight size={14} aria-hidden /></button>}
          />
        </BentoCell>
      </BentoGrid>
    </section>
  )
}
