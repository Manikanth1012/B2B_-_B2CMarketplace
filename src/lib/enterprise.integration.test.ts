/* Touches the live Supabase project.
 *
 * Two claims are being tested here, and neither can be tested against a mock.
 * The first is isolation: an enterprise buyer sees their own account and no
 * other, which is RLS. The second is separation of duties: the procurement
 * lead sits at the top of the hierarchy and still cannot approve their own
 * requisition, which is a trigger. Both live in the database precisely so that
 * a client cannot go round them, so both have to be checked from a client.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadAccount, decideRequisition, savePolicy, payInvoice, invoiceCsv } from './enterpriseRepo'
import type { AccountBook } from './enterpriseRepo'
import { loadAccountRefunds } from './refundRepo'
import {
  needFor, waiting, canDecide, whoCanDecide, reconcileInvoice, outstanding,
  committed, budgetPosition, centreUse, bySeller, spentThisYear, duplicatesOf,
} from './enterprise'
import type { Requisition } from './enterprise'

const ENTERPRISE = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const OPERATOR   = { email: 'anika.sharma@aventa.com',   password: 'operator123' }
const PARTNER    = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const ACCOUNT = 'ENT-2007'

describe('the account, as the procurement lead sees it', () => {
  let book: AccountBook

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadAccount()
    expect(book.loadError).toBeUndefined()
  })

  afterAll(async () => { await signOut() })

  it('knows which account, and which person on it', () => {
    expect(book.account?.id).toBe(ACCOUNT)
    expect(book.me?.role).toBe('procurement-lead')
    expect(book.me?.name).toBe('Vikram Shah')
  })

  it('sees only its own account, whatever it asks for', async () => {
    const { data } = await supabase.from('enterprise_accounts').select('id')
    expect(data!.map(a => a.id)).toEqual([ACCOUNT])
  })

  it('sees only its own colleagues, requisitions, invoices and subscriptions', () => {
    expect(book.members.every(m => m.account_id === ACCOUNT)).toBe(true)
    expect(book.requisitions.every(r => r.account_id === ACCOUNT)).toBe(true)
    expect(book.invoices.every(i => i.account_id === ACCOUNT)).toBe(true)
    expect(book.subscriptions.every(s => s.account_id === ACCOUNT)).toBe(true)
    expect(book.members.length).toBeGreaterThan(3)
  })

  it('has both an approver who can and colleagues who cannot', () => {
    expect(book.members.filter(m => m.approves_finance).length).toBeGreaterThan(0)
    expect(book.members.filter(m => !m.approves_finance && !m.approves_it).length).toBeGreaterThan(0)
  })

  it('marks every requisition with what the policy in force asked for', () => {
    for (const r of book.requisitions) {
      expect(needFor(r, book.policy!), `${r.id}`).toBe(r.need)
    }
  })

  it('has requisitions equal to the sum of their lines', () => {
    for (const r of book.requisitions) {
      const sum = book.lines.filter(l => l.requisition_id === r.id)
        .reduce((a, l) => a + Number(l.line_total), 0)
      expect(Math.round(sum * 100) / 100, `${r.id}`).toBe(Number(r.amount))
    }
  })

  it('has a queue with something the lead can act on', () => {
    const queue = waiting(book.requisitions)
    expect(queue.length).toBeGreaterThan(0)
    expect(queue.some(r => canDecide(r, book.me!, book.policy!).ok)).toBe(true)
  })

  it('refuses the lead their own requisition, and names who can take it', () => {
    const mine = waiting(book.requisitions).find(r => r.raised_by === book.me!.id)
    expect(mine, 'the demo account has no requisition raised by the lead').toBeTruthy()
    const c = canDecide(mine!, book.me!, book.policy!)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/separation of duties/)
    /* And somebody else genuinely can, or the policy is unworkable rather than
       strict. */
    expect(whoCanDecide(mine!, book.members, book.policy!).length).toBeGreaterThan(0)
  })

  it('never recorded a decision by the person who asked', () => {
    for (const r of book.requisitions) {
      if (r.decided_by) expect(r.decided_by, `${r.id}`).not.toBe(r.raised_by)
    }
  })

  it('has every approval sitting behind a real order', () => {
    for (const r of book.requisitions.filter(r => r.state === 'approved')) {
      expect(r.order_ref, `${r.id} was approved but never ordered`).toBeTruthy()
    }
  })

  it('gives every decline a written reason', () => {
    for (const r of book.requisitions.filter(r => r.state === 'declined')) {
      expect(r.decision_note, `${r.id}`).toBeTruthy()
    }
  })

  it('flags a request for something the account already holds', () => {
    const dup = book.requisitions.find(r => r.id === 'REQ-5514')
    expect(dup).toBeTruthy()
    const lines = book.lines.filter(l => l.requisition_id === dup!.id)
    expect(duplicatesOf(lines, book.subscriptions).length).toBeGreaterThan(0)
  })
})

