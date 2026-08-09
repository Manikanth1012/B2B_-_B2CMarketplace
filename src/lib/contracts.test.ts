import { describe, it, expect } from 'vitest'
import {
  STANDING_LABEL, STANDING_TONE, AMENDMENT_LABEL,
  daysLeft, standingOf, inForce, noticeBy, whatHappensNext,
  renewalQueue, dueWithin, registerOf, againstTerm,
  inEffectOrder, validateAmendment, contractProblems,
} from './contracts'
import type { Contract, Amendment, Standing } from './contracts'

const TODAY = '2026-08-09'

const con = (over: Partial<Contract> = {}): Contract => ({
  id: 'CTR-2007-01',
  account_id: 'ENT-2007',
  company: 'SmartBuild Ltd',
  market: 'IN',
  title: 'Master services agreement 2024–2027',
  signed_on: '2024-03-18',
  starts_on: '2024-04-01',
  ends_on: '2027-03-31',
  terms: 'Net 30',
  currency: 'INR',
  auto_renew: false,
  notice_days: 60,
  term_value: 12000000,
  signed_by: 'Rohit Malhotra',
  signed_title: 'Chief Financial Officer',
  countersigned_by: 'Ruben Oyelaran',
  document_name: 'agreement.pdf',
  document_path: 'ENT-2007/contracts/agreement.pdf',
  state: 'active',
  superseded_by: null,
  terminated_on: null,
  terminated_why: null,
  note: null,
  days_left: 234,
  in_force: true,
  standing: 'in force',
  ...over,
})

const amd = (over: Partial<Amendment> = {}): Amendment => ({
  id: 'CTR-2007-01-A1',
  contract_id: 'CTR-2007-01',
  kind: 'value',
  signed_on: '2025-09-18',
  effective_on: '2025-10-01',
  was: 'Expected spend across the term: INR 9,000,000.',
  now_says: 'Expected spend across the term: INR 12,000,000.',
  why: 'Two further sites at Hubli and Belgaum were brought into the agreement.',
  signed_by: 'Rohit Malhotra',
  document_name: null,
  document_path: null,
  ...over,
})

const acct = (over: Partial<{ id: string; company: string; status: string; terms: string }> = {}) => ({
  id: 'ENT-2007', company: 'SmartBuild Ltd', status: 'active', terms: 'Net 30', ...over,
})

describe('the words on a standing', () => {
  const all: Standing[] =
    ['draft', 'not started', 'in force', 'expiring', 'expired', 'terminated', 'superseded']

  it('has a label and a tone for every one', () => {
    for (const s of all) {
      expect(STANDING_LABEL[s], s).toBeTruthy()
      expect(STANDING_TONE[s], s).toBeTruthy()
    }
  })

  /* The two that mean "cannot buy right now" must not be drawn in the same
     colour as the two that mean "all fine". */
  it('does not draw expired in a healthy colour', () => {
    expect(STANDING_TONE.expired).toBe('rejected')
    expect(STANDING_TONE.terminated).toBe('rejected')
    expect(STANDING_TONE['in force']).toBe('healthy')
    expect(STANDING_TONE.expiring).not.toBe('healthy')
  })

  it('names every kind of amendment', () => {
    for (const k of ['extension', 'terms', 'value', 'contact', 'other'] as const) {
      expect(AMENDMENT_LABEL[k], k).toBeTruthy()
    }
  })
})

describe('how long is left', () => {
  it('counts the days to the end', () => {
    expect(daysLeft(con({ ends_on: '2026-08-19' }), TODAY)).toBe(10)
  })

  it('goes negative once it is past', () => {
    expect(daysLeft(con({ ends_on: '2026-07-09' }), TODAY)).toBe(-31)
  })

  it('is zero on the last day, which is still a day it binds', () => {
    expect(daysLeft(con({ ends_on: TODAY }), TODAY)).toBe(0)
    expect(standingOf(con({ ends_on: TODAY }), TODAY)).toBe('expiring')
    expect(inForce(con({ ends_on: TODAY }), TODAY)).toBe(true)
  })
})

