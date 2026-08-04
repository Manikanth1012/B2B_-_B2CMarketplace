/* Putting a listing's photographs somewhere and attaching them to the product.
 *
 * Two steps, deliberately separated in time. The file goes to storage the
 * moment the seller picks it, so they see it and it survives them wandering off
 * mid-wizard; the `product_media` rows are written at submit, because until
 * then there is no product for them to point at.
 */
import { supabase } from './supabase'
import {
  validateAddition, validateDimensions, kindOf, mediaPath, roleFor, ordered,
} from './listingMedia'
import type { MediaItem } from './listingMedia'
import type { Check } from './enterprise'

const BUCKET = 'listing-media'

export type Added = { ok: true; item: MediaItem } | { ok: false; reason: string }

/**
 * Read the pixel size of an image in the browser.
 *
 * Separate from the rule that judges it: the rule is arithmetic and is tested,
 * this is the part that needs a DOM. A file the browser cannot decode is not a
 * picture, whatever its mime type claims, so failing to read it is itself the
 * answer.
 */
async function measure(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bmp = await createImageBitmap(file)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close?.()
    return size
  } catch {
    return null
  }
}

/**
 * Validate, measure, upload.
 *
 * Every refusal is a sentence rather than a thrown error, because all of them
 * are things a seller can act on — a file too big, a picture too small, a
 * seventh image.
 */
export async function addListingMedia(
  { file, partnerId, draftId, have }: {
    file: File; partnerId: string; draftId: string; have: readonly MediaItem[]
  },
): Promise<Added> {
  const first = validateAddition(file, have)
  if (!first.ok) return { ok: false, reason: first.reason }

  const kind = kindOf(file.type)!
  if (kind === 'image') {
    const size = await measure(file)
    if (!size) {
      return { ok: false, reason: `${file.name} could not be read as an image. If it has been renamed to .jpg from something else, that is usually why.` }
    }
    const big = validateDimensions(file.name, size.width, size.height)
    if (!big.ok) return { ok: false, reason: big.reason }
  }

  /* Numbered from what is already there so two files with the same name do not
     collide, and so the order a seller added them in survives. */
  const path = mediaPath(partnerId, draftId, have.length + 1, file.name)
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) {
    /* The storage policy compares the first path segment to
       `current_partner_id()`, so this is what a seller signed in as somebody
       else — or not signed in at all — actually sees. */
    return { ok: false, reason: /policy|denied|unauthor/i.test(error.message)
      ? 'That upload was refused. You can only add photographs to your own listings.'
      : `${file.name} did not upload: ${error.message}` }
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return {
    ok: true,
    item: { path, url: data.publicUrl, kind, name: file.name, bytes: file.size, alt: '' },
  }
}

/** Taking one back off, before it has been attached to anything. */
export async function removeListingMedia(item: MediaItem): Promise<Check> {
  const { error } = await supabase.storage.from(BUCKET).remove([item.path])
  if (error) return { ok: false, reason: `${item.name} could not be removed: ${error.message}` }
  return { ok: true }
}

/**
 * Attach what was uploaded to the product that now exists.
 *
 * Called after `submitForReview` has written the product, because
 * `product_media.product_id` is a foreign key and the rows have nowhere to
 * point until then. The first image is the hero — that is the one the
 * storefront card shows — and `ordered` is what guarantees the video cannot
 * accidentally become it.
 */
export async function attachMediaToProduct(
  productId: string, have: readonly MediaItem[],
): Promise<Check> {
  const list = ordered(have)
  if (!list.length) return { ok: true }

  const rows = list.map((m, i) => ({
    id: `PM-${productId}-${i + 1}`,
    product_id: productId,
    url: m.url,
    role: roleFor(m, i),
    /* Falling back to the file's own name rather than to an empty string: an
       image with no alt text is unreadable to anybody who cannot see it, and a
       filename is at least something. The form asks for better. */
    alt: m.alt.trim() || m.name,
    sort_order: i + 1,
  }))

  const { error } = await supabase.from('product_media').insert(rows)
  if (error) {
    return { ok: false, reason: `The listing was created, but its photographs did not attach: ${error.message}` }
  }
  return { ok: true }
}

/** Everything a seller abandoned, so a cancelled wizard leaves no orphans. */
export async function discardListingMedia(have: readonly MediaItem[]): Promise<void> {
  if (!have.length) return
  await supabase.storage.from(BUCKET).remove(have.map(m => m.path))
}
