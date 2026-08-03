import { describe, it, expect } from 'vitest'
import {
  needFor, policyNoteFor, policyImpact, waiting, decided, canDecide, whoCanDecide,
  validateDecision, approvalImpact, duplicatesOf, validateRequisition, requisitionTotal,
  summariseApprovals, byRequester, centreUse, centresAtRisk, committed, idleSeats,
  renewingWithin, outstanding, spentThisYear, budgetPosition, bySeller, byCostCentre,
  reconcileInvoice, arrears, taxPosition, money, money0, day, NEED_LABEL,
} from './enterprise'
import type {
  Account, Member, CostCentre, Policy, Requisition, ReqLine, Subscription, Invoice, InvoiceLine,
} from './enterprise'

const policy: Policy = {
  account_id: 'ENT-2007', threshold: 2000, security_signoff: true, duplicate_flag: true,
  auto_approve_renewals: false, self_approve: false, note: '', updated_by: null, updated_on: null,
}

function member(over: Partial<Member> = {}): Member {
  return {
    id: 'EU-01', account_id: 'ENT-2007', user_id: 'u1', name: 'Vikram Shah',
    email: 'v@smartbuild.in', title: 'Procurement Lead', role: 'procurement-lead',
    can_raise: true, approves_finance: true, approves_it: true, approve_limit: null,
    cost_centre: 'CC-1000', phone: null, mfa: true, status: 'active',
    sort_order: 1, ...over,
  }
}

const LEAD = member()
const CFO = member({ id: 'EU-02', name: 'Meera Iyer', role: 'finance-approver', can_raise: false, approves_finance: true, approves_it: false, approve_limit: 25000, sort_order: 2 })
const IT = member({ id: 'EU-03', name: 'Karthik Nair', role: 'it-approver', approves_finance: false, approves_it: true, sort_order: 3 })
const BUYER = member({ id: 'EU-04', name: 'Anita Desai', role: 'buyer', approves_finance: false, approves_it: false, sort_order: 4 })
const VIEWER = member({ id: 'EU-06', name: 'Sunita Rao', role: 'viewer', can_raise: false, approves_finance: false, approves_it: false, sort_order: 6 })

function req(over: Partial<Requisition> = {}): Requisition {
  return {
    id: 'REQ-1', account_id: 'ENT-2007', raised_by: 'EU-04', raised_on: '2026-07-31',
    raised_at: 'Today', title: 'Cold-chain starter ×2', vertical: 'iot', cost_centre: 'CC-4100',
    amount: 4590, model: 'oneoff', reason: 'Two depots open in September.', need: 'finance',
    policy_note: '', state: 'pending', decided_by: null, decided_on: null, decision_note: null,
    order_ref: null, po_ref: null, sort_order: 1, ...over,
  }
}

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 'SUB-1', account_id: 'ENT-2007', product_id: 'SKU-6002', name: 'Sentinel MDR — 24/7',
    seller: 'Sentinel Cyber', partner_id: 'PTR-1003', vertical: 'security', quantity: 250,
    seats_used: 231, unit_price: 9.5, unit: 'per endpoint/mo', monthly: 2375, cost_centre: 'CC-2200',
    started: '2025-08-12', renews: '2026-08-12', status: 'active', auto_renew: true,
    contract_ref: null, why_suspended: null, sort_order: 1, ...over,
  }
}

function inv(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'INV-1', account_id: 'ENT-2007', period: 'Jul 2026', currency: 'USD', kind: 'recurring',
    issued: '2026-07-29', due: '2026-08-20', recurring: 6700, oneoff: 5432, tax_rate: 18,
    tax: 2183.76, total: 14315.76, status: 'open', paid_on: null, po_ref: null, note: null,
    sort_order: 1, ...over,
  }
}

function line(over: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: 'L-1', invoice_id: 'INV-1', kind: 'subscription', description: 'Sentinel MDR — 24/7',
    seller: 'Sentinel Cyber', partner_id: 'PTR-1003', cost_centre: 'CC-2200',
    subscription_id: 'SUB-1', requisition_id: null, quantity: 250, unit_price: 9.5,
    amount: 2375, sort_order: 1, ...over,
  }
}