describe('where a contract stands', () => {
  it('is in force in the middle of its term', () => {
    expect(standingOf(con(), TODAY)).toBe('in force')
    expect(inForce(con(), TODAY)).toBe(true)
  })

  /* Expiring is the state worth showing. Expired is too late to act on. */
  it('turns expiring once inside the notice period, not before', () => {
    /* Sixty days out is the day notice becomes due, so it counts as expiring.
       Sixty-one is the last day it is merely in force. */
    expect(standingOf(con({ ends_on: '2026-10-09', notice_days: 60 }), TODAY)).toBe('in force')
    expect(standingOf(con({ ends_on: '2026-10-08', notice_days: 60 }), TODAY)).toBe('expiring')
    expect(daysLeft(con({ ends_on: '2026-10-08' }), TODAY)).toBe(60)
  })

  it('uses each contract’s own notice period, because ninety days is a ninety-day warning', () => {
    const ends = '2026-10-20'
    expect(standingOf(con({ ends_on: ends, notice_days: 30 }), TODAY)).toBe('in force')
    expect(standingOf(con({ ends_on: ends, notice_days: 90 }), TODAY)).toBe('expiring')
  })

  it('is expired the day after it ends', () => {
    expect(standingOf(con({ ends_on: '2026-08-08' }), TODAY)).toBe('expired')
    expect(inForce(con({ ends_on: '2026-08-08' }), TODAY)).toBe(false)
  })

  it('has not started before its start date', () => {
    expect(standingOf(con({ starts_on: '2026-09-01', ends_on: '2027-08-31' }), TODAY)).toBe('not started')
    expect(inForce(con({ starts_on: '2026-09-01', ends_on: '2027-08-31' }), TODAY)).toBe(false)
  })

  /* What a person decided beats what the clock says. A terminated agreement
     inside its term is terminated, not in force. */
  it('lets a decision override the dates', () => {
    expect(standingOf(con({ state: 'terminated' }), TODAY)).toBe('terminated')
    expect(standingOf(con({ state: 'superseded' }), TODAY)).toBe('superseded')
    expect(standingOf(con({ state: 'draft' }), TODAY)).toBe('draft')
    expect(inForce(con({ state: 'terminated' }), TODAY)).toBe(false)
    expect(inForce(con({ state: 'draft' }), TODAY)).toBe(false)
  })
})

/* The bug this rule exists for: renewing inside the notice period — which is
   exactly what the register is telling somebody to do — used to mark the current
   agreement superseded on the spot, taking the account off account-purchasing
   for the rest of its own term. Acting early was punished with an outage. */
describe('an agreement that has already been renewed', () => {
  const renewed = con({ ends_on: '2026-08-31', notice_days: 30, superseded_by: 'CTR-2007-02' })

  it('goes on binding until its own end date', () => {
    expect(standingOf(renewed, TODAY)).toBe('expiring')
    expect(inForce(renewed, TODAY)).toBe(true)
  })

  it('reads superseded once its term is over, not expired', () => {
    const done = con({ ends_on: '2026-07-31', superseded_by: 'CTR-2007-02' })
    expect(standingOf(done, TODAY)).toBe('superseded')
    expect(inForce(done, TODAY)).toBe(false)
  })

  /* Expired means nobody renewed and the account is locked out. Saying that
     about one that was properly renewed sends somebody chasing a renewal that
     already happened. */
  it('still reads expired when nothing replaced it', () => {
    const lapsed = con({ ends_on: '2026-07-31', superseded_by: null })
    expect(standingOf(lapsed, TODAY)).toBe('expired')
  })

  it('tells the reader nothing needs doing, rather than to give notice', () => {
    const s = whatHappensNext(renewed, TODAY)
    expect(s).toMatch(/CTR-2007-02 takes over/)
    expect(s).toMatch(/Nothing needs doing/)
    expect(s).not.toMatch(/Notice is due/)
  })

  it('names what replaced it and when it ran to, once it is done', () => {
    const done = con({ ends_on: '2026-07-31', superseded_by: 'CTR-2007-02' })
    expect(whatHappensNext(done, TODAY)).toMatch(/Ran to 2026-07-31 and was replaced by CTR-2007-02/)
  })
})

