import { useId } from 'react'
import { Zap, ShieldCheck, Globe2, Sparkles, type LucideIcon } from 'lucide-react'
import { BentoGrid, BentoCell, SectionHeader } from '../../ui'

const REASONS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Zap, title: 'Faster time to market', text: 'List once and sell to retail, business and reseller buyers.' },
  { icon: ShieldCheck, title: 'Enterprise-grade security', text: 'Verified sellers, reviewed listings and governed settlement.' },
  { icon: Globe2, title: 'Global reach', text: 'Priced and settled for every market the marketplace runs in.' },
  { icon: Sparkles, title: 'Seamless experience', text: 'One basket, one checkout and one bill across every seller.' },
]

export function WhyAventa() {
  const headingId = useId()
  return (
    <section className="container home-band" aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="Why Aventa?" />
      <BentoGrid cols={4}>
        {REASONS.map(({ icon: Icon, title, text }) => (
          <BentoCell key={title}>
            <div className="bento-card bento-card--light why-tile">
              <span className="why-tile__icon"><Icon size={22} aria-hidden /></span>
              <h3 className="why-tile__title">{title}</h3>
              <p className="why-tile__text">{text}</p>
            </div>
          </BentoCell>
        ))}
      </BentoGrid>
    </section>
  )
}