const ACCOUNT: Account = {
  id: 'ENT-2007', company: 'SmartBuild Ltd', legal_name: 'SmartBuild Infrastructure Private Limited',
  segment: 'mid', industry: 'Construction', sites: 4, staff: 320, terms: 'Net 30', currency: 'USD',
  fy_starts: '2026-04-01', budget_year: 120000, reg_type: 'GSTIN', registration: '29AAJCS4718R1ZM',
  place_of_supply: 'Karnataka, India', po_required: true, reverse_charge: false,
  cost_centre_on_invoice: true, tax_exempt: false, exempt_cert: null, status: 'active',
}

function centre(over: Partial<CostCentre> = {}): CostCentre {
  return {
    id: 'CC-4100', account_id: 'ENT-2007', name: 'Logistics', owner: 'Ravi Krishnan',
    quarter: '2026-Q3', cap_quarter: 18000, spent_quarter: 3720, status: 'active', sort_order: 2, ...over,
  }
}

/* ---------------------------------------------------------------- policy -- */

describe('needFor', () => {
  it('sends value to finance', () => {
    expect(needFor({ amount: 4590, vertical: 'iot' }, policy)).toBe('finance')
  })

  it('sends a security purchase to IT however little it costs', () => {
    expect(needFor({ amount: 136, vertical: 'security' }, policy)).toBe('it')
  })

  it('asks for both when it is expensive and it is security', () => {
    expect(needFor({ amount: 2375, vertical: 'security' }, policy)).toBe('both')
  })

  it('asks for nothing below the threshold on an ordinary purchase', () => {
    expect(needFor({ amount: 1128, vertical: 'iot' }, policy)).toBe('none')
  })

  it('treats the threshold as inclusive — "at or above" means at', () => {
    expect(needFor({ amount: 2000, vertical: 'iot' }, policy)).toBe('finance')
    expect(needFor({ amount: 1999.99, vertical: 'iot' }, policy)).toBe('none')
  })

  it('lets an account switch IT sign-off off entirely', () => {
    expect(needFor({ amount: 136, vertical: 'security' }, { ...policy, security_signoff: false })).toBe('none')
  })
})

describe('policyNoteFor', () => {
  it('explains a below-threshold security purchase without implying it was expensive', () => {
    expect(policyNoteFor('it', 136, policy, 'USD')).toMatch(/Below the USD 2,000.00 threshold, but a security purchase/)
  })

  it('does not say "below the threshold" about something above it', () => {
    expect(policyNoteFor('it', 5000, { ...policy, threshold: 2000 }, 'USD')).not.toMatch(/Below/)
  })
})

describe('policyImpact', () => {
  const reqs = [
    req({ id: 'a', amount: 4590, vertical: 'iot' }),
    req({ id: 'b', amount: 570, vertical: 'security' }),
    req({ id: 'c', amount: 1128, vertical: 'iot' }),
    req({ id: 'd', amount: 2375, vertical: 'security', state: 'approved', decided_by: 'EU-01', decided_on: '2026-01-01' }),
  ]

  it('counts what a new threshold would actually have caught', () => {
    const out = policyImpact(policy, { threshold: 500 }, reqs)
    expect(out[0]).toMatch(/4 of the 4 .* against 2 today/)
  })

  it('says so plainly when the change catches the same set', () => {
    expect(policyImpact(policy, { threshold: 2100 }, reqs)[0]).toMatch(/^Still 2 of the 4/)
  })

  it('names how many security purchases would go unseen', () => {
    const out = policyImpact(policy, { security_signoff: false }, reqs)
    expect(out.some(s => /1 security purchase below the threshold would go through/.test(s))).toBe(true)
  })

  it('warns about self-approval in terms of who it affects', () => {
    const out = policyImpact(policy, { self_approve: true }, reqs)
    expect(out.some(s => /raise and approve the same spend/.test(s))).toBe(true)
  })

  it('says nothing when nothing changed', () => {
    expect(policyImpact(policy, {}, reqs)).toEqual([])
  })
})

/* ---------------------------------------------------------- requisitions -- */

describe('waiting and decided', () => {
  const reqs = [
    req({ id: 'new', raised_on: '2026-07-31' }),
    req({ id: 'old', raised_on: '2026-07-10' }),
    req({ id: 'done', state: 'approved', decided_by: 'EU-01', decided_on: '2026-07-20' }),
    req({ id: 'no', state: 'declined', decided_by: 'EU-02', decided_on: '2026-07-25', decision_note: 'x' }),
  ]

  it('queues the oldest first, because that is who has waited longest', () => {
    expect(waiting(reqs).map(r => r.id)).toEqual(['old', 'new'])
  })

  it('shows history newest first', () => {
    expect(decided(reqs).map(r => r.id)).toEqual(['no', 'done'])
  })
})

