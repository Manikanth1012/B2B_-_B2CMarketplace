/**
 * What may run where, what it has to look like, and whether it is fit to go up.
 *
 * A banner is not a picture with a headline on it: it occupies a slot that has a
 * size and a capacity, it competes with everything else in that slot by weight,
 * it points somewhere, and it runs between two dates. Every one of those can be
 * wrong in a way nobody notices until the campaign is live to everybody, which
 * is why they are checked here and shown in the preview rather than discovered
 * afterwards.
 */

export interface BannerSlot {
  id: string
  label: string
  surface: string
  width: number
  height: number
  max_banners: number
  personal_targeting: boolean
  note: string
  sort_order: number
}

export type BannerStatus = 'draft' | 'scheduled' | 'live' | 'paused' | 'ended'

export interface BannerRow {
  id: string
  slot: string
  name: string | null
  title: string
  subtitle: string | null
  cta: string
  audience: string
  region: string
  device: string
  weight: number
  impressions: number
  clicks: number
  orders: number
  revenue: number
  status: BannerStatus
  starts_at: string | null
  ends_at: string | null
  destination: string | null
  destination_ref: string | null
  accent: string | null
  image_url: string | null
  alt: string | null
  sort_order: number
}

/* Audiences that name a person rather than a place or a device. A slot seen
   before sign-in cannot use any of them, because nobody has said who they are
   yet — a campaign aimed at "lapsed customers" on the login screen does not
   under-deliver, it never matches at all. */
export const PERSONAL_AUDIENCES: readonly string[] = [
  'new customers', 'existing customers', 'lapsed customers',
]

export const AUDIENCES: readonly string[] = [
  'all', 'consumer', 'enterprise', 'partner reseller',
  'new customers', 'existing customers', 'lapsed customers',
]

export const DESTINATIONS: readonly string[] = ['landing', 'retail', 'enterprise', 'partner']

/* ------------------------------------------------------------- artwork --- */

export interface Dimensions { width: number; height: number }

/* How far an image's shape may sit from the slot's before it will visibly crop.
   Eight percent is about a 20px band on a 1200px frame — noticeable if you are
   looking for it, invisible if you are not. */
export const ASPECT_TOLERANCE = 0.08

export type ArtworkVerdict = {
  ok: boolean
  /* Fatal for publishing, as opposed to worth knowing. */
  blocking: boolean
  message: string
}

/**
 * Whether an image will sit in a slot without being mangled.
 *
 * Two separate questions, and conflating them is why "wrong size" is such an
 * unhelpful error: the *shape* decides whether it crops, and the *scale*
 * decides whether it looks soft. A correctly-shaped image that is too small
 * upscales and is merely worse; a wrongly-shaped one loses part of the picture,
 * and which part is not something the operator chose.
 */
export function checkArtwork(image: Dimensions | null, slot: BannerSlot): ArtworkVerdict {
  if (!image) {
    return { ok: false, blocking: true, message: `No artwork yet. ${slot.label} needs an image at ${slot.width}×${slot.height}.` }
  }
  if (image.width <= 0 || image.height <= 0) {
    return { ok: false, blocking: true, message: 'That file does not appear to be an image.' }
  }

  const want = slot.width / slot.height
  const got = image.width / image.height
  const drift = Math.abs(got - want) / want

  if (drift > ASPECT_TOLERANCE) {
    const tall = got < want
    return {
      ok: false, blocking: true,
      message: `Wrong shape: ${image.width}×${image.height} is ${got.toFixed(2)}:1 where ${slot.label} is ${want.toFixed(2)}:1. It would be cropped ${tall ? 'top and bottom' : 'left and right'}, and nobody chose which part to lose.`,
    }
  }
  if (image.width < slot.width) {
    const pct = Math.round((1 - image.width / slot.width) * 100)
    return {
      ok: true, blocking: false,
      message: `The right shape but ${pct}% under size — ${image.width}px wide against ${slot.width}px. It will be upscaled and look soft on a sharp screen.`,
    }
  }
  return {
    ok: true, blocking: false,
    message: `${image.width}×${image.height} fits ${slot.label} (${slot.width}×${slot.height}).`,
  }
}

/* ----------------------------------------------------------- occupancy --- */

export interface Occupancy {
  slot: BannerSlot
  /* Only what competes for the rotation. A draft has never run and an ended one
     has stopped; neither takes a turn. */
  running: number
  max: number
  remaining: number
  over: boolean
  /* Each running banner's share of the rotation, by weight. Weight is a dial
     with no units, so the useful number is always the share. */
  share: { id: string; name: string; weight: number; pct: number }[]
}

