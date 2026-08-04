/* Touches the live Supabase project. Raises requisitions and removes them.
 *
 * The claim under test cannot be checked from a mock, because it is an RLS one:
 * `enterprise_requisitions` has always carried a write policy for the account
 * and `enterprise_requisition_lines` carried only a read one, so
 * `raiseRequisition` inserted a header, was refused its lines, deleted the
 * header again and reported failure. It had never once completed for the
 * persona it was written for. Nothing was left behind to notice.
 *
 * So this checks both halves. That a business buyer can raise a requisition
 * with lines on it — the half that was broken — and that they still cannot
 * touch the lines of one that has already been decided, which is the half a
 * blanket "let them write" would have quietly given away.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadAccount, raiseRequisition, loadEnterpriseCatalogue } from './enterpriseRepo'
import type { AccountBook } from './enterpriseRepo'

const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }

/* Every requisition this file raises carries the marker in its title, so the
   sweep can find them however the run ended. */
const MARKER = '[integration]'

let book: AccountBook
const raised: string[] = []

async function sweep() {
  const { data } = await supabase.from('enterprise_requisitions')
    .select('id, title').like('title', `%${MARKER}%`)
  for (const r of (data ?? []) as { id: string }[]) {
    /* Lines go with it — the foreign key cascades.

       The result is checked. It was not, and that hid a real bug for a whole
       run: `guard_requisition_line` was refusing the cascade, so every delete
       here removed nothing and reported nothing, the rows accumulated, and the
       failure surfaced two files away as a count that was one too high. A sweep
       that cannot fail is not a sweep. */
    const { data: gone, error } = await supabase.from('enterprise_requisitions')
      .delete().eq('id', r.id).select('id')
    if (error) throw new Error(`could not sweep ${r.id}: ${error.message}`)
    if (!gone?.length) throw new Error(`sweeping ${r.id} removed nothing — it is still there`)
  }
}

beforeAll(async () => {
  await signOut()
  await signIn(BUYER.email, BUYER.password)
  book = await loadAccount()
  expect(book.account, 'the buyer did not load an account').toBeTruthy()
  expect(book.me, 'the buyer is not on the account').toBeTruthy()
  await sweep()
}, 60000)

afterAll(async () => {
  await sweep()
  await signOut()
}, 60000)

function draftOf(lines: { product_id: string; name: string; seller: string; partner_id: string | null; quantity: number; unit_price: number }[], over: Record<string, unknown> = {}) {
  return {
    title: `Cold-chain rollout ${MARKER}`,
    reason: 'Depot 4 opens in September and the estate plan carries these.',
    currency: book.account!.currency,
    vertical: 'device',
    cost_centre: book.centres[0]?.id ?? null,
    model: 'oneoff' as const,
    /* This account requires one on every invoice, and `raiseRequisition`
       refuses without it — which is itself worth exercising below. */
    po_ref: 'PO-INTEGRATION',
    lines,
    ...over,
  }
}

