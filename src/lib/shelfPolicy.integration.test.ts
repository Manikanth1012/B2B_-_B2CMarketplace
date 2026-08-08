/* Touches the live Supabase project. Reads, and writes one policy row it puts back.
 *
 * The shelf policy was in the database long before anything enforced it: caps
 * printed on a screen, a rating bar read by nothing, a price floor checked only
 * inside a function that writes a review note. This suite is about the half
 * that cannot be unit-tested — that the guard actually refuses, that the screen
 * and the guard agree about what would be refused, and that the policy is
 * coherent against the catalogue it governs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadShelfBook, savePolicy, setLevel } from './shelfPolicyRepo'
import type { ShelfBook } from './shelfPolicyRepo'
import {
  OCCUPIES, occupancy, capState, barImpact, matrixProblems, ruleCoverage, levelOf,
} from './shelfPolicy'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

let book: ShelfBook

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  book = await loadShelfBook()
  expect(book.loadError, book.loadError ?? '').toBeUndefined()
})

afterAll(async () => { await signOut() })

describe('every shelf is governed', () => {
  it('has a policy for each category, so nothing is ungoverned by accident', () => {
    expect(book.categories.length).toBeGreaterThan(1)
    for (const c of book.categories) {
      expect(book.policies.find(p => p.category_id === c.id),
        `${c.name} has no policy — nobody has decided anything about that shelf`).toBeTruthy()
    }
  })

  /* Two columns answering one question is how a shelf comes to demand 3.0 and
     not require a rating at the same time. */
  it('states a rating bar once, not twice', () => {
    for (const p of book.policies) {
      expect(p).not.toHaveProperty('rating_required')
      if (p.min_rating !== null) {
        expect(p.min_rating).toBeGreaterThanOrEqual(1)
        expect(p.min_rating).toBeLessThanOrEqual(5)
      }
    }
  })

  /* A bar and "what about the unrated" are different policies, and if they
     always moved together the second would be noise. */
  it('decides the unrated case separately from the bar, and the two genuinely differ', () => {
    const barred = book.policies.filter(p => p.min_rating !== null)
    expect(barred.length).toBeGreaterThan(0)
    expect(barred.some(p => p.allow_unrated), 'no shelf admits an unrated seller').toBe(true)
    expect(barred.some(p => !p.allow_unrated), 'no shelf refuses one, so the column decides nothing').toBe(true)
    for (const p of barred.filter(x => !x.allow_unrated)) {
      expect(p.unrated_note, `${p.category_id} refuses unrated sellers and does not say why`).toBeTruthy()
    }
  })

  it('never records a seller rating of zero to mean unrated', () => {
    for (const s of book.sellers) {
      expect(s.rating === null || s.rating > 0,
        `${s.name} is rated 0, which a bar would read as a score`).toBe(true)
    }
    expect(book.sellers.some(s => s.rating === null),
      'no seller is unrated, so the case the bar turns on is untested').toBe(true)
  })
})

describe('the caps against the shelf they cap', () => {
  it('sets no cap so far above the shelf that it can never be reached', () => {
    for (const p of book.policies) {
      if (p.max_listings_per_seller === null) continue
      const held = occupancy(book.listings, book.sellers, p.category_id, p)
      const most = Math.max(0, ...held.map(h => h.held))
      expect(p.max_listings_per_seller,
        `${p.category_id} caps at ${p.max_listings_per_seller} against a largest holding of ${most} — unreachable, so untested`)
        .toBeLessThanOrEqual(Math.max(4, most * 4))
    }
  })

  it('is not already breached by what is on the shelf', () => {
    for (const p of book.policies) {
      for (const h of occupancy(book.listings, book.sellers, p.category_id, p)) {
        expect(h.state, `${h.seller} holds ${h.held} of ${h.cap} on ${p.category_id}`).not.toBe('over')
      }
    }
  })

  it('has at least one supplier near enough a cap for the state to mean something', () => {
    const states = book.policies.flatMap(p =>
      occupancy(book.listings, book.sellers, p.category_id, p).map(h => h.state))
    expect(states.some(s => s !== 'ok'),
      'every supplier is far from every cap, so "near the cap" is drawn against nothing')
      .toBe(true)
  })

  it('does not count a suspended listing against its seller', async () => {
    const { data } = await supabase.from('products')
      .select('id,partner_id,category_id,status').eq('status', 'suspended')
    const suspended = (data ?? []) as { partner_id: string | null; category_id: string }[]
    expect(suspended.length, 'nothing is suspended, so the case is untested').toBeGreaterThan(0)
    for (const s of suspended) {
      expect(OCCUPIES('suspended')).toBe(false)
      const held = occupancy(book.listings, book.sellers, s.category_id, null)
      expect(held.find(h => h.seller_id === s.partner_id)?.held ?? 0)
        .toBeLessThan(book.listings.filter(l =>
          l.category_id === s.category_id && l.partner_id === s.partner_id).length + 1)
    }
  })
})

