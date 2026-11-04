import { useId } from 'react'
import { ArrowRight } from 'lucide-react'
import type { Product } from '../../../types'
import type { PublicPage } from '../../../types/view'
import { HOME_ART } from '../../../lib/home'
import { BentoGrid, BentoCell, BentoCard, SectionHeader, ProductCard } from '../../ui'

export function FeaturedSection({ products, onOpen, onNavigate }: {
  products: readonly Product[]
  onOpen: (p: Product) => void
  onNavigate: (p: PublicPage) => void
}) {
  const headingId = useId()
  if (products.length === 0) return null

  return (
    <section className="container home-band" aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="Featured products"
        action={{ label: 'View all products', onClick: () => onNavigate('retail') }} />
      <BentoGrid cols={6}>
        {products.map(p => (
          <BentoCell key={p.id}><ProductCard product={p} onOpen={() => onOpen(p)} /></BentoCell>
        ))}
        <BentoCell span={2}>
          <BentoCard
            variant="image" image={HOME_ART.promo} imagePosition="center"
            title="Power your business with Aventa"
            text="Innovative telecom solutions for a connected future."
            action={<button className="btn btn-cyan" onClick={() => onNavigate('enterprise')}>
              Learn more <ArrowRight size={14} aria-hidden /></button>}
          />
        </BentoCell>
      </BentoGrid>
    </section>
  )
}
