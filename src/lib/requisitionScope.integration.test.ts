/* Touches the live Supabase project. Raises requisitions on two accounts and
 * removes them.
 *
 * Everything here needs two businesses to mean anything. Until Meridian had a
 * login, "an account cannot reach another account's records" could only be
 * asked of SmartBuild about SmartBuild's own rows — which a policy that scopes
 * nothing passes just as well as one that scopes correctly.
 *
 * So each test below is run from one account against the other's data, and the
 * permission half is always checked alongside the refusal: a buyer who can see
 * nothing at all would satisfy every "cannot see the other one" assertion ever
 * written.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadAccount, raiseRequisition, loadEnterpriseCatalogue } from './enterpriseRepo'
import type { AccountBook } from './enterpriseRepo'

const SMARTBUILD = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123', account: 'ENT-2007' }
const MERIDIAN = { email: 'omar.haddad@meridianfoods.ae', password: 'enterprise123', account: 'ENT-2012' }

const MARKER = '[scope]'

/** Whatever either account left behind, removed as the account that owns it. */
async function sweep() {
  for (const who of [SMARTBUILD, MERIDIAN]) {
    await signOut()
    await signIn(who.email, who.password)
    const { data } = await supabase.from('enterprise_requisitions')
      .select('id').like('title', `%${MARKER}%`)
    for (const r of (data ?? []) as { id: string }[]) {
      /* Checked, for the reason `requisitionRaise` records: a delete that
         quietly removes nothing leaves the next run to fail on a count. */
      const { data: gone, error } = await supabase.from('enterprise_requisitions')
        .delete().eq('id', r.id).select('id')
      if (error) throw new Error(`could not sweep ${r.id}: ${error.message}`)
      if (!gone?.length) throw new Error(`sweeping ${r.id} removed nothing — it is still there`)
    }
  }
  await signOut()
}

async function raiseAs(who: typeof SMARTBUILD, title: string): Promise<{ book: AccountBook; id: string }> {
  await signOut()
  await signIn(who.email, who.password)
  const book = await loadAccount()
  expect(book.account?.id, `${who.email} did not load ${who.account}`).toBe(who.account)
  const shelf = await loadEnterpriseCatalogue(book.account!.currency)
  const p = shelf.find(x => x.id === 'SKU-4008') ?? shelf[0]
  const res = await raiseRequisition({
    draft: {
      title: `${title} ${MARKER}`, reason: 'Raised by the scope test.',
      currency: book.account!.currency, vertical: 'device',
      cost_centre: book.centres[0]?.id ?? null, model: 'oneoff',
      po_ref: 'PO-SCOPE',
      lines: [{ product_id: p.id, name: p.name, seller: p.seller, partner_id: p.partner_id, quantity: 1, unit_price: p.price }],
    },
    me: book.me!, account: book.account!, policy: book.policy!,
    currencies: book.currencies, rates: book.rates,
  })
  expect(res.ok, res.ok ? '' : res.reason).toBe(true)
  const { data } = await supabase.from('enterprise_requisitions')
    .select('id').like('title', `%${title} ${MARKER}%`).maybeSingle()
  const row = data as { id: string } | null
  expect(row, 'the requisition was not written').toBeTruthy()
  return { book, id: row!.id }
}

let smartbuildReq = ''
let meridianReq = ''

beforeAll(async () => {
  await sweep()
  smartbuildReq = (await raiseAs(SMARTBUILD, 'SmartBuild scope')).id
  meridianReq = (await raiseAs(MERIDIAN, 'Meridian scope')).id
  expect(smartbuildReq).not.toBe(meridianReq)
}, 180000)

afterAll(async () => { await sweep() }, 120000)

