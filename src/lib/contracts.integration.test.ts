/* Touches the live Supabase project.
 *
 * An agreement is only an agreement if something refuses without one. Everything
 * else here — the term, the amendments, the signed copy — is paperwork around
 * one moment: an account tries to buy, nothing is in force, and the marketplace
 * says no. So that moment is made for real, on a date this file moves and puts
 * back, rather than by leaving an account permanently locked out so the case can
 * be seen. That was the mistake the credit work made when it put the over-limit
 * example on the demo account.
 *
 * The rest checks the two things that make the moment trustworthy: that the
 * standing the screen draws is the standing the guard reads — one rule, not two
 * that agree today — and that what the agreement settles is settled in one
 * place, because the payment terms sat on two rows before this and had already
 * drifted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import {
  loadContractBook, loadMyContract, renewContract, terminateContract,
  addAmendment, signedCopyUrl,
} from './contractsRepo'
import type { ContractBook } from './contractsRepo'
import {
  standingOf, inForce, daysLeft, noticeBy, whatHappensNext,
  renewalQueue, registerOf, againstTerm, inEffectOrder, contractProblems,
  STANDING_LABEL,
} from './contracts'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const ENTERPRISE = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const TODAY = new Date().toISOString().slice(0, 10)

describe('the register the marketplace works from', () => {
  let book: ContractBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadContractBook()
  })
  afterAll(async () => { await signOut() })

  it('loads', () => {
    expect(book.loadError).toBeUndefined()
    expect(book.contracts.length).toBeGreaterThan(0)
    expect(book.accounts.length).toBeGreaterThan(0)
  })

  /* PostgREST hands numerics back as strings, and a term value compared as one
     is compared alphabetically. */
  it('gives every figure back as a number', () => {
    for (const c of book.contracts) {
      expect(typeof c.days_left, `${c.id} days_left`).toBe('number')
      expect(typeof c.notice_days, `${c.id} notice_days`).toBe('number')
      if (c.term_value !== null) expect(typeof c.term_value, `${c.id} term_value`).toBe('number')
    }
  })

  /* The one that produced all of this: six accounts trading and nothing saying
     on whose authority. */
  it('gives every trading account an agreement in force', () => {
    for (const a of book.accounts.filter(x => x.status === 'active')) {
      const live = book.contracts.filter(c => c.account_id === a.id && c.in_force)
      expect(live.length, `${a.company} has ${live.length} agreements in force`).toBe(1)
    }
  })

  it('does not disagree with itself anywhere', () => {
    expect(contractProblems(book.contracts, book.accounts, TODAY)).toEqual([])
  })

  /* Two evaluations of one rule: `account_contract` computes the standing and
     the module computes it again for dates that are not today. This is what
     stops them drifting apart. */
  it('agrees with the database about where every agreement stands', () => {
    for (const c of book.contracts) {
      expect(c.standing, `${c.id}: view says ${c.standing}, module says ${standingOf(c, TODAY)}`)
        .toBe(standingOf(c, TODAY))
      expect(c.in_force, `${c.id} in_force`).toBe(inForce(c, TODAY))
      expect(c.days_left, `${c.id} days_left`).toBe(daysLeft(c, TODAY))
    }
  })

  it('has a label for every standing it actually returns', () => {
    for (const c of book.contracts) {
      expect(STANDING_LABEL[c.standing], `${c.id} standing ${c.standing}`).toBeTruthy()
    }
  })

  /* An assertion that passes because nothing is near its end is an assertion
     about an empty set. The renewal column exists; something has to be in it. */
  it('has at least one agreement inside its notice period', () => {
    const expiring = book.contracts.filter(c => c.standing === 'expiring')
    expect(expiring.length, 'nothing is expiring, so the renewal queue is unexercised')
      .toBeGreaterThan(0)
    for (const c of expiring) {
      expect(daysLeft(c, TODAY)).toBeLessThanOrEqual(c.notice_days)
      expect(inForce(c, TODAY), `${c.id} is expiring and should still bind`).toBe(true)
      expect(noticeBy(c)).toBeTruthy()
    }
  })

  it('says what happens next for every one of them', () => {
    for (const c of book.contracts) {
      const s = whatHappensNext(c, TODAY)
      expect(s.length, `${c.id}`).toBeGreaterThan(20)
      if (c.state === 'active' && c.auto_renew) expect(s).toMatch(/Renews automatically/)
      if (c.state === 'active' && !c.auto_renew && c.in_force) expect(s).toMatch(/does not roll over/)
    }
  })

  it('puts what is soonest at the top of the queue', () => {
    const q = renewalQueue(book.contracts, TODAY)
    expect(q.length).toBe(book.contracts.length)
    const settled = q.findIndex(c => c.state !== 'active')
    if (settled >= 0) {
      expect(q.slice(settled).some(c => c.standing === 'expiring' || c.standing === 'expired'),
        'something needing renewal is behind a settled agreement').toBe(false)
    }
  })

  it('never adds a stated term value across currencies', () => {
    const reg = registerOf(book.contracts, TODAY)
    const live = book.contracts.filter(c => c.in_force && c.term_value != null)
    const currencies = new Set(live.map(c => c.currency))
    expect(reg.committed.length).toBe(currencies.size)
    for (const g of reg.committed) {
      const own = live.filter(c => c.currency === g.currency)
      expect(g.count).toBe(own.length)
      expect(Math.abs(g.total.amount - own.reduce((t, c) => t + c.term_value!, 0)))
        .toBeLessThanOrEqual(0.01)
    }
  })

  /* The payment terms sat on two rows and had already drifted: ENT-2007 read
     'Net 30 · contract pricing on most lines' on the account and 'Invoice,
     net 30' on the billing row, and one of them advertised an arrangement that
     does not exist here. */
  it('is the single source of the payment terms', async () => {
    const { data } = await supabase.from('enterprise_billing').select('account_id,terms')
    const billing = new Map((data ?? []).map(b => [(b as { account_id: string }).account_id,
      (b as { terms: string }).terms]))
    for (const c of book.contracts.filter(x => x.in_force)) {
      const account = book.accounts.find(a => a.id === c.account_id)!
      expect(account.terms, `${c.account_id} account row`).toBe(c.terms)
      expect(billing.get(c.account_id), `${c.account_id} billing row`).toBe(c.terms)
    }
  })

  it('claims no negotiated pricing anywhere, because there is none', () => {
    for (const a of book.accounts) {
      expect(a.terms.toLowerCase(), `${a.company} advertises "${a.terms}"`)
        .not.toMatch(/contract pricing|negotiated|rate card/)
    }
  })

  it('records the boundary rather than leaving it implied', async () => {
    const { data } = await supabase.from('channel_rule').select('id,decision,reason').eq('id', 'CR-008')
    const rule = (data ?? [])[0] as { decision: string; reason: string } | undefined
    expect(rule, 'CR-008 is not on file').toBeTruthy()
    expect(rule!.decision).toBe('not operated here')
    expect(rule!.reason).toMatch(/published/)
  })

  it('gives every agreement and amendment a signed copy that resolves', async () => {
    for (const c of book.contracts) {
      expect(c.document_path, `${c.id} has no signed copy`).toBeTruthy()
      expect(c.document_path!.startsWith(`${c.account_id}/`),
        `${c.id} is filed under ${c.document_path}`).toBe(true)
    }
    /* One fetched for real. A path is not a document, and the whole point of
       this pattern is that the button does not produce a placeholder. */
    const one = book.contracts[0]
    const url = await signedCopyUrl(one.document_path)
    expect(url, `no signed URL for ${one.id}`).toBeTruthy()
    const res = await fetch(url!)
    expect(res.ok, `${one.id} signed copy did not download`).toBe(true)
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(1000)
  })

  it('keeps the supersede chain intact', () => {
    const superseded = book.contracts.filter(c => c.state === 'superseded')
    expect(superseded.length, 'nothing is superseded, so the history is unexercised')
      .toBeGreaterThan(0)
    for (const c of superseded) {
      expect(c.superseded_by, `${c.id} names no replacement`).toBeTruthy()
      const next = book.contracts.find(x => x.id === c.superseded_by)
      expect(next, `${c.id} points at ${c.superseded_by}, which is not on the register`).toBeTruthy()
      expect(next!.account_id).toBe(c.account_id)
      expect(next!.starts_on > c.ends_on, `${next!.id} overlaps the one it replaced`).toBe(true)
    }
  })

  it('says what every amendment changed, from and to', () => {
    expect(book.amendments.length).toBeGreaterThan(0)
    for (const a of book.amendments) {
      expect(a.was.length, `${a.id} was`).toBeGreaterThan(10)
      expect(a.now_says.length, `${a.id} now`).toBeGreaterThan(10)
      expect(a.why.length, `${a.id} why`).toBeGreaterThan(40)
      expect(a.was).not.toBe(a.now_says)
      expect(book.contracts.some(c => c.id === a.contract_id),
        `${a.id} amends nothing on the register`).toBe(true)
    }
    expect(inEffectOrder(book.amendments).map(a => a.effective_on))
      .toEqual([...book.amendments.map(a => a.effective_on)].sort())
  })

  /* Harbourpoint's amendment moved them to Net 15 and their agreement has to
     read Net 15 — two records of one change is how they drift. */
  it('applies a payment-terms amendment to the agreement it amends', () => {
    const a = book.amendments.find(x => x.kind === 'terms')
    expect(a, 'no payment-terms amendment to check').toBeTruthy()
    const c = book.contracts.find(x => x.id === a!.contract_id)!
    expect(a!.now_says, `${c.id} reads "${c.terms}"`).toContain(c.terms)
  })

  it('compares what was stated against what was invoiced, in one currency', () => {
    for (const c of book.contracts.filter(x => x.in_force && x.term_value != null)) {
      const a = againstTerm(c, book.spentByContract[c.id] ?? 0, TODAY)!
      expect(a.currency).toBe(c.currency)
      expect(a.throughTerm).toBeGreaterThanOrEqual(0)
      expect(a.throughTerm).toBeLessThanOrEqual(100)
      expect(a.spent).toBeGreaterThanOrEqual(0)
    }
  })

  it('points every subscription at an agreement that covered it', async () => {
    const { data } = await supabase.from('enterprise_subscriptions')
      .select('id,account_id,started,contract_ref')
    const subs = (data ?? []) as
      { id: string; account_id: string; started: string; contract_ref: string | null }[]
    expect(subs.length).toBeGreaterThan(0)
    for (const s of subs) {
      expect(s.contract_ref, `${s.id} runs under no agreement`).toBeTruthy()
      const c = book.contracts.find(x => x.id === s.contract_ref)
      expect(c, `${s.id} cites ${s.contract_ref}, which does not exist`).toBeTruthy()
      expect(c!.account_id, `${s.id} cites another account's agreement`).toBe(s.account_id)
      expect(s.started >= c!.starts_on && s.started <= c!.ends_on,
        `${s.id} started ${s.started}, outside ${c!.id} (${c!.starts_on}–${c!.ends_on})`).toBe(true)
    }
  })
})