describe('when notice is due', () => {
  it('counts the notice period back from the end', () => {
    expect(noticeBy(con({ ends_on: '2027-03-31', notice_days: 60 }))).toBe('2027-01-30')
  })

  it('crosses a year end', () => {
    expect(noticeBy(con({ ends_on: '2027-01-31', notice_days: 60 }))).toBe('2026-12-02')
  })

  /* Null, not today. No notice period is a different thing from notice being
     due immediately, and a screen that shows today would have people ringing. */
  it('is nothing at all where no notice is required', () => {
    expect(noticeBy(con({ notice_days: 0 }))).toBeNull()
  })
})

describe('what happens when the term runs out', () => {
  /* The two opposite failures: one lapses because nobody acted, the other rolls
     for another year because nobody acted. Both sentences have to say so. */
  it('says a non-renewing contract does not roll over', () => {
    const s = whatHappensNext(con({ auto_renew: false }), TODAY)
    expect(s).toMatch(/does not roll over/)
    expect(s).toMatch(/Notice is due by 2027-01-30/)
  })

  it('says an auto-renewing one renews unless somebody stops it', () => {
    const s = whatHappensNext(con({ auto_renew: true }), TODAY)
    expect(s).toMatch(/Renews automatically/)
    expect(s).toMatch(/unless either side gives notice by/)
  })

  it('says an expired one refuses purchases, which is the consequence people care about', () => {
    expect(whatHappensNext(con({ ends_on: '2026-06-30' }), TODAY)).toMatch(/refused until it is renewed/)
  })

  it('names the replacement for a superseded one', () => {
    expect(whatHappensNext(con({ state: 'superseded', superseded_by: 'CTR-2007-02' }), TODAY))
      .toMatch(/was replaced by CTR-2007-02/)
  })

  it('carries the reason for a terminated one', () => {
    const s = whatHappensNext(
      con({ state: 'terminated', terminated_on: '2026-05-01', terminated_why: 'Account moved to a group agreement.' }),
      TODAY)
    expect(s).toMatch(/2026-05-01/)
    expect(s).toMatch(/group agreement/)
  })

  it('does not offer a notice date on a contract that needs no notice', () => {
    expect(whatHappensNext(con({ notice_days: 0 }), TODAY)).not.toMatch(/Notice is due/)
  })
})