describe('canDecide', () => {
  it('lets the procurement lead decide anything', () => {
    expect(canDecide(req({ need: 'both' }), LEAD, policy, 'USD').ok).toBe(true)
  })

  it('refuses somebody who is not an approver at all, and says what they are', () => {
    const c = canDecide(req(), BUYER, policy, 'USD')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/is not an approver/)
  })

  it('refuses self-approval before it refuses anything else', () => {
    const c = canDecide(req({ raised_by: LEAD.id }), LEAD, policy, 'USD')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/separation of duties/)
  })

  it('allows self-approval where the account has explicitly turned it on', () => {
    expect(canDecide(req({ raised_by: LEAD.id }), LEAD, { ...policy, self_approve: true }).ok).toBe(true)
  })

  it('will not let IT sign off on a finance question', () => {
    const c = canDecide(req({ need: 'finance' }), IT, policy, 'USD')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/needs finance approval/)
  })

  it('will not let finance sign off on a security question', () => {
    const c = canDecide(req({ need: 'it', vertical: 'security' }), CFO, policy)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/IT sign-off/)
  })

  it('holds an approver to their own limit', () => {
    const c = canDecide(req({ amount: 40000 }), CFO, policy, 'USD')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/above the USD 25,000.00 you may approve/)
  })

  it('treats a null limit as no ceiling rather than zero', () => {
    expect(canDecide(req({ amount: 900000 }), LEAD, policy, 'USD').ok).toBe(true)
  })

  it('lets a requester confirm their own within-policy purchase', () => {
    /* Separation of duties is a control on approval. Nothing was approved here,
       so there is nothing to separate — confirming places the order. */
    const c = canDecide(req({ need: 'none', raised_by: BUYER.id }), BUYER, policy)
    expect(c.ok).toBe(true)
  })

  it('still stops a viewer placing a within-policy order', () => {
    const c = canDecide(req({ need: 'none' }), VIEWER, policy, 'USD')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/cannot place an order/)
  })

  it('refuses to re-open something already decided', () => {
    const c = canDecide(req({ state: 'approved' }), LEAD, policy, 'USD')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/not re-openable/)
  })
})

describe('whoCanDecide', () => {
  const team = [LEAD, CFO, IT, BUYER, VIEWER]

  it('names everybody who could sign a finance question', () => {
    expect(whoCanDecide(req({ need: 'finance' }), team, policy).map(m => m.name)).toEqual(['Vikram Shah', 'Meera Iyer'])
  })

  it('leaves out the person who raised it', () => {
    const out = whoCanDecide(req({ need: 'finance', raised_by: CFO.id }), team, policy)
    expect(out.map(m => m.name)).toEqual(['Vikram Shah'])
  })

  it('leaves out anybody who has left', () => {
    const gone = [{ ...CFO, status: 'removed' as const }, LEAD]
    expect(whoCanDecide(req({ need: 'finance' }), gone, policy).map(m => m.name)).toEqual(['Vikram Shah'])
  })

  it('is empty when only the requester could have signed it', () => {
    expect(whoCanDecide(req({ need: 'finance', raised_by: LEAD.id }), [LEAD, BUYER], policy)).toEqual([])
  })
})

describe('validateDecision', () => {
  it('insists on a reason for a decline', () => {
    const c = validateDecision(req(), LEAD, policy, false, '   ')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/cannot revise something they were not told about/)
  })

  it('does not insist on one for an approval', () => {
    expect(validateDecision(req(), LEAD, policy, true, '').ok).toBe(true)
  })

  it('checks permission before it checks the note', () => {
    const c = validateDecision(req(), BUYER, policy, false, '')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/not an approver/)
  })
})