/* --------------------------------------------------------------- billing -- */

describe('what the account is billed', () => {
  let book: AccountBook

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadAccount()
  })

  afterAll(async () => { await signOut() })

  it('reconciles every invoice to the lines behind it', () => {
    expect(book.invoices.length).toBeGreaterThan(3)
    for (const i of book.invoices) {
      const c = reconcileInvoice(i, book.invoiceLines)
      expect(c.ok, c.ok ? '' : c.reason).toBe(true)
    }
  })

  it('bills exactly what the account holds on the current recurring invoice', () => {
    const current = book.invoices
      .filter(i => i.kind === 'recurring')
      .sort((a, b) => b.issued.localeCompare(a.issued))[0]
    const billed = book.invoiceLines
      .filter(l => l.invoice_id === current.id && l.kind === 'subscription')
      .reduce((a, l) => a + Number(l.amount), 0)
    expect(Math.round(billed * 100) / 100).toBe(committed(book.subscriptions).billed)
  })

  it('has an outstanding balance with something overdue behind it', () => {
    const due = outstanding(book.invoices)
    expect(due.total).toBeGreaterThan(0)
    expect(due.overdue).toBeGreaterThan(0)
  })

  it('agrees with itself about budget: spend equals the invoices issued this year', () => {
    const p = budgetPosition(book.invoices, book.account!, '2026-08-01')
    expect(p.spent).toBe(spentThisYear(book.invoices, book.account!))
    expect(p.pct).toBeGreaterThan(0)
    expect(p.left).toBe(Math.round((p.budget - p.spent) * 100) / 100)
  })

  it('spreads the invoice across more than one seller, which is the whole point', () => {
    const current = book.invoices.filter(i => i.kind === 'recurring')
      .sort((a, b) => b.issued.localeCompare(a.issued))[0]
    const sellers = bySeller(book.invoiceLines.filter(l => l.invoice_id === current.id))
    expect(sellers.length).toBeGreaterThan(1)
    expect(Math.round(sellers.reduce((a, r) => a + r.share, 0))).toBe(100)
  })

  it('exports a bill whose lines add to the total it prints', () => {
    const i = book.invoices[0]
    const csv = invoiceCsv(i, book.invoiceLines)
    expect(csv.split('\n')[0]).toMatch(/^Line,Kind,Description/)
    expect(csv).toContain(i.total.toFixed(2))
  })

  it('keeps every cost centre inside a cap somebody set', () => {
    expect(book.centres.length).toBeGreaterThan(0)
    for (const c of book.centres) {
      expect(centreUse(c).pct, `${c.id}`).toBeLessThanOrEqual(100)
    }
  })

  it('has one cost centre close enough to its cap to be worth an alert', () => {
    expect(book.centres.some(c => centreUse(c).pct >= 90)).toBe(true)
  })
})

/* --------------------------------------------------------------- refunds -- */