const COMPETES: readonly BannerStatus[] = ['live', 'scheduled']

export function occupancy(slot: BannerSlot, banners: readonly BannerRow[]): Occupancy {
  const mine = banners.filter(b => b.slot === slot.id && COMPETES.includes(b.status))
  const total = mine.reduce((n, b) => n + b.weight, 0)
  return {
    slot,
    running: mine.length,
    max: slot.max_banners,
    remaining: Math.max(0, slot.max_banners - mine.length),
    over: mine.length > slot.max_banners,
    share: mine
      .map(b => ({
        id: b.id, name: b.name ?? b.title, weight: b.weight,
        pct: total === 0 ? 0 : Math.round((b.weight / total) * 1000) / 10,
      }))
      .sort((a, b) => b.pct - a.pct),
  }
}

/* ---------------------------------------------------------- lifecycle ---- */

/** What the dates say the state should be, ignoring what the row claims. Used
    to catch a banner whose window closed a month ago and still says live. */
export function stateFromDates(
  banner: Pick<BannerRow, 'status' | 'starts_at' | 'ends_at'>,
  today: string,
): BannerStatus | null {
  /* Draft and paused are decisions somebody took, not consequences of the
     calendar, so the dates have nothing to say about them. */
  if (banner.status === 'draft' || banner.status === 'paused') return null
  if (banner.ends_at && banner.ends_at < today) return 'ended'
  if (banner.starts_at && banner.starts_at > today) return 'scheduled'
  return 'live'
}

/** Where the row and its own dates disagree. */
export function scheduleDrift(banner: BannerRow, today: string): string | null {
  const should = stateFromDates(banner, today)
  if (!should || should === banner.status) return null
  if (banner.status === 'live' && should === 'ended') {
    return `Marked live but its window closed on ${banner.ends_at}. It is not being shown.`
  }
  if (banner.status === 'live' && should === 'scheduled') {
    return `Marked live but it does not open until ${banner.starts_at}. It is not being shown yet.`
  }
  if (banner.status === 'scheduled' && should === 'live') {
    return `Scheduled, but its start date has passed. Set it live or move the date.`
  }
  if (banner.status === 'scheduled' && should === 'ended') {
    return `Scheduled, but the whole window is in the past.`
  }
  if (banner.status === 'ended' && should === 'live') {
    return `Marked ended, but its window is open. Nothing is being shown.`
  }
  return null
}

/* --------------------------------------------------------- validation --- */

export interface BannerDraft {
  name: string
  slot: string
  title: string
  subtitle: string
  cta: string
  audience: string
  region: string
  device: string
  weight: number
  status: BannerStatus
  starts_at: string | null
  ends_at: string | null
  destination: string | null
  destination_ref: string | null
  accent: string | null
  image_url: string | null
  alt: string
}

/**
 * Why this banner cannot be saved in the state it is in, or null when it can.
 *
 * One reason at a time, in the order somebody can act on them. A draft is held
 * to a lower bar than something going live on purpose: half-written is what a
 * draft is for, and refusing to save one is how people end up keeping campaigns
 * in a spreadsheet.
 */