/* ------------------------------------------------ who may see and do what -- */

describe('an agreement is the account’s to read and nobody’s to change', () => {
  afterAll(async () => { await signOut() })

  it('shows an account its own agreements and no others', async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const { data } = await supabase.from('account_contract').select('id,account_id')
    const rows = (data ?? []) as { account_id: string }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.account_id).toBe('ENT-2007')
    await signOut()
  })

  /* Unlike a credit assessment, which is the marketplace's working about them,
     a contract is a document they signed — so they see all of it. */
  it('gives the account its live agreement, its history and its amendments', async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const mine = await loadMyContract()
    expect(mine.loadError).toBeUndefined()
    expect(mine.contract, 'the demo account has no agreement in force').toBeTruthy()
    expect(mine.contract!.account_id).toBe('ENT-2007')
    expect(mine.history.length, 'the superseded one is not shown').toBeGreaterThan(0)
    expect(mine.amendments.length).toBeGreaterThan(0)
    await signOut()
  })

  it('shows a seller nothing of any of it', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const c = await supabase.from('account_contract').select('id')
    const a = await supabase.from('enterprise_contract_amendment').select('id')
    expect((c.data ?? []).length, 'a seller can read the agreements').toBe(0)
    expect((a.data ?? []).length, 'a seller can read the amendments').toBe(0)
    await signOut()
  })

  it('will not let an account change its own agreement', async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const { data, error } = await supabase.from('enterprise_contract')
      .update({ ends_on: '2099-12-31' }).eq('id', 'CTR-2007-01').select('id')
    /* Either refused outright or silently matching no rows — a row-level
       refusal is not an error, it is zero rows and a success. */
    expect(error !== null || (data ?? []).length === 0,
      'the account extended its own agreement').toBe(true)
    const after = await supabase.from('account_contract').select('ends_on').eq('id', 'CTR-2007-01').single()
    expect((after.data as { ends_on: string }).ends_on).toBe('2027-03-31')
    await signOut()
  })

  it('will not let anybody but the marketplace renew or end one', async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const r = await terminateContract('CTR-2007-01', TODAY, 'we would rather not')
    expect(r.ok, 'an account ended its own agreement').toBe(false)
    expect(r.why).toMatch(/only the marketplace/i)
    await signOut()
  })

  it('will not let the marketplace end one for no recorded reason', async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const r = await terminateContract('CTR-2007-01', TODAY, '   ')
    expect(r.ok).toBe(false)
    expect(r.why).toMatch(/Say why/i)
    await signOut()
  })
})

