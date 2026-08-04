/**
 * What a seller may attach to a listing, and what the form has to refuse.
 *
 * The wizard's media step was two buttons calling `toast('Image added')`. It
 * added nothing, so every rule printed beside it — "1 to 6 images · 800px
 * minimum · up to 5 MB each" — was a description of nothing. These are those
 * rules, made real and kept here so the form and the upload agree about them
 * rather than each having an opinion.
 *
 * Deliberately no browser types in this file. `File` and `createImageBitmap`
 * belong to the layer that has a DOM; what is testable is the arithmetic and
 * the wording, and that is what goes wrong.
 */
import type { Check } from './enterprise'

export type MediaKind = 'image' | 'video'

export const MIN_IMAGES = 1
export const MAX_IMAGES = 6
/* One. A listing is a product, not a channel — and a second video is nearly
   always the same thing at a different length. */
export const MAX_VIDEOS = 1

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const VIDEO_TYPES = ['video/mp4', 'video/webm'] as const

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024

/* The shorter edge, not the longer one. A 2000×400 banner clears an 800px test
   written against the longest side while being unusable as a product
   photograph. */
export const MIN_EDGE = 800

export interface MediaItem {
  /* Where it lives in the bucket — also its identity, since a seller can
     legitimately upload two files with the same name from different folders. */
  path: string
  url: string
  kind: MediaKind
  name: string
  bytes: number
  /* What it is a picture of. Empty until the seller writes it; the storefront
     shows it to anybody who cannot see the image. */
  alt: string
}

export function kindOf(type: string): MediaKind | null {
  if ((IMAGE_TYPES as readonly string[]).includes(type)) return 'image'
  if ((VIDEO_TYPES as readonly string[]).includes(type)) return 'video'
  return null
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 * 10 ? 0 : 1)} MB`
}

/**
 * Whether one more file may be added, and why not.
 *
 * Takes what is already there, because three of the four rules are about the
 * set rather than the file — a seventh image is refused however good it is.
 */
export function validateAddition(
  file: { name: string; type: string; size: number },
  have: readonly MediaItem[],
): Check {
  const kind = kindOf(file.type)
  if (!kind) {
    return {
      ok: false,
      reason: `${file.name} is a ${file.type || 'file of unknown type'}. Images may be JPEG, PNG or WebP; video may be MP4 or WebM.`,
    }
  }

  if (kind === 'image') {
    if (file.size > IMAGE_MAX_BYTES) {
      return { ok: false, reason: `${file.name} is ${mb(file.size)}. Images go up to ${mb(IMAGE_MAX_BYTES)}.` }
    }
    if (have.filter(m => m.kind === 'image').length >= MAX_IMAGES) {
      return { ok: false, reason: `That would be more than ${MAX_IMAGES} images. Remove one first.` }
    }
  } else {
    if (file.size > VIDEO_MAX_BYTES) {
      return { ok: false, reason: `${file.name} is ${mb(file.size)}. Video goes up to ${mb(VIDEO_MAX_BYTES)}.` }
    }
    if (have.filter(m => m.kind === 'video').length >= MAX_VIDEOS) {
      return { ok: false, reason: 'A listing carries one video. Remove the one you have to replace it.' }
    }
  }

  if (file.size === 0) {
    return { ok: false, reason: `${file.name} is empty.` }
  }
  return { ok: true }
}

/** Checked after the file is read, because it needs the pixels. */
export function validateDimensions(name: string, width: number, height: number): Check {
  const edge = Math.min(width, height)
  if (edge < MIN_EDGE) {
    return {
      ok: false,
      reason: `${name} is ${width}×${height}. The shorter edge has to be at least ${MIN_EDGE}px — a smaller picture goes blurry at the size the storefront shows it.`,
    }
  }
  return { ok: true }
}

/**
 * A filename safe to put in a URL path, keeping enough of the original that a
 * seller recognises their own file in a list.
 */
export function safeName(name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  const ext = (dot > 0 ? name.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)
  return `${stem || 'file'}${ext ? `.${ext}` : ''}`
}

/**
 * Where it goes in the bucket.
 *
 * The partner id comes first because that is what the storage policy reads —
 * `foldername(name)[1]` is compared to `current_partner_id()`, so the path is
 * the permission. The draft id keeps one wizard session's files together, which
 * is what makes them removable as a set if the listing is abandoned.
 */
export function mediaPath(partnerId: string, draftId: string, n: number, name: string): string {
  return `${partnerId}/${draftId}/${String(n).padStart(2, '0')}-${safeName(name)}`
}

/** What `product_media.role` a finished item takes. */
export function roleFor(item: MediaItem, index: number): 'hero' | 'gallery' | 'video' {
  if (item.kind === 'video') return 'video'
  return index === 0 ? 'hero' : 'gallery'
}

/**
 * What is still wrong with the set, for the sentence beside the button.
 *
 * Images come before the video in the ordering, so the first image is the hero
 * — the one the card shows. That is worth saying rather than leaving a seller
 * to discover which of their six photographs became the thumbnail.
 */
export function mediaOutstanding(have: readonly MediaItem[]): string[] {
  const out: string[] = []
  const images = have.filter(m => m.kind === 'image')
  if (images.length < MIN_IMAGES) {
    out.push(images.length === 0 ? 'at least one photograph' : `${MIN_IMAGES - images.length} more photographs`)
  }
  const undescribed = have.filter(m => !m.alt.trim())
  if (undescribed.length) {
    out.push(undescribed.length === 1
      ? 'a description of one of them'
      : `descriptions of ${undescribed.length} of them`)
  }
  return out
}

/** Images first, in the order added; the video last. */
export function ordered(have: readonly MediaItem[]): MediaItem[] {
  return [...have.filter(m => m.kind === 'image'), ...have.filter(m => m.kind === 'video')]
}