export function validateBanner(
  draft: BannerDraft,
  slot: BannerSlot | undefined,
  artwork: ArtworkVerdict | null,
  slots: readonly BannerSlot[],
  banners: readonly BannerRow[],
  today: string,
  editingId?: string,
): string | null {
  if (!draft.name.trim()) return 'Give it a name. This is what you will look for in the list, not what a reader sees.'
  if (!slot) return `“${draft.slot}” is not a slot. Choose where it runs: ${slots.map(s => s.label).join(', ')}.`
  if (!draft.title.trim()) return 'The headline is what a reader sees. It cannot be empty.'
  if (!draft.cta.trim()) return 'Give the button a label — a banner with no call to action has nowhere to send anybody.'

  if (draft.weight < 1 || draft.weight > 100) {
    return 'Weight runs 1 to 100. It is a share of the rotation, not a percentage of anything.'
  }

  if (draft.starts_at && draft.ends_at && draft.starts_at > draft.ends_at) {
    return `It would end on ${draft.ends_at}, before it starts on ${draft.starts_at}.`
  }

  /* A slot that cannot target a person will silently never match. Refused
     rather than warned: silence is exactly the failure mode. */
  if (!slot.personal_targeting && PERSONAL_AUDIENCES.includes(draft.audience.toLowerCase())) {
    return `${slot.label} is seen before sign-in, so it cannot target “${draft.audience}” — nobody has identified themselves yet. Use a locale or a device, or move it to a slot behind the login.`
  }

  if (draft.destination_ref && !draft.destination) {
    return 'It points at a product but no page. Choose which storefront opens.'
  }

  /* Everything below is about running, and a draft is not running. */
  if (draft.status === 'draft') return null

  if (!draft.image_url) {
    return `${slot.label} needs artwork at ${slot.width}×${slot.height} before it can run. Drafts can wait; anything live cannot.`
  }
  if (artwork && artwork.blocking) return artwork.message

  if (!draft.alt.trim()) {
    return 'Describe the artwork. Anyone reading with a screen reader gets the alt text and nothing else, and a banner is the one thing on the page selling something.'
  }
  if (!draft.destination) {
    return 'Choose where the call to action lands. Without it the click has nowhere to go.'
  }

  const occ = occupancy(slot, banners.filter(b => b.id !== editingId))
  if (occ.remaining === 0) {
    return `${slot.label} already carries ${occ.running} of ${occ.max}. Past that the rotation is so thin nobody sees any of them twice — pause one before adding another.`
  }

  if (draft.status === 'scheduled' && (!draft.starts_at || draft.starts_at <= today)) {
    return 'Scheduled means it opens later. Give it a start date in the future, or set it live now.'
  }
  if (draft.status === 'ended' && (!draft.ends_at || draft.ends_at >= today)) {
    return 'Ended means its window has closed. Give it an end date in the past, or pause it instead.'
  }
  if (draft.status === 'live' && draft.ends_at && draft.ends_at < today) {
    return `It cannot go live with an end date of ${draft.ends_at}, which has already passed.`
  }
  return null
}

/** Things worth saying that should not stop anybody. */
export function bannerWarnings(
  draft: BannerDraft,
  slot: BannerSlot | undefined,
  artwork: ArtworkVerdict | null,
  banners: readonly BannerRow[],
  editingId?: string,
): string[] {
  const out: string[] = []
  if (!slot) return out

  if (artwork && artwork.ok && !artwork.message.startsWith(`${0}`) && /under size/.test(artwork.message)) {
    out.push(artwork.message)
  }
  if (draft.status !== 'draft' && !draft.subtitle.trim()) {
    out.push('No supporting line. The headline is carrying the whole offer on its own.')
  }
  if (draft.title.length > 60) {
    out.push(`The headline is ${draft.title.length} characters. Past about 60 it wraps on a phone and the artwork loses its top.`)
  }

  const occ = occupancy(slot, banners.filter(b => b.id !== editingId))
  if (occ.running > 0 && draft.status === 'live') {
    const total = occ.share.reduce((n, s) => n + s.weight, 0) + draft.weight
    const mine = Math.round((draft.weight / total) * 1000) / 10
    out.push(`At weight ${draft.weight} it takes about ${mine}% of ${slot.label}, sharing with ${occ.running} other${occ.running === 1 ? '' : 's'}.`)
  }
  return out
}

/* ------------------------------------------------------------ measures --- */

export interface BannerMetrics {
  ctr: number | null
  conversion: number | null
  revenuePerMille: number | null
  revenuePerOrder: number | null
}

/** Rates rather than totals, because a banner with more impressions is not a
    better banner. Null where nothing has run — zero would claim it performed
    badly rather than that it has not performed. */
export function metrics(b: Pick<BannerRow, 'impressions' | 'clicks' | 'orders' | 'revenue'>): BannerMetrics {
  const pct = (a: number, b2: number) => b2 === 0 ? null : Math.round((a / b2) * 1000) / 10
  return {
    ctr: pct(b.clicks, b.impressions),
    conversion: pct(b.orders, b.clicks),
    revenuePerMille: b.impressions === 0 ? null : Math.round((b.revenue / b.impressions) * 1000 * 100) / 100,
    revenuePerOrder: b.orders === 0 ? null : Math.round((b.revenue / b.orders) * 100) / 100,
  }
}

/** Where the click actually lands, spelled out. "retail" tells the operator
    nothing about whether the reader arrives at the right place. */
export function destinationLabel(
  b: Pick<BannerRow, 'destination' | 'destination_ref'>,
  productName?: (id: string) => string | undefined,
): string {
  const page = b.destination
    ? { landing: 'the landing page', retail: 'the retail storefront', enterprise: 'the business storefront', partner: 'the partner site' }[b.destination] ?? b.destination
    : 'nowhere — no destination set'
  if (!b.destination_ref) return page
  const name = productName?.(b.destination_ref) ?? b.destination_ref
  return `${name}, on ${page}`
}