describe('approvalImpact', () => {
  const lines: ReqLine[] = [
    { id: 'l1', requisition_id: 'REQ-1', product_id: 'SKU-5006', name: 'Cold-chain starter', seller: 'Nimbus Sensors', partner_id: 'PTR-1004', quantity: 2, unit_price: 2295, line_total: 4590, sort_order: 1 },
  ]

  it('says the order is placed, not quoted', () => {
    const out = approvalImpact(req(), lines, ACCOUNT, [centre()], 45706.8)
    expect(out[0]).toMatch(/Nimbus Sensors immediately — this is not a quote/)
  })

  it('names both sellers when the requisition spans two', () => {
    const two = [...lines, { ...lines[0], id: 'l2', seller: 'Volta Routers' }]
    expect(approvalImpact(req(), two, ACCOUNT, [centre()], 0)[0]).toMatch(/Nimbus Sensors and Volta Routers/)
  })

  it('counts a monthly commitment three times against a quarterly cap', () => {
    const out = approvalImpact(req({ model: 'monthly', amount: 570 }), lines, ACCOUNT, [centre()], 0)
    expect(out.some(s => /USD 5,430.00 of its USD 18,000.00 cap/.test(s))).toBe(true)
  })

  it('says plainly when it would breach the cap', () => {
    const out = approvalImpact(req({ amount: 20000 }), lines, ACCOUNT, [centre()], 0)
    expect(out.some(s => /goes USD 5,720.00 over its USD 18,000.00 cap/.test(s))).toBe(true)
  })

  it('never reports a negative budget remaining', () => {
    const out = approvalImpact(req({ amount: 500000 }), lines, ACCOUNT, [], 0)
    expect(out.some(s => /-/.test(s))).toBe(false)
  })
})

describe('duplicatesOf', () => {
  const lines: ReqLine[] = [
    { id: 'l1', requisition_id: 'R', product_id: 'SKU-6002', name: 'Sentinel MDR — 24/7', seller: 'Sentinel Cyber', partner_id: 'PTR-1003', quantity: 60, unit_price: 9.5, line_total: 570, sort_order: 1 },
  ]

  it('spots a request for something already held', () => {
    const out = duplicatesOf(lines, [sub()])
    expect(out).toHaveLength(1)
    expect(out[0].sub.quantity).toBe(250)
  })

  it('matches on the name when the line has no product id', () => {
    const out = duplicatesOf([{ ...lines[0], product_id: null }], [sub()])
    expect(out).toHaveLength(1)
  })

  it('ignores something the account cancelled', () => {
    expect(duplicatesOf(lines, [sub({ status: 'cancelled' })])).toEqual([])
  })

  it('still flags a suspended one, which is exactly the case worth flagging', () => {
    expect(duplicatesOf(lines, [sub({ status: 'suspended', why_suspended: 'x' })])).toHaveLength(1)
  })
})

describe('validateRequisition', () => {
  const draft = { title: 'x', reason: 'y', cost_centre: 'CC-4100', lines: [{ quantity: 1, unit_price: 10 }] }

  it('accepts a complete draft', () => {
    expect(validateRequisition(draft, BUYER).ok).toBe(true)
  })

  it('refuses a viewer outright', () => {
    const c = validateRequisition(draft, VIEWER)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/cannot raise a requisition/)
  })

  it('insists on a reason, because an approver deciding without one is guessing', () => {
    expect(validateRequisition({ ...draft, reason: ' ' }, BUYER).ok).toBe(false)
  })

  it('insists on a cost centre', () => {
    expect(validateRequisition({ ...draft, cost_centre: null }, BUYER).ok).toBe(false)
  })

  it('ignores zero-quantity lines when deciding whether there are any', () => {
    expect(validateRequisition({ ...draft, lines: [{ quantity: 0, unit_price: 10 }] }, BUYER).ok).toBe(false)
  })
})

describe('requisitionTotal', () => {
  it('adds the lines and rounds once at the end', () => {
    expect(requisitionTotal([{ quantity: 90, unit_price: 52 }, { quantity: 4, unit_price: 188 }])).toBe(5432)
  })

  it('handles fractional unit prices without drifting', () => {
    expect(requisitionTotal([{ quantity: 3, unit_price: 3.4 }])).toBe(10.2)
  })
})

describe('summariseApprovals', () => {
  const reqs = [
    req({ id: 'a', need: 'finance', raised_by: 'EU-04', amount: 4590 }),
    req({ id: 'b', need: 'it', raised_by: 'EU-03', amount: 570 }),
    req({ id: 'c', need: 'finance', raised_by: 'EU-02', amount: 3000 }),
    req({ id: 'd', state: 'approved', decided_by: 'EU-01', decided_on: '2026-01-01' }),
  ]

  it('separates what an approver can act on from what they cannot', () => {
    const s = summariseApprovals(reqs, CFO, policy)
    expect(s.waiting).toBe(3)
    expect(s.mine).toBe(1)      /* only 'a' — 'b' is IT, 'c' is her own */
    expect(s.blocked).toBe(2)
    expect(s.value).toBe(8160)
  })

  it('gives the lead everything that is not their own', () => {
    expect(summariseApprovals(reqs, LEAD, policy).mine).toBe(3)
  })
})