describe('what the account got back', () => {
  beforeAll(async () => { await signIn(ENTERPRISE.email, ENTERPRISE.password) })
  afterAll(async () => { await signOut() })

  it('sees its own refunds and nobody else\'s', async () => {
    const { data } = await supabase.from('refunds').select('id,account_id,customer')
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every(r => r.account_id === ACCOUNT)).toBe(true)
  })

  it('has something waiting and something the clock ran out on', async () => {
    const book = await loadAccountRefunds(ACCOUNT)
    expect(book.loadError).toBeUndefined()
    expect(book.policy).toBeTruthy()
    expect(book.refunds.some(r => r.state === 'requested')).toBe(true)
    expect(book.refunds.some(r => r.state === 'escalated')).toBe(true)
  })

  it('records why anything escalated did', async () => {
    const book = await loadAccountRefunds(ACCOUNT)
    for (const r of book.refunds.filter(r => r.state === 'escalated')) {
      expect(r.escalated_why, `${r.id}`).toBeTruthy()
    }
  })

  it('cannot decide its own refund — that belongs to the seller', async () => {
    const book = await loadAccountRefunds(ACCOUNT)
    const open = book.refunds.find(r => r.state === 'requested')!
    await supabase.from('refunds')
      .update({ state: 'refunded', refunded: open.amount }).eq('id', open.id)
    const { data } = await supabase.from('refunds').select('state').eq('id', open.id).single()
    expect(data!.state, 'a buyer approved their own refund').toBe('requested')
  })
})

/* -------------------------------------------------- what nobody else sees -- */

describe('isolation from the other consoles', () => {
  afterAll(async () => { await signOut() })

  it('shows a seller nothing of the buyer\'s account', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const [acct, reqs, inv] = await Promise.all([
      supabase.from('enterprise_accounts').select('id'),
      supabase.from('enterprise_requisitions').select('id'),
      supabase.from('enterprise_invoices').select('id'),
    ])
    expect(acct.data ?? []).toEqual([])
    expect(reqs.data ?? []).toEqual([])
    expect(inv.data ?? []).toEqual([])
    await signOut()
  })

  it('shows the marketplace every account, because somebody has to support them', async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data } = await supabase.from('enterprise_accounts').select('id')
    expect(data!.length).toBeGreaterThan(1)
    await signOut()
  })
})

/* ---------------------------------------------- deciding, for real, twice -- */

