import { PRODUCT_IMAGES } from './images'
import { categoryVisual, type Visual } from './home'

/* Which picture an order line shows. The line carries only a product id, so the
   choice is the product's own photo if the shop has one for it, else the artwork
   of the category the product sits in (the same one its category tile uses), else
   the shelf's own icon when the shelf is known, else nothing (the plain box). `getProductImage` is not used for the
   first step because it answers every id, with a stock photo for the unknown. */
export type LineImage =
  | { kind: 'product'; src: string }
  | { kind: 'category'; visual: Visual }
  | { kind: 'shelf'; categoryId: string }
  | { kind: 'none' }

export function orderLineImage(
  productId: string | null | undefined,
  categoryId: string | null | undefined,
  photos: Readonly<Record<string, string>> = PRODUCT_IMAGES,
): LineImage {
  const own = productId ? photos[productId] : undefined
  if (own) return { kind: 'product', src: own }
  const art = categoryId ? categoryVisual(categoryId) : null
  if (art) return { kind: 'category', visual: art }
  if (categoryId) return { kind: 'shelf', categoryId }
  return { kind: 'none' }
}