/* ------------------------------------------ the moment the agreement bites -- */

describe('what happens with nothing in force', () => {
  /* Greencity: signed, in force, and has never bought anything — so moving its
     dates for a moment disturbs the least. Everything is put back in `afterAll`
     whether or not the assertions passed. */
  const TARGET = 'CTR-2013-01'
  const ACCOUNT = 'ENT-2013'
  let was: { starts_on: string; ends_on: string } | null = null

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data } = await supabase.from('enterprise_contract')
      .select('starts_on,ends_on').eq('id', TARGET).single()
    was = data as { starts_on: string; ends_on: string }
    expect(was, `${TARGET} is not on the register`).toBeTruthy()
  })

  afterAll(async () => {
    if (was) {
      await supabase.from('enterprise_contract')
        .update({ starts_on: was.starts_on, ends_on: was.ends_on }).eq('id', TARGET)
    }
    /* And any requisition this file left behind, so a failed run does not leave
       a purchase nobody approved in the book. */
    await supabase.from('enterprise_requisitions').delete().eq('id', 'REQ-CTRTEST')
    await signOut()
  })

  it('refuses a new requisition once the agreement has run out', async () => {
    /* Ended yesterday. A term that ran out is exactly the state the guard is
       for, and it is reachable only by moving a date. */
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    /* Only the end date. Moving the start as well trips
       `contract_signed_before_it_started`, which is the constraint doing its
       job — this agreement was signed on 2026-05-20 and cannot be made to have
       started in January. */
    const moved = await supabase.from('enterprise_contract')
      .update({ ends_on: yesterday }).eq('id', TARGET).select('id')
    expect(moved.error, moved.error?.message).toBeNull()

    const { data: check } = await supabase.rpc('contract_in_force', { p_account: ACCOUNT })
    expect(check, `${ACCOUNT} still has something in force`).toBeNull()

    const { error } = await supabase.from('enterprise_requisitions').insert({
      id: 'REQ-CTRTEST', account_id: ACCOUNT, raised_by: 'EU-2013-01',
      raised_on: TODAY, raised_at: new Date().toISOString(),
      title: 'Integration test — should be refused',
      vertical: 'iot', amount: 1000, currency: 'INR', model: 'oneoff', need: 'none',
      policy_note: 'Below the threshold.',
      reason: 'Checking the contract guard refuses this.', state: 'pending',
    })
    expect(error, 'a requisition was raised with no agreement in force').toBeTruthy()
    expect(error!.message).toMatch(/ran to|no agreement/i)
    expect(error!.message, 'the refusal does not say what to do about it')
      .toMatch(/renewed|sign/i)
  })

  it('and the account is told so on its own screen, not by an error message', async () => {
    /* The buyer's screen reads the same view the guard reads, so it says the
       same thing rather than guessing from a failed write. */
    const { data } = await supabase.from('account_contract')
      .select('id,standing,in_force').eq('id', TARGET).single()
    const row = data as { standing: string; in_force: boolean }
    expect(row.standing).toBe('expired')
    expect(row.in_force).toBe(false)
  })

  it('lets it buy again the moment the term is put back', async () => {
    const back = await supabase.from('enterprise_contract')
      .update({ starts_on: was!.starts_on, ends_on: was!.ends_on }).eq('id', TARGET).select('id')
    expect(back.error, back.error?.message).toBeNull()

    const { data: check } = await supabase.rpc('contract_in_force', { p_account: ACCOUNT })
    expect(check, `${ACCOUNT} has nothing in force after the term was restored`).toBe(TARGET)

    const { error } = await supabase.from('enterprise_requisitions').insert({
      id: 'REQ-CTRTEST', account_id: ACCOUNT, raised_by: 'EU-2013-01',
      raised_on: TODAY, raised_at: new Date().toISOString(),
      title: 'Integration test — should be allowed',
      vertical: 'iot', amount: 1000, currency: 'INR', model: 'oneoff', need: 'none',
      policy_note: 'Below the threshold.',
      reason: 'Checking the contract guard allows this once the term is back.', state: 'pending',
    })
    expect(error, error?.message).toBeNull()

    await supabase.from('enterprise_requisitions').delete().eq('id', 'REQ-CTRTEST')
  })
})