describe('a decision, made and put back', () => {
  let book: AccountBook
  let target: Requisition

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadAccount()
    /* Something the lead may genuinely decide: not theirs, still pending. */
    target = waiting(book.requisitions).find(r => canDecide(r, book.me!, book.policy!).ok)!
    expect(target, 'nothing on the account is decidable by the lead').toBeTruthy()
  })

  afterAll(async () => {
    /* Put the demo account back — as the operator, because `guard_requisition`
       refuses to re-open a decision for the account that made it, which is
       exactly the behaviour the test above relies on. A buyer cannot undo their
       own approval and should not be able to. */
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    await supabase.from('enterprise_requisitions').update({
      state: 'pending', decided_by: null, decided_on: null, decision_note: null, order_ref: null,
    }).eq('id', target.id)
    await signOut()
  })

  it('approves it, stamps who decided, and places the order in the same write', async () => {
    const res = await decideRequisition({
      req: target, me: book.me!, policy: book.policy!, approve: true, note: 'Approved for the integration test.',
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadAccount()
    const saved = after.requisitions.find(r => r.id === target.id)!
    expect(saved.state).toBe('approved')
    expect(saved.decided_by).toBe(book.me!.id)
    expect(saved.decided_on).toBeTruthy()
    expect(saved.order_ref).toBeTruthy()
  })

  it('refuses to re-open what it just decided', async () => {
    const after = await loadAccount()
    const saved = after.requisitions.find(r => r.id === target.id)!
    const res = await decideRequisition({
      req: saved, me: after.me!, policy: after.policy!, approve: false, note: 'changed my mind',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/already approved|not re-openable/i)
  })
})

describe('what the database refuses whatever the screen says', () => {
  let book: AccountBook

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadAccount()
  })

  afterAll(async () => { await signOut() })

  it('will not let the lead approve their own, straight through the API', async () => {
    const mine = waiting(book.requisitions).find(r => r.raised_by === book.me!.id)!
    const { error } = await supabase.from('enterprise_requisitions')
      .update({ state: 'approved' }).eq('id', mine.id)
    expect(error, 'the database allowed a self-approval').toBeTruthy()
    expect(error!.message).toMatch(/separation of duties/i)

    const { data } = await supabase.from('enterprise_requisitions').select('state').eq('id', mine.id).single()
    expect(data!.state).toBe('pending')
  })

  it('will not let a requisition be raised already approved', async () => {
    const { error } = await supabase.from('enterprise_requisitions').insert({
      id: `REQ-TEST-${Date.now()}`, account_id: ACCOUNT, raised_by: book.me!.id,
      raised_on: '2026-08-01', raised_at: 'now', title: 'x', vertical: 'iot',
      cost_centre: 'CC-1000', amount: 10, model: 'oneoff', reason: 'x',
      need: 'none', policy_note: 'x', state: 'approved',
    })
    expect(error).toBeTruthy()
  })

  it('will not let the account write itself a requisition on somebody else\'s', async () => {
    const { error } = await supabase.from('enterprise_requisitions').insert({
      id: `REQ-TEST-${Date.now()}`, account_id: 'ENT-2011', raised_by: book.me!.id,
      raised_on: '2026-08-01', raised_at: 'now', title: 'x', vertical: 'iot',
      cost_centre: null, amount: 10, model: 'oneoff', reason: 'x',
      need: 'none', policy_note: 'x', state: 'pending',
    })
    expect(error, 'a buyer raised a requisition on another company').toBeTruthy()
  })

  it('will not let a colleague who is not the lead change the policy', async () => {
    const notLead = { ...book.me!, role: 'buyer' as const }
    const res = await savePolicy(book.policy!, notLead)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/Only the procurement lead/)
  })

  it('lets the lead change the policy and put it back', async () => {
    const original = book.policy!
    const res = await savePolicy({ ...original, threshold: 2500 }, book.me!)
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadAccount()
    expect(Number(after.policy!.threshold)).toBe(2500)

    const back = await savePolicy(original, book.me!)
    expect(back.ok).toBe(true)
    const restored = await loadAccount()
    expect(Number(restored.policy!.threshold)).toBe(Number(original.threshold))
  })
})

describe('paying an invoice', () => {
  let target: string | null = null

  beforeAll(async () => { await signIn(ENTERPRISE.email, ENTERPRISE.password) })

  /* Restoring here rather than at the end of the test body, so a failing
     assertion cannot leave the demo account with a paid invoice. */
  afterAll(async () => {
    if (target) {
      await supabase.from('enterprise_invoices')
        .update({ status: 'open', paid_on: null }).eq('id', target)
    }
    await signOut()
  })

  it('marks it paid, refuses to pay it twice, and does not touch the amount', async () => {
    const book = await loadAccount()
    const open = book.invoices.find(i => i.status === 'open')!
    expect(open, 'the demo account has no unpaid invoice').toBeTruthy()
    target = open.id

    const res = await payInvoice(open)
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadAccount()
    const paid = after.invoices.find(i => i.id === open.id)!
    expect(paid.status).toBe('paid')
    expect(paid.paid_on).toBeTruthy()
    expect(Number(paid.total)).toBe(Number(open.total))

    const again = await payInvoice(paid)
    expect(again.ok).toBe(false)
  })

  it('refuses to let a buyer rewrite what an invoice says it costs', async () => {
    const book = await loadAccount()
    const any = book.invoices[0]
    await supabase.from('enterprise_invoices')
      .update({ total: 1, recurring: 1, oneoff: 0, tax: 0 }).eq('id', any.id)
    const after = await loadAccount()
    expect(Number(after.invoices.find(i => i.id === any.id)!.total)).toBe(Number(any.total))
  })
})