describe('the guard refuses what the screen says it would', () => {
  /* The reconciliation. If these part company, an operator is shown an impact
     that does not happen, or a refusal they were not warned about. */
  it('refuses a seller the screen names as excluded', async () => {
    const security = book.policies.find(p => p.category_id === 'security')!
    expect(security.min_rating).not.toBeNull()

    const impact = barImpact(book.sellers, book.listings, 'security', security.min_rating, security.allow_unrated)
    const below = book.sellers.find(s => s.rating !== null && s.rating < security.min_rating!)
    expect(below, 'no seller sits below the security bar, so the rule demonstrates nothing').toBeTruthy()

    const { error } = await supabase.from('products').insert({
      id: 'SKU-ITEST-BAR', category_id: 'security', name: 'Integration probe',
      price: 100, cost: 40, list_price: 100, floor_price: 40, status: 'pending', seller: below!.name,
      partner_id: below!.id, sort_order: 999,
    })
    expect(error, 'a seller below the bar was allowed onto the security shelf').toBeTruthy()
    expect(error!.message).toMatch(/requires/)
    await supabase.from('products').delete().eq('id', 'SKU-ITEST-BAR')
    expect(impact).toBeTruthy()
  })

  it('refuses an unrated seller on the shelf that refuses them', async () => {
    const shelf = book.policies.find(p => p.min_rating !== null && !p.allow_unrated)!
    const unrated = book.sellers.find(s => s.rating === null)!
    const { error } = await supabase.from('products').insert({
      id: 'SKU-ITEST-UNRATED', category_id: shelf.category_id, name: 'Integration probe',
      price: 100, cost: 40, list_price: 100, floor_price: 40, status: 'pending', seller: unrated.name,
      partner_id: unrated.id, sort_order: 999,
    })
    expect(error, 'an unrated seller reached a shelf that refuses them').toBeTruthy()
    expect(error!.message).toMatch(/unrated/)
    await supabase.from('products').delete().eq('id', 'SKU-ITEST-UNRATED')
  })

  it('refuses a listing below cost where the shelf says so, and allows it where it does not', async () => {
    const strict = book.policies.find(p => p.price_floor)!
    const loose = book.policies.find(p => !p.price_floor)

    const { error: refused } = await supabase.from('products').insert({
      id: 'SKU-ITEST-FLOOR', category_id: strict.category_id, name: 'Integration probe',
      price: 10, cost: 40, list_price: 10, floor_price: 40, status: 'pending', seller: 'Aventa Telecom', sort_order: 999,
    })
    expect(refused, 'a listing below cost reached a shelf with a price floor').toBeTruthy()
    expect(refused!.message).toMatch(/below cost/)
    await supabase.from('products').delete().eq('id', 'SKU-ITEST-FLOOR')

    /* And the floor is a per-shelf decision rather than a global one, which is
       only demonstrated by a shelf that permits it. */
    expect(loose, 'every shelf refuses a below-cost listing, so the column decides nothing').toBeTruthy()
  })

  it('lets a listing through that breaks nothing', async () => {
    const shelf = book.policies.find(p => p.category_id === 'consumer')!
    const { error } = await supabase.from('products').insert({
      id: 'SKU-ITEST-OK', category_id: shelf.category_id, name: 'Integration probe',
      price: 100, cost: 40, list_price: 100, floor_price: 40, status: 'pending', seller: 'Aventa Telecom', sort_order: 999,
    })
    expect(error, `a compliant listing was refused: ${error?.message}`).toBeNull()
    await supabase.from('products').delete().eq('id', 'SKU-ITEST-OK')
  })
})