/* --------------------------------------------------- renewing, for real -- */

describe('a renewal, made and put back', () => {
  const FROM = 'CTR-2012-01'
  const NEW = 'CTR-2012-02'

  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })

  afterAll(async () => {
    /* Put the register back: remove the new term and un-supersede the old one.
       In that order — the FK on `superseded_by` points at the row being
       deleted, and clearing the pointer first is what stops the delete failing
       silently and leaving a second agreement on the account for ever. */
    await supabase.from('enterprise_contract')
      .update({ state: 'active', superseded_by: null }).eq('id', FROM)
    await supabase.from('enterprise_contract').delete().eq('id', NEW)
    await signOut()
  })

  it('refuses a term that overlaps the one it replaces', async () => {
    const book = await loadContractBook()
    const from = book.contracts.find(c => c.id === FROM)!
    const res = await renewContract(from, {
      id: NEW, title: 'Master services agreement 2026–2027',
      signed_on: TODAY, starts_on: from.starts_on, ends_on: '2027-08-31',
      terms: from.terms, auto_renew: false, notice_days: 30, term_value: 800000,
      signed_by: from.signed_by, signed_title: from.signed_title,
      countersigned_by: 'Anika Sharma',
    })
    expect(res.ok, 'an overlapping term was accepted').toBe(false)
    expect(res.why).toMatch(/overlap/i)
  })

  it('creates the new term and supersedes the old one in one act', async () => {
    const book = await loadContractBook()
    const from = book.contracts.find(c => c.id === FROM)!
    const starts = new Date(Date.parse(`${from.ends_on}T00:00:00Z`) + 86400000)
      .toISOString().slice(0, 10)

    const res = await renewContract(from, {
      id: NEW, title: 'Master services agreement 2026–2027',
      signed_on: TODAY, starts_on: starts, ends_on: '2027-08-31',
      terms: 'Net 30', auto_renew: true, notice_days: 60, term_value: 800000,
      signed_by: from.signed_by, signed_title: from.signed_title,
      countersigned_by: 'Anika Sharma',
      note: 'Integration test renewal.',
    })
    expect(res.ok, res.why).toBe(true)

    const after = await loadContractBook()
    const made = after.contracts.find(c => c.id === NEW)!
    const old = after.contracts.find(c => c.id === FROM)!
    expect(made, 'the new term was not created').toBeTruthy()
    expect(made.account_id).toBe(from.account_id)
    /* The currency is not the operator's to change on a renewal — it comes off
       the agreement being replaced. */
    expect(made.currency).toBe(from.currency)
    expect(old.superseded_by).toBe(NEW)
    /* Still active, and still in force. Marking it superseded on the spot is
       what took the account off account-purchasing for the rest of its own
       term — a punishment for renewing inside the notice period, which is the
       behaviour the notice period exists to produce. */
    expect(old.state, 'the agreement still running was superseded on the spot').toBe('active')
    expect(old.in_force, 'the account was locked out by its own renewal').toBe(true)
    expect(made.in_force, 'the new term binds before it starts').toBe(false)
    expect(made.standing).toBe('not started')

    /* And still exactly one thing in force for that account — two active rows
       is fine so long as their terms do not overlap. */
    const live = after.contracts.filter(c => c.account_id === from.account_id && c.in_force)
    expect(live.length, `${from.account_id} holds ${live.length} agreements in force`).toBe(1)
    expect(live[0].id).toBe(FROM)
  })

  it('leaves the account able to buy across the changeover', async () => {
    const { data } = await supabase.rpc('contract_in_force', { p_account: 'ENT-2012' })
    expect(data, 'the renewal left ENT-2012 with nothing in force').toBeTruthy()
  })

  it('will not renew what it has already superseded', async () => {
    const book = await loadContractBook()
    const from = book.contracts.find(c => c.id === FROM)!
    const res = await renewContract({ ...from, ends_on: '2026-08-31' }, {
      id: 'CTR-2012-03', title: 'Another', signed_on: TODAY,
      starts_on: '2027-09-01', ends_on: '2028-08-31', terms: 'Net 30',
      auto_renew: false, notice_days: 30, term_value: null,
      signed_by: 'x', signed_title: 'y', countersigned_by: 'Anika Sharma',
    })
    expect(res.ok).toBe(false)
    expect(res.why).toMatch(/already been renewed into/i)
  })
})