describe('byRequester', () => {
  it('ranks by approved value and leaves out people who never asked', () => {
    const reqs = [
      req({ id: 'a', raised_by: 'EU-04', state: 'approved', amount: 5432, decided_by: 'EU-02', decided_on: '2026-07-12' }),
      req({ id: 'b', raised_by: 'EU-03', state: 'approved', amount: 1736, decided_by: 'EU-01', decided_on: '2026-04-30' }),
      req({ id: 'c', raised_by: 'EU-04', state: 'pending' }),
    ]
    const out = byRequester(reqs, [LEAD, CFO, IT, BUYER])
    expect(out.map(r => r.member.name)).toEqual(['Anita Desai', 'Karthik Nair'])
    expect(out[0].pending).toBe(1)
    expect(out[0].value).toBe(5432)
  })
})

/* --------------------------------------------------------- cost centres -- */

describe('centreUse and centresAtRisk', () => {
  it('reports how much is left, not just a percentage', () => {
    const u = centreUse(centre({ cap_quarter: 6000, spent_quarter: 5927 }))
    expect(u.pct).toBe(98.8)
    expect(u.left).toBe(73)
    expect(u.over).toBe(false)
  })

  it('flags an overspend rather than clamping at 100', () => {
    const u = centreUse(centre({ cap_quarter: 6000, spent_quarter: 6500 }))
    expect(u.over).toBe(true)
    expect(u.left).toBe(-500)
  })

  it('picks up anything near its cap, worst first', () => {
    const out = centresAtRisk([
      centre({ id: 'a', cap_quarter: 100, spent_quarter: 20 }),
      centre({ id: 'b', cap_quarter: 100, spent_quarter: 99 }),
      centre({ id: 'c', cap_quarter: 100, spent_quarter: 92 }),
    ])
    expect(out.map(c => c.id)).toEqual(['b', 'c'])
  })

  it('does not divide by a zero cap', () => {
    expect(centreUse(centre({ cap_quarter: 0, spent_quarter: 0 })).pct).toBe(0)
  })
})

/* --------------------------------------------------------- subscriptions -- */

describe('committed', () => {
  it('bills a suspended subscription but does not count it as renewing', () => {
    const c = committed([sub({ monthly: 2375 }), sub({ id: 's2', monthly: 165, status: 'suspended', why_suspended: 'x' })])
    expect(c.billed).toBe(2540)
    expect(c.renewing).toBe(2375)
    expect(c.suspended).toBe(165)
  })

  it('drops a cancelled one entirely', () => {
    expect(committed([sub({ monthly: 100, status: 'cancelled' })]).billed).toBe(0)
  })
})

describe('idleSeats', () => {
  it('prices the waste rather than just counting it', () => {
    const out = idleSeats([sub({ quantity: 250, seats_used: 231, unit_price: 9.5 })])
    expect(out.seats).toBe(19)
    expect(out.monthly).toBe(180.5)
    expect(out.worst!.id).toBe('SUB-1')
  })

  it('names the most expensive waste, not the biggest seat count', () => {
    const out = idleSeats([
      sub({ id: 'cheap', quantity: 100, seats_used: 0, unit_price: 1 }),
      sub({ id: 'dear', quantity: 10, seats_used: 0, unit_price: 20 }),
    ])
    expect(out.worst!.id).toBe('dear')
  })

  it('reports nothing to chase when every seat is assigned', () => {
    expect(idleSeats([sub({ quantity: 10, seats_used: 10 })]).worst).toBeNull()
  })
})

