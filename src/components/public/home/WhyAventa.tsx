import { useId } from 'react'
import { BentoGrid, BentoCell, SectionHeader, PhotoTile } from '../../ui'
import { BANNERS } from '../../../lib/assets'

const REASONS: { image: string; position?: string; title: string; text: string }[] = [
  { image: BANNERS[8], title: 'Faster time to market', text: 'List once and sell to retail, business and reseller buyers.' },
  { image: BANNERS[7], title: 'Enterprise-grade security', text: 'Verified sellers, reviewed listings and governed settlement.' },
  { image: BANNERS[4], title: 'Global reach', text: 'Priced and settled for every market the marketplace runs in.' },
  { image: BANNERS[1], position: 'right center', title: 'Seamless experience', text: 'One basket, one checkout and one bill across every seller.' },
]

export function WhyAventa() {
  const headingId = useId()
  return (
    <section className="container home-band" aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="Why Aventa?" />
      <BentoGrid cols={4}>
        {REASONS.map(({ image, position, title, text }) => (
          <BentoCell key={title}>
            <PhotoTile image={image} imagePosition={position} title={title} text={text} />
          </BentoCell>
        ))}
      </BentoGrid>
    </section>
  )
}