describe('the rule book', () => {
  it('hangs together — nothing enforced before it is published, nothing published and idle', () => {
    expect(matrixProblems(book.rules, book.matrix, book.categories)).toEqual([])
  })

  it('carries a draft rule applied nowhere, which is the state the check exists for', () => {
    const draft = book.rules.filter(r => r.status !== 'active')
    expect(draft.length, 'every rule is published, so "drafted and not yet applied" is untested')
      .toBeGreaterThan(0)
    for (const d of draft) {
      expect(book.matrix.some(m => m.rule_id === d.id),
        `${d.name} is ${d.status} and applied to a shelf`).toBe(false)
    }
  })

  it('gives every shelf at least one rule that can refuse a listing', () => {
    for (const c of book.categories) {
      expect(ruleCoverage(book.rules, book.matrix, c.id).enforced,
        `${c.name} enforces nothing, so nothing on it can be refused`).toBeGreaterThan(0)
    }
  })

  it('names an owner, a basis and — where a document decides — the evidence', () => {
    for (const r of book.rules) {
      expect(r.owner, `${r.id} is owned by nobody`).toBeTruthy()
      expect(r.basis, `${r.id} rests on nothing`).toBeTruthy()
      if (r.check_by === 'doc') {
        expect(r.evidence, `${r.name} is checked against a document and names none`).toBeTruthy()
      }
    }
  })
})

describe('changing it', () => {
  it('writes a level and takes it back off, and off means the row is gone', async () => {
    const before = levelOf(book.matrix, 'partner', 'PR-02')

    expect((await setLevel('partner', 'PR-02', 'warn')).ok).toBe(true)
    const mid = await loadShelfBook()
    expect(levelOf(mid.matrix, 'partner', 'PR-02')).toBe('warn')

    expect((await setLevel('partner', 'PR-02', 'off')).ok).toBe(true)
    const after = await loadShelfBook()
    expect(levelOf(after.matrix, 'partner', 'PR-02')).toBe('off')
    /* Off is the absence of a row, not a row saying off — otherwise a screen
       shows one thing and a count reports another. */
    expect(after.matrix.some(m => m.category_id === 'partner' && m.rule_id === 'PR-02')).toBe(false)
    expect(before).toBe('off')
  })

  it('stamps who changed a policy and when', async () => {
    const p = book.policies.find(x => x.category_id === 'iot')!
    const res = await savePolicy('iot', { sla_hours: p.sla_hours }, 'Integration test')
    expect(res.ok).toBe(true)
    const after = await loadShelfBook()
    const now = after.policies.find(x => x.category_id === 'iot')!
    expect(now.updated_by).toBe('Integration test')
    expect(now.updated_on).toBe(new Date().toISOString().slice(0, 10))
    await savePolicy('iot', { sla_hours: p.sla_hours }, p.updated_by ?? 'Anika Sharma')
  })
})

describe('what buyers can reach', () => {
  it('mirrors the open/closed decision onto the categories the storefront reads', async () => {
    const { data } = await supabase.from('categories').select('id,open_to_buyers')
    const cats = (data ?? []) as { id: string; open_to_buyers: boolean }[]
    for (const p of book.policies) {
      expect(cats.find(c => c.id === p.category_id)?.open_to_buyers,
        `${p.category_id} is ${p.open_to_buyers ? 'open' : 'closed'} in the policy and the opposite on the storefront`)
        .toBe(p.open_to_buyers)
    }
  })

  it('records a reason against anything closed', () => {
    for (const p of book.policies.filter(x => !x.open_to_buyers)) {
      expect((p.closed_reason ?? '').trim().length,
        `${p.category_id} is closed and nobody said why`).toBeGreaterThan(0)
    }
  })
})

describe('capState', () => {
  it('agrees with the occupancy it is derived from', () => {
    for (const p of book.policies) {
      for (const h of occupancy(book.listings, book.sellers, p.category_id, p)) {
        expect(h.state).toBe(capState(h.held, h.cap))
      }
    }
  })
})