describe('renewingWithin', () => {
  it('finds what is coming up, soonest first', () => {
    const out = renewingWithin([
      sub({ id: 'far', renews: '2027-03-31' }),
      sub({ id: 'soon', renews: '2026-08-12' }),
      sub({ id: 'sept', renews: '2026-09-30' }),
    ], 70, '2026-08-01')
    expect(out.map(s => s.id)).toEqual(['soon', 'sept'])
  })

  it('stops at the window rather than listing everything ahead', () => {
    const out = renewingWithin([
      sub({ id: 'aug', renews: '2026-08-12' }),
      sub({ id: 'sept', renews: '2026-09-30' }),
    ], 45, '2026-08-01')
    expect(out.map(s => s.id)).toEqual(['aug'])
  })

  it('leaves out anything already past', () => {
    expect(renewingWithin([sub({ renews: '2026-07-01' })], 45, '2026-08-01')).toEqual([])
  })

  it('still lists a suspended contract, because it still has an end date', () => {
    const out = renewingWithin([sub({ status: 'suspended', why_suspended: 'x', renews: '2026-09-30' })], 90, '2026-08-01')
    expect(out).toHaveLength(1)
  })
})

/* --------------------------------------------------------------- billing -- */

describe('outstanding', () => {
  it('counts open and overdue, and separates how much is late', () => {
    const o = outstanding([
      inv({ id: 'a', total: 14315.76, status: 'open' }),
      inv({ id: 'b', total: 1740, status: 'overdue' }),
      inv({ id: 'c', total: 7711.3, status: 'paid', paid_on: '2026-06-22' }),
    ])
    expect(o.total).toBe(16055.76)
    expect(o.count).toBe(2)
    expect(o.overdue).toBe(1740)
  })
})

describe('spentThisYear', () => {
  it('counts by issue date against the financial year, not the calendar one', () => {
    const spent = spentThisYear([
      inv({ id: 'in', issued: '2026-07-29', total: 100 }),
      inv({ id: 'before', issued: '2026-03-01', total: 999 }),
    ], ACCOUNT)
    expect(spent).toBe(100)
  })
})

describe('budgetPosition', () => {
  it('puts spend next to how much of the year has gone', () => {
    const p = budgetPosition([inv({ issued: '2026-07-29', total: 45706.8 })], ACCOUNT, '2026-08-01')
    expect(p.pct).toBe(38.1)
    expect(p.yearPct).toBe(33.4)
    expect(p.ahead).toBe(true)
    expect(p.left).toBe(74293.2)
  })

  it('is not ahead when spend is behind the year', () => {
    const p = budgetPosition([inv({ issued: '2026-07-29', total: 12000 })], ACCOUNT, '2026-08-01')
    expect(p.ahead).toBe(false)
  })

  it('does not run past 100% of the year', () => {
    expect(budgetPosition([], ACCOUNT, '2030-01-01').yearPct).toBe(100)
  })
})

describe('bySeller', () => {
  it('ranks by value and works out each share', () => {
    const out = bySeller([
      line({ id: 'a', seller: 'Sentinel Cyber', amount: 2375 }),
      line({ id: 'b', seller: 'Sentinel Cyber', amount: 1736 }),
      line({ id: 'c', seller: 'Aventa Telecom', amount: 1240 }),
    ])
    expect(out.map(r => r.seller)).toEqual(['Sentinel Cyber', 'Aventa Telecom'])
    expect(out[0].amount).toBe(4111)
    expect(out[0].lines).toBe(2)
    expect(out[0].share).toBe(76.8)
  })

  it('does not divide by zero on an empty invoice', () => {
    expect(bySeller([])).toEqual([])
  })
})

describe('byCostCentre', () => {
  it('names the centre and calls an unattributed line what it is', () => {
    const out = byCostCentre([
      line({ id: 'a', cost_centre: 'CC-4100', amount: 1240 }),
      line({ id: 'b', cost_centre: null, amount: 100 }),
    ], [centre()])
    expect(out[0].name).toBe('Logistics')
    expect(out[1].name).toBe('Not allocated')
  })
})

describe('reconcileInvoice', () => {
  it('passes when the lines add up and the tax is right', () => {
    const lines = [
      line({ id: 'a', amount: 6700 }),
      line({ id: 'b', amount: 5432, kind: 'oneoff' }),
    ]
    const c = reconcileInvoice(inv(), lines)
    expect(c.ok).toBe(true)
  })

  it('catches lines that do not add to the invoice', () => {
    const c = reconcileInvoice(inv(), [line({ amount: 100 })])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/lines add to USD 100.00/)
  })

  it('catches tax charged at the wrong rate', () => {
    const bad = inv({ tax: 1000, total: 13132 })
    const c = reconcileInvoice(bad, [line({ id: 'a', amount: 6700 }), line({ id: 'b', amount: 5432 })])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/18% of USD 12,132.00 is USD 2,183.76/)
  })

  it('refuses an invoice with nothing behind it', () => {
    const c = reconcileInvoice(inv(), [])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/no lines behind it/)
  })
})