/* ------------------------------------------------- amending, for real -- */

describe('an amendment, recorded and removed', () => {
  const CONTRACT = 'CTR-2013-01'
  let made: string | null = null

  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })

  afterAll(async () => {
    if (made) await supabase.from('enterprise_contract_amendment').delete().eq('id', made)
    /* And the terms it moved, because a terms amendment changes the agreement
       and leaving that behind would drift the account's billing row too. */
    await supabase.from('enterprise_contract').update({ terms: 'Net 30' }).eq('id', CONTRACT)
    await signOut()
  })

  it('records both sides and applies a terms change to the agreement', async () => {
    const res = await addAmendment({
      contract_id: CONTRACT, kind: 'terms',
      signed_on: TODAY, effective_on: TODAY,
      was: 'Payment terms: Net 30 from date of invoice.',
      now_says: 'Payment terms: Net 45 from date of invoice.',
      terms: 'Net 45',
      why: 'Integration test — checking a terms amendment moves the agreement with it.',
      signed_by: 'Nilesh Bhatt',
    })
    expect(res.ok, res.why).toBe(true)
    made = res.id ?? null
    expect(made).toBe(`${CONTRACT}-A1`)

    const { data } = await supabase.from('account_contract')
      .select('terms').eq('id', CONTRACT).single()
    expect((data as { terms: string }).terms,
      'the amendment was recorded and the agreement still reads the old terms').toBe('Net 45')
  })

  it('carries the change through to what the account is billed on', async () => {
    const { data } = await supabase.from('enterprise_billing')
      .select('terms').eq('account_id', 'ENT-2013').single()
    expect((data as { terms: string }).terms).toBe('Net 45')
  })
})