describe('what to renew first', () => {
  const expired = con({ id: 'A', ends_on: '2026-06-01' })
  const expiringSoon = con({ id: 'B', ends_on: '2026-08-20', notice_days: 30 })
  /* Outside its own notice period, so it is in force — but inside a wider
     reporting window, which is what `dueWithin` is for. */
  const expiringLater = con({ id: 'C', ends_on: '2026-09-25', notice_days: 30 })
  const fine = con({ id: 'D', ends_on: '2027-06-01', notice_days: 30 })
  const draft = con({ id: 'E', state: 'draft' })

  it('puts expired first, because that account cannot buy right now', () => {
    const q = renewalQueue([fine, expiringLater, expired, expiringSoon], TODAY)
    expect(q.map(c => c.id)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('orders the expiring ones by how little time is left', () => {
    const q = renewalQueue([expiringLater, expiringSoon], TODAY)
    expect(q.map(c => c.id)).toEqual(['B', 'C'])
  })

  it('keeps unsigned drafts above settled agreements', () => {
    const q = renewalQueue([fine, draft], TODAY)
    expect(q.map(c => c.id)).toEqual(['E', 'D'])
  })

  it('does not lose or duplicate anything', () => {
    const all = [fine, expiringLater, expired, expiringSoon, draft]
    expect(renewalQueue(all, TODAY)).toHaveLength(all.length)
  })

  it('collects what is due inside a window, and always the expired', () => {
    const due = dueWithin([fine, expiringLater, expired, expiringSoon], TODAY, 30)
    expect(due.map(c => c.id).sort()).toEqual(['A', 'B'])
    const wider = dueWithin([fine, expiringLater, expired, expiringSoon], TODAY, 90)
    expect(wider.map(c => c.id).sort()).toEqual(['A', 'B', 'C'])
  })

  it('leaves a draft out of the renewal window — it has nothing to renew yet', () => {
    expect(dueWithin([draft], TODAY, 365)).toEqual([])
  })
})

describe('the register', () => {
  const list = [
    con({ id: 'A', account_id: 'E1', currency: 'INR', term_value: 12000000, ends_on: '2027-03-31' }),
    con({ id: 'B', account_id: 'E2', currency: 'INR', term_value: 110000000, ends_on: '2027-06-30', auto_renew: true }),
    con({ id: 'C', account_id: 'E3', currency: 'AED', term_value: 750000, ends_on: '2026-08-31', notice_days: 30 }),
    con({ id: 'D', account_id: 'E4', currency: 'KES', term_value: 12000000, ends_on: '2026-06-01' }),
    con({ id: 'E', account_id: 'E5', state: 'draft' }),
  ]

  it('counts what is in force, expiring and expired', () => {
    const r = registerOf(list, TODAY)
    expect(r.total).toBe(5)
    expect(r.inForce).toBe(3)
    expect(r.expiring).toBe(1)
    expect(r.expired).toBe(1)
    expect(r.autoRenewing).toBe(1)
    expect(r.unsigned).toBe(1)
  })

  /* Four currencies trade here. One number across them is a quantity of
     nothing, and this is the third module that has had to say so. */
  it('never adds a term value across currencies', () => {
    const r = registerOf(list, TODAY)
    expect(r.committed.map(g => g.currency).sort()).toEqual(['AED', 'INR'])
    const inr = r.committed.find(g => g.currency === 'INR')!
    expect(inr.total.amount).toBe(122000000)
    expect(inr.count).toBe(2)
  })

  it('leaves the expired one out of what is committed', () => {
    const r = registerOf(list, TODAY)
    expect(r.committed.some(g => g.currency === 'KES')).toBe(false)
  })
})

describe('what was stated against what was spent', () => {
  /* A percentage on its own is unreadable: two months into a term and two months
     from the end give the same figure and mean opposite things. */
  it('reports how far through the term it is beside the spend', () => {
    const c = con({ starts_on: '2026-01-01', ends_on: '2026-12-31', term_value: 1000000 })
    const a = againstTerm(c, 250000, '2026-07-02')!
    expect(a.pct).toBe(25)
    expect(a.throughTerm).toBeCloseTo(50, 0)
    expect(a.currency).toBe('INR')
  })

  it('is nothing where the account stated nothing', () => {
    expect(againstTerm(con({ term_value: null }), 500, TODAY)).toBeNull()
    expect(againstTerm(con({ term_value: 0 }), 500, TODAY)).toBeNull()
  })

  it('does not report more than a whole term elapsed', () => {
    const c = con({ starts_on: '2025-01-01', ends_on: '2025-12-31', term_value: 100 })
    expect(againstTerm(c, 50, TODAY)!.throughTerm).toBe(100)
  })

  it('does not report a negative elapsed before the term starts', () => {
    const c = con({ starts_on: '2027-01-01', ends_on: '2027-12-31', term_value: 100 })
    expect(againstTerm(c, 0, TODAY)!.throughTerm).toBe(0)
  })
})

describe('amendments', () => {
  it('orders them by when they took effect, not when they were signed', () => {
    const late = amd({ id: 'A2', signed_on: '2025-01-01', effective_on: '2026-01-01' })
    const early = amd({ id: 'A1', signed_on: '2025-06-01', effective_on: '2025-07-01' })
    expect(inEffectOrder([late, early]).map(a => a.id)).toEqual(['A1', 'A2'])
  })

  it('breaks a tie on the signing date', () => {
    const a = amd({ id: 'A1', effective_on: '2026-01-01', signed_on: '2025-11-01' })
    const b = amd({ id: 'A2', effective_on: '2026-01-01', signed_on: '2025-12-01' })
    expect(inEffectOrder([b, a]).map(x => x.id)).toEqual(['A1', 'A2'])
  })

  const contract = { starts_on: '2024-04-01', ends_on: '2027-03-31' }

  it('accepts one that says both sides and why', () => {
    expect(validateAmendment(amd(), contract)).toEqual({ ok: true })
  })

  /* Parsing the new terms out of the prose turned "Payment terms: Net 45 from
     date of invoice." into an account billed on "Net 45 from date of invoice",
     where every other account reads "Net 45". Asking for the value is one
     field; guessing it is a string that quietly grows. */
  it('refuses a terms change that does not say what the terms become', () => {
    const r = validateAmendment(amd({ kind: 'terms' }), contract)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/what the payment terms become/i)
  })

  it('accepts one that does', () => {
    expect(validateAmendment(
      { ...amd({ kind: 'terms' }), terms: 'Net 45' }, contract)).toEqual({ ok: true })
  })

  it('refuses one with only the new wording', () => {
    const r = validateAmendment(amd({ was: '' }), contract)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/what it changed from/)
  })

  it('refuses one where nothing actually changed', () => {
    const r = validateAmendment(amd({ was: 'Net 30 from invoice.', now_says: 'Net 30 from invoice.' }), contract)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/nothing was amended/)
  })

  it('refuses one with no reason', () => {
    const r = validateAmendment(amd({ why: 'because' }), contract)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/an edit somebody made/)
  })

  /* Backdating happens and is legitimate. What is not legitimate is it being
     invisible, so it is refused here and has to be stated. */
  it('refuses a backdated one rather than letting the date hide it', () => {
    const r = validateAmendment(amd({ signed_on: '2025-10-01', effective_on: '2025-09-01' }), contract)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Backdating/)
  })

  it('refuses one that takes effect after the agreement ends', () => {
    const r = validateAmendment(amd({ signed_on: '2027-01-01', effective_on: '2027-06-01' }), contract)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/changes nothing/)
  })
})