describe('arrears', () => {
  it('is nothing at all on an invoice that is not overdue', () => {
    expect(arrears(inv({ status: 'open' }), '2026-09-01')).toBeNull()
  })

  it('says a reminder went out in the first fortnight, and names both later dates', () => {
    const a = arrears(inv({ status: 'overdue', due: '2026-08-05' }), '2026-08-10')!
    expect(a.days).toBe(5)
    expect(a.stage).toBe('late')
    expect(a.restrictOn).toBe('2026-08-19')
    expect(a.suspendOn).toBe('2026-09-04')
    expect(a.what).toMatch(/pause on 19 Aug 2026, and services suspend on 04 Sept 2026/)
  })

  it('never says "0 days late" without saying what happens next', () => {
    const a = arrears(inv({ status: 'overdue', due: '2026-08-10' }), '2026-08-10')!
    expect(a.days).toBe(0)
    expect(a.what).toMatch(/new orders pause on 24 Aug 2026/)
  })

  it('pauses new orders at a fortnight and says what keeps running', () => {
    const a = arrears(inv({ status: 'overdue', due: '2026-08-05' }), '2026-08-19')!
    expect(a.stage).toBe('restricted')
    expect(a.what).toMatch(/What you already hold keeps running/)
  })

  it('suspends at a month, with the data-retention promise attached', () => {
    const a = arrears(inv({ status: 'overdue', due: '2026-08-05' }), '2026-09-05')!
    expect(a.stage).toBe('suspended')
    expect(a.what).toMatch(/kept for 30 days/)
  })
})

describe('taxPosition', () => {
  it('states what can be reclaimed against the registration', () => {
    const t = taxPosition(ACCOUNT, [inv({ tax: 2183.76 })])
    expect(t.blocked).toBe(false)
    expect(t.reclaimable).toBe(2183.76)
    expect(t.why).toMatch(/29AAJCS4718R1ZM/)
  })

  it('says plainly that an unregistered account can reclaim none of it', () => {
    const t = taxPosition({ ...ACCOUNT, reg_type: 'Not registered', registration: null }, [inv({ tax: 2183.76 })])
    expect(t.blocked).toBe(true)
    expect(t.why).toMatch(/none of it can be reclaimed/)
  })

  it('blocks an exemption claimed with no certificate', () => {
    const t = taxPosition({ ...ACCOUNT, tax_exempt: true, exempt_cert: null }, [inv()])
    expect(t.blocked).toBe(true)
    expect(t.why).toMatch(/no certificate on file/)
  })
})

/* --------------------------------------------------------------- helpers -- */

describe('formatting', () => {
  it('groups thousands and always shows cents', () => {
    expect(money(14315.76, 'USD')).toBe('USD 14,315.76')
    expect(money(0, 'USD')).toBe('USD 0.00')
  })

  it('rounds to whole money where cents would be noise', () => {
    expect(money0(5927.4, 'USD')).toBe('USD 5,927')
  })

  it('marks the money it is given, which is why the currency is a parameter', () => {
    /* Not one business account on this marketplace is invoiced in dollars, and
       both of these used to write a `$` whatever they were handed. With no
       currency table to read, `format` falls back to the ISO code — unambiguous,
       and how a cross-border document is written anyway. Screens pass `fmtIn`
       and get the mark. */
    expect(money(14315.76, 'INR')).toBe('INR 14,315.76')
    expect(money0(5927.4, 'KES')).toBe('KES 5,927')
  })

  it('writes a date a person can read, and hands back what it cannot parse', () => {
    expect(day('2026-08-20')).toBe('20 Aug 2026')
    expect(day(null)).toBe('—')
    expect(day('soon')).toBe('soon')
  })
})

describe('shared vocabulary', () => {
  /* Role names moved to `enterprise_roles` — see enterpriseAdmin.test.ts.
     Approval levels are still ours, because the policy is expressed in them. */
  it('labels every level of approval', () => {
    expect(Object.keys(NEED_LABEL)).toHaveLength(4)
    expect(NEED_LABEL.both).toBe('Finance approval and IT sign-off')
  })
})