describe('a business buyer raises a requisition', () => {
  it('writes the requisition and every line on it', async () => {
    const shelf = await loadEnterpriseCatalogue(book.account!.currency)
    const a = shelf.find(p => p.id === 'SKU-4003')!
    const b = shelf.find(p => p.id === 'SKU-5003')!
    expect(a && b, 'the shelf did not carry the two SKUs this test buys').toBeTruthy()

    const res = await raiseRequisition({
      draft: draftOf([
        { product_id: a.id, name: a.name, seller: a.seller, partner_id: a.partner_id, quantity: 3, unit_price: a.price },
        { product_id: b.id, name: b.name, seller: b.seller, partner_id: b.partner_id, quantity: 2, unit_price: b.price },
      ]),
      me: book.me!, account: book.account!, policy: book.policy!,
      currencies: book.currencies, rates: book.rates,
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    /* Read it back rather than trusting the return value. The bug this file
       exists for returned a failure honestly; a version that returned success
       while the lines were refused is exactly what a header-only check would
       have missed. */
    const { data } = await supabase.from('enterprise_requisitions')
      .select('id, amount, currency, state, need, model, po_ref').like('title', `%${MARKER}%`)
    const rows = (data ?? []) as { id: string; amount: number; currency: string; state: string; need: string; model: string; po_ref: string }[]
    expect(rows.length, 'no requisition was written').toBe(1)
    raised.push(rows[0].id)

    expect(rows[0].state).toBe('pending')
    expect(rows[0].currency).toBe(book.account!.currency)
    expect(rows[0].po_ref).toBe('PO-INTEGRATION')

    const { data: lines } = await supabase.from('enterprise_requisition_lines')
      .select('product_id, quantity, unit_price, line_total').eq('requisition_id', rows[0].id)
    const ls = (lines ?? []) as { product_id: string; quantity: number; unit_price: number; line_total: number }[]
    expect(ls.length, 'the requisition was written with no lines on it').toBe(2)

    /* The total is the lines', not a separately supplied number. */
    const sum = ls.reduce((s, l) => s + Number(l.line_total), 0)
    expect(Number(rows[0].amount)).toBeCloseTo(sum, 2)
    expect(Number(rows[0].amount)).toBeCloseTo(3 * a.price + 2 * b.price, 2)
  }, 90000)

  it('records what the policy asked for, worked out at the time', async () => {
    const { data } = await supabase.from('enterprise_requisitions')
      .select('need, policy_note, amount').like('title', `%${MARKER}%`).maybeSingle()
    const r = data as { need: string; policy_note: string; amount: number } | null
    expect(r).toBeTruthy()
    /* Whatever it came to, `need` and the note have to agree with the
       threshold — a note that says one thing while `need` says another is what
       an approver reads and acts on. */
    const over = Number(r!.amount) >= Number(book.policy!.threshold)
    expect(r!.need === 'none' ? !over : over || r!.need === 'it').toBe(true)
    expect(r!.policy_note.length, 'the requisition carries no policy note').toBeGreaterThan(0)
  }, 30000)

  it('will not let the buyer add a line to a requisition already decided', async () => {
    /* The refusal a blanket write policy would have given away. An approver who
       signed off a figure must not find the lines behind it changed
       afterwards. */
    const { data } = await supabase.from('enterprise_requisitions')
      .select('id, state').neq('state', 'pending').limit(1).maybeSingle()
    const decided = data as { id: string; state: string } | null
    expect(decided, 'no decided requisition on file, so this checked nothing').toBeTruthy()

    const { error } = await supabase.from('enterprise_requisition_lines').insert({
      id: `RL-INTEGRATION-${Date.now()}`, requisition_id: decided!.id,
      product_id: 'SKU-4003', name: 'Smuggled line', seller: 'Kestrel Devices',
      partner_id: null, quantity: 1, unit_price: 1, line_total: 1, sort_order: 99,
    })
    expect(error, 'a line was added to a decided requisition').not.toBeNull()
    expect(error!.message).toMatch(/already|cannot be changed|row-level security/i)

    /* And nothing landed. A refusal that still wrote the row would pass the
       assertion above on the error alone. */
    const { data: after } = await supabase.from('enterprise_requisition_lines')
      .select('id').eq('requisition_id', decided!.id).like('id', 'RL-INTEGRATION-%')
    expect((after ?? []).length).toBe(0)
  }, 30000)

  it('lets the buyer correct a line while it is still pending', async () => {
    /* The other side of the same rule — the write policy is not a formality,
       it is what makes a draft editable at all. */
    expect(raised.length, 'nothing was raised, so this checked nothing').toBeGreaterThan(0)
    const { data } = await supabase.from('enterprise_requisition_lines')
      .select('id, quantity').eq('requisition_id', raised[0]).limit(1).maybeSingle()
    const line = data as { id: string; quantity: number } | null
    expect(line).toBeTruthy()

    const { data: up, error } = await supabase.from('enterprise_requisition_lines')
      .update({ quantity: line!.quantity + 1, line_total: 0 })
      .eq('id', line!.id).select('id')
    /* The line_total check constraint refuses a total that disagrees with the
       quantity, so this particular update is meant to fail on arithmetic
       rather than on permission — which is the distinction being drawn. */
    expect(error?.message ?? '', 'the buyer was refused on permission, not arithmetic')
      .not.toMatch(/row-level security|policy/i)
    if (!error) expect((up ?? []).length).toBe(1)
  }, 30000)

  it('refuses without the purchase order this account requires', async () => {
    const shelf = await loadEnterpriseCatalogue(book.account!.currency)
    const a = shelf.find(p => p.id === 'SKU-4003')!
    const res = await raiseRequisition({
      draft: draftOf(
        [{ product_id: a.id, name: a.name, seller: a.seller, partner_id: a.partner_id, quantity: 1, unit_price: a.price }],
        { po_ref: '   ' },
      ),
      me: book.me!, account: book.account!, policy: book.policy!,
      currencies: book.currencies, rates: book.rates,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/purchase order/i)
  }, 60000)

  it('refuses a currency the account\'s market does not trade in', async () => {
    const shelf = await loadEnterpriseCatalogue(book.account!.currency)
    const a = shelf.find(p => p.id === 'SKU-4003')!
    const res = await raiseRequisition({
      draft: draftOf(
        [{ product_id: a.id, name: a.name, seller: a.seller, partner_id: a.partner_id, quantity: 1, unit_price: a.price }],
        { currency: 'GBP' },
      ),
      me: book.me!, account: book.account!, policy: book.policy!,
      currencies: book.currencies, rates: book.rates,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/GBP/)
  }, 60000)

  it('leaves nothing behind that no sweep will find', async () => {
    /* Anything raised today has to carry a marker of some kind, because a row
       written under a plain title is one no sweep looks for and it becomes
       permanent seeded data by accident.

       Deliberately not "carries *this* file's marker": `requisitionScope`
       raises its own against the same account on the same day, and a check that
       insisted on `[integration]` would fail on a sibling doing exactly the
       right thing. */
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase.from('enterprise_requisitions')
      .select('id, title').eq('raised_on', today)
    const strays = ((data ?? []) as { id: string; title: string }[])
      .filter(r => !/\[[a-z]+\]/.test(r.title))
    expect(strays.map(r => `${r.id} ${r.title}`), 'a requisition was raised with no test marker on it').toEqual([])
  }, 30000)
})
