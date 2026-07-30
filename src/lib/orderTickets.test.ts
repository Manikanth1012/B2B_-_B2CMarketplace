import { describe, it, expect } from 'vitest'
import {
  canRaiseTicket, buildTicket, validateNote, severityFor, slaFor,
  TICKET_CATEGORIES, type TicketableOrder,
} from './orderTickets'

const order = (o: Partial<TicketableOrder> = {}): TicketableOrder => ({
  order_ref: 'ORD-881433', status: 'shipped', seller: 'Aegis Assurance', ...o,
})

describe('canRaiseTicket', () => {
  it('allows it while the order is still in flight', () => {
    expect(canRaiseTicket(order({ status: 'processing' }))).toBe(true)
    expect(canRaiseTicket(order({ status: 'shipped' }))).toBe(true)
  })

  /* A delivered order is the most common thing to complain about — it arrived broken,
     it was the wrong item. Excluding it would leave the feature covering two of the
     seven seeded orders. */
  it('allows it on a delivered order', () => {
    expect(canRaiseTicket(order({ status: 'delivered' }))).toBe(true)
  })

  it('refuses on an order that is already concluded', () => {
    expect(canRaiseTicket(order({ status: 'refunded' }))).toBe(false)
    expect(canRaiseTicket(order({ status: 'cancelled' }))).toBe(false)
  })

  it('is not fooled by casing or stray whitespace', () => {
    expect(canRaiseTicket(order({ status: ' Refunded ' }))).toBe(false)
    expect(canRaiseTicket(order({ status: 'DELIVERED' }))).toBe(true)
  })
})

describe('validateNote', () => {
  it('refuses an empty or whitespace-only description', () => {
    expect(validateNote('').ok).toBe(false)
    expect(validateNote('    ').ok).toBe(false)
  })

  it('refuses something too short to act on', () => {
    expect(validateNote('broken').ok).toBe(false)
  })

  it('accepts a real sentence', () => {
    expect(validateNote('The parcel was marked delivered but nothing arrived.').ok).toBe(true)
  })
})

describe('severity and SLA', () => {
  /* A delivery problem on an order in flight is the time-critical one; a billing
     question can wait a day. */
  it('treats delivery as the urgent category', () => {
    expect(severityFor('Delivery')).toBe('P2')
    expect(severityFor('Billing')).toBe('P3')
  })

  it('never raises a consumer order to P1', () => {
    for (const c of TICKET_CATEGORIES) expect(severityFor(c)).not.toBe('P1')
  })

  it('maps severity to the response clock the seeded tickets use', () => {
    expect(slaFor('P2')).toBe(240)
    expect(slaFor('P3')).toBe(1440)
    expect(slaFor('P4')).toBe(4320)
    expect(slaFor('nonsense')).toBe(1440)
  })
})

describe('buildTicket', () => {
  const at = new Date('2026-07-30T09:15:00Z')

  it('names the order in the subject so a queue can be triaged unopened', () => {
    const t = buildTicket(order(), 'Delivery', 'Nothing arrived at all.', 'Priya Raman', at)
    expect(t.subject).toBe('Delivery issue on ORD-881433')
    expect(t.order_ref).toBe('ORD-881433')
  })

  /* The customer's own words are the first message, not a flattened subject line —
     the agent reads what they actually wrote. */
  it('keeps the customer wording as the opening message', () => {
    const t = buildTicket(order(), 'Product', '  It arrived cracked.  ', 'Priya Raman', at)
    expect(t.messages).toHaveLength(1)
    expect(t.messages[0].text).toBe('It arrived cracked.')
    expect(t.messages[0].who).toBe('Priya Raman')
  })

  it('carries the severity and SLA its category implies', () => {
    expect(buildTicket(order(), 'Delivery', 'Not delivered.', 'P', at).sla_mins).toBe(240)
    expect(buildTicket(order(), 'Billing', 'Charged twice.', 'P', at).severity).toBe('P3')
  })

  it('opens unassigned, unbreached and unescalated', () => {
    const t = buildTicket(order(), 'Technical', 'Cannot activate the eSIM.', 'P', at)
    /* Naming an owner here would invent an assignment nobody has made. */
    expect(t.owner).toBeNull()
    expect(t.breached).toBe(false)
    expect(t.escalated).toBe(false)
    expect(t.status).toBe('inprogress')
    expect(t.channel).toBe('Self-care portal')
  })

  it('gives two tickets raised in one session different ids', () => {
    const a = buildTicket(order(), 'Delivery', 'One problem here.', 'P', at)
    const b = buildTicket(order({ order_ref: 'ORD-880451' }), 'Billing', 'Another problem.', 'P', at)
    expect(a.id).toMatch(/^TCK-\d{8}$/)
    expect(b.id).toMatch(/^TCK-\d{8}$/)
  })
})