describe('two businesses on one marketplace', () => {
  it('gives each of them their own account, not the first one on file', async () => {
    /* The permission half, and the thing that would have made every test below
       vacuous: if the second login had landed on SmartBuild's account, the
       refusals would all pass for the wrong reason. */
    await signOut()
    await signIn(MERIDIAN.email, MERIDIAN.password)
    const { data } = await supabase.from('enterprise_accounts').select('id, company, market, currency')
    const rows = (data ?? []) as { id: string; company: string; market: string; currency: string }[]
    expect(rows.length, 'Meridian sees more than its own account').toBe(1)
    expect(rows[0].id).toBe(MERIDIAN.account)
    expect(rows[0].market).toBe('AE')
    expect(rows[0].currency).toBe('AED')
  }, 60000)

  it('shows each buyer their own requisitions and none of the other\'s', async () => {
    await signOut()
    await signIn(MERIDIAN.email, MERIDIAN.password)
    const { data } = await supabase.from('enterprise_requisitions').select('id, account_id')
    const mine = (data ?? []) as { id: string; account_id: string }[]

    /* Both halves in one assertion pair: theirs is visible (so the read works
       at all) and SmartBuild's eleven are not. */
    expect(mine.map(r => r.id), 'Meridian cannot see its own requisition').toContain(meridianReq)
    expect(mine.map(r => r.id), 'Meridian can see SmartBuild\'s requisition').not.toContain(smartbuildReq)
    expect(mine.every(r => r.account_id === MERIDIAN.account)).toBe(true)
  }, 60000)

  it('hides the other account\'s requisition lines, not only its headers', async () => {
    /* Worth asking separately. The lines carry the product, the quantity and
       the price paid — a leak here is a competitor's order book even if the
       header is hidden. */
    await signOut()
    await signIn(MERIDIAN.email, MERIDIAN.password)
    const { data } = await supabase.from('enterprise_requisition_lines')
      .select('id, requisition_id').eq('requisition_id', smartbuildReq)
    expect((data ?? []).length, 'Meridian read SmartBuild\'s requisition lines').toBe(0)

    const { data: own } = await supabase.from('enterprise_requisition_lines')
      .select('id').eq('requisition_id', meridianReq)
    expect((own ?? []).length, 'Meridian cannot read its own lines either, so the test proves nothing')
      .toBeGreaterThan(0)
  }, 60000)

  it('refuses a line written into the other account\'s requisition', async () => {
    /* The write policy added alongside this file. It was the missing one — the
       lines table had a read policy and nothing else — and the shape of the fix
       is exactly what could have gone wrong: a policy permissive enough to let
       a buyer write lines could have been permissive enough to let them write
       anybody's. */
    await signOut()
    await signIn(MERIDIAN.email, MERIDIAN.password)
    const { error } = await supabase.from('enterprise_requisition_lines').insert({
      id: `RL-SCOPE-${Date.now()}`, requisition_id: smartbuildReq,
      product_id: 'SKU-4008', name: 'Smuggled line', seller: 'Kestrel Devices',
      partner_id: null, quantity: 1, unit_price: 1, line_total: 1, sort_order: 99,
    })
    expect(error, 'Meridian wrote a line into SmartBuild\'s requisition').not.toBeNull()

    /* And it is not there. Checked as the owner, because Meridian cannot see
       those rows either way and would report success on a blind read. */
    await signOut()
    await signIn(SMARTBUILD.email, SMARTBUILD.password)
    const { data } = await supabase.from('enterprise_requisition_lines')
      .select('id').eq('requisition_id', smartbuildReq).like('id', 'RL-SCOPE-%')
    expect((data ?? []).length, 'the refused line landed anyway').toBe(0)
  }, 90000)

  it('refuses a decision on the other account\'s requisition', async () => {
    await signOut()
    await signIn(MERIDIAN.email, MERIDIAN.password)
    const { data, error } = await supabase.from('enterprise_requisitions')
      .update({ state: 'approved', decision_note: 'Not mine to approve' })
      .eq('id', smartbuildReq).select('id')
    /* RLS narrows rather than raises, so an update that matches nothing comes
       back successful and empty — which is the refusal. */
    expect(error !== null || (data ?? []).length === 0,
      'Meridian decided SmartBuild\'s requisition').toBe(true)

    await signOut()
    await signIn(SMARTBUILD.email, SMARTBUILD.password)
    const { data: still } = await supabase.from('enterprise_requisitions')
      .select('state').eq('id', smartbuildReq).maybeSingle()
    expect((still as { state: string } | null)?.state).toBe('pending')
  }, 90000)

  it('applies each account\'s own approval threshold, not one shared number', async () => {
    /* Meridian's is AED 10,000 and SmartBuild's INR 200,000. If the policy were
       being read from anywhere but the account, this is where it would show. */
    await signOut()
    await signIn(MERIDIAN.email, MERIDIAN.password)
    const m = await loadAccount()
    await signOut()
    await signIn(SMARTBUILD.email, SMARTBUILD.password)
    const s = await loadAccount()

    expect(Number(m.policy!.threshold), 'the two accounts read one threshold')
      .not.toBe(Number(s.policy!.threshold))
    expect(m.policy!.threshold).toBeTruthy()
    expect(s.policy!.threshold).toBeTruthy()
  }, 90000)

  it('offers each account the currencies its own market takes', async () => {
    /* AE trades in AED and USD; IN trades in rupees alone. This is the pair
       that makes the second-currency path reachable at all — until Meridian had
       a login, no signed-in account had a second currency to choose. */
    await signOut()
    await signIn(MERIDIAN.email, MERIDIAN.password)
    const m = await loadAccount()
    expect(m.currencies.length, 'Meridian is offered one currency, so the AE case is still untested')
      .toBeGreaterThan(1)
    expect(m.currencies).toContain('AED')

    await signOut()
    await signIn(SMARTBUILD.email, SMARTBUILD.password)
    const s = await loadAccount()
    expect(s.currencies).toEqual(['INR'])
  }, 90000)

  it('lets a business raise in its market\'s second currency', async () => {
    /* `guard_requisition_currency` has been on the table since it was written
       and has never had a buyer able to exercise it. Meridian raising in USD
       is that path. */
    await signOut()
    await signIn(MERIDIAN.email, MERIDIAN.password)
    const book = await loadAccount()
    const second = book.currencies.find(c => c !== book.account!.currency)!
    expect(second, 'no second currency to raise in').toBeTruthy()

    const shelf = await loadEnterpriseCatalogue(second)
    const p = shelf.find(x => x.id === 'SKU-4008') ?? shelf[0]
    const res = await raiseRequisition({
      draft: {
        title: `Meridian second currency ${MARKER}`, reason: 'Raised in the market\'s other currency.',
        currency: second, vertical: 'device', cost_centre: book.centres[0]?.id ?? null,
        model: 'oneoff', po_ref: 'PO-SCOPE',
        lines: [{ product_id: p.id, name: p.name, seller: p.seller, partner_id: p.partner_id, quantity: 1, unit_price: p.price }],
      },
      me: book.me!, account: book.account!, policy: book.policy!,
      currencies: book.currencies, rates: book.rates,
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const { data } = await supabase.from('enterprise_requisitions')
      .select('currency, amount, policy_note').like('title', '%second currency%').maybeSingle()
    const row = data as { currency: string; amount: number; policy_note: string } | null
    expect(row?.currency, 'it was stored in the account\'s primary currency instead').toBe(second)
    /* The threshold is set in AED and this was raised in USD, so the note has
       to say what it was judged on — a bare "above the threshold" would be
       comparing two different currencies. */
    expect(row!.policy_note.length).toBeGreaterThan(0)
  }, 120000)

  it('refuses a currency the market does not take, whichever account asks', async () => {
    await signOut()
    await signIn(MERIDIAN.email, MERIDIAN.password)
    const book = await loadAccount()
    const shelf = await loadEnterpriseCatalogue(book.account!.currency)
    const p = shelf[0]
    const res = await raiseRequisition({
      draft: {
        title: `Meridian rupees ${MARKER}`, reason: 'AE does not trade in rupees.',
        currency: 'INR', vertical: 'device', cost_centre: book.centres[0]?.id ?? null,
        model: 'oneoff', po_ref: 'PO-SCOPE',
        lines: [{ product_id: p.id, name: p.name, seller: p.seller, partner_id: p.partner_id, quantity: 1, unit_price: p.price }],
      },
      me: book.me!, account: book.account!, policy: book.policy!,
      currencies: book.currencies, rates: book.rates,
    })
    expect(res.ok, 'a UAE account raised a rupee requisition').toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/INR/)
  }, 90000)

  it('raised something on both accounts, so none of this passed vacuously', () => {
    expect(smartbuildReq, 'SmartBuild raised nothing').toBeTruthy()
    expect(meridianReq, 'Meridian raised nothing').toBeTruthy()
  })
})