describe('where the contract file disagrees with itself', () => {
  it('is quiet when everything lines up', () => {
    expect(contractProblems([con()], [acct()], TODAY)).toEqual([])
  })

  /* The one that produced all of this. */
  it('names an account trading with nothing behind it', () => {
    const out = contractProblems([], [acct()], TODAY)
    expect(out).toEqual(['SmartBuild Ltd is trading with no agreement on file at all.'])
  })

  it('names an account whose agreement has run out, and when', () => {
    const out = contractProblems([con({ ends_on: '2026-06-30' })], [acct()], TODAY)
    expect(out[0]).toMatch(/ran out on 2026-06-30/)
  })

  it('catches two agreements in force at once', () => {
    const out = contractProblems([con({ id: 'X' }), con({ id: 'Y' })], [acct()], TODAY)
    expect(out.some(s => /2 agreements in force at once/.test(s))).toBe(true)
  })

  /* Two copies of the payment terms is exactly how ENT-2007 came to read
     'Net 30 · contract pricing on most lines' on one row and 'Invoice, net 30'
     on another. */
  it('catches billing terms that no longer match the agreement', () => {
    const out = contractProblems([con({ terms: 'Net 30' })], [acct({ terms: 'Net 45' })], TODAY)
    expect(out.some(s => /billed on "Net 45" and CTR-2007-01 says "Net 30"/.test(s))).toBe(true)
  })

  it('catches a superseded agreement that names no replacement', () => {
    const out = contractProblems(
      [con({ id: 'OLD', state: 'superseded' }), con()], [acct()], TODAY)
    expect(out.some(s => /OLD is superseded and does not say by what/.test(s))).toBe(true)
  })

  it('catches a supersede chain pointing at nothing', () => {
    const out = contractProblems(
      [con({ id: 'OLD', state: 'superseded', superseded_by: 'GONE' }), con()], [acct()], TODAY)
    expect(out.some(s => /points at GONE, which is not on the register/.test(s))).toBe(true)
  })

  it('catches a term that runs backwards and one signed after it started', () => {
    const back = contractProblems([con({ starts_on: '2027-01-01', ends_on: '2026-01-01' })], [], TODAY)
    expect(back.some(s => /ends on or before it starts/.test(s))).toBe(true)
    const late = contractProblems([con({ signed_on: '2024-06-01' })], [], TODAY)
    expect(late.some(s => /starts before it was signed/.test(s))).toBe(true)
  })

  /* Every proof in this marketplace is a file somebody can open. A contract
     with no signed copy is the least forgivable place to break that. */
  it('catches an agreement with no signed copy', () => {
    const out = contractProblems([con({ document_path: null })], [], TODAY)
    expect(out.some(s => /no signed copy attached/.test(s))).toBe(true)
  })

  it('says nothing about an account that is not trading', () => {
    expect(contractProblems([], [acct({ status: 'closed' })], TODAY)).toEqual([])
  })
})
