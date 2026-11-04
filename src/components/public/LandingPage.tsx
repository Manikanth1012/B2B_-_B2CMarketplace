import { useState, useEffect, useCallback } from 'react'
import { PromoStrip } from './PromoStrip'
import { PublicProductModal } from './PublicProductModal'
import { HomeHero } from './home/HomeHero'
import { CategorySection } from './home/CategorySection'
import { FeaturedSection } from './home/FeaturedSection'
import { WhyAventa } from './home/WhyAventa'
import { EcosystemStrip } from './home/EcosystemStrip'
import { BANNERS } from '../../lib/assets'
import { loadPromoBanners, loadCategories, loadCatalogue } from '../../lib/storefrontRepo'
import { loadPriceBook, loadCopyBook, repriceAll } from '../../lib/moneyRepo'
import { useMarket } from '../../lib/MarketContext'
import { promoStrip, type PromoSlide } from '../../lib/storefront'
import { featuredProducts, ecosystemSellers } from '../../lib/home'
import type { Category, Product } from '../../types'
import type { PublicPage } from '../../types/view'
import { marketProse } from '../../lib/money'

export function LandingPage({ onNavigate, onAddToBasket }: {
  onNavigate: (p: PublicPage) => void
  onAddToBasket: (p: Product) => void
}) {
  const { book, market, currency } = useMarket()
  const markets = marketProse(book.markets)
  /* The chosen currency, not the market's default. Reading the default here
     while the formatter reads the choice is how a shilling price ends up under
     a dollar sign — the same relabelling the bills migration had to undo. */
  const currencyCode = currency?.code ?? market?.currency ?? 'USD'
  const [slides, setSlides] = useState<PromoSlide[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [catalogue, setCatalogue] = useState<Product[]>([])
  const [open, setOpen] = useState<Product | null>(null)
  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    /* Three independent reads. Any of them coming back empty degrades one band of
       the page rather than failing the page, which is why none of them throws. */
    loadPromoBanners().then(b => setSlides(promoStrip(b, BANNERS)))
    loadCategories().then(setCategories)
    /* Priced for the market too. A shopper who sees $18.00 before signing in
       and ₹1,599.00 after has been shown two different shops. */
    Promise.all([loadCatalogue(), loadPriceBook(currencyCode), loadCopyBook()])
      .then(([rows, prices, copy]) => setCatalogue(repriceAll(rows, prices, currencyCode, copy)))
    /* The currency is a dependency: without it this closes over the first one
       it saw and the page keeps showing that market's prices forever. */
  }, [currencyCode])

  return (
    <>
      <HomeHero markets={markets} onNavigate={onNavigate} />
      {/* The operator's live banners. Pausing one in their console takes it off this page. */}
      <PromoStrip slides={slides} onNavigate={onNavigate} />
      <CategorySection categories={categories} catalogue={catalogue} onNavigate={onNavigate} />
      <FeaturedSection products={featuredProducts(catalogue, categories, 4)} onOpen={setOpen} onNavigate={onNavigate} />
      <WhyAventa />
      <EcosystemStrip sellers={ecosystemSellers(catalogue, 8)} />
      <PublicProductModal product={open} onClose={close} onAddToBasket={onAddToBasket} />
    </>
  )
}
