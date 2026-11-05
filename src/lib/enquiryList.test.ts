import { describe, it, expect } from 'vitest'
import {
  bandOf, chipCounts, filterEnquiries, answererName, isClosed, localToIso,
  liveQuoteLineIds, acceptedQuoteStanding, quoteChanged, waitingOver,
  quotedBasketLines, quoteBasketClash,
} from './enquiryList'
import type { Enquiry, EnquiryLine } from './enquiries'

describe('liveQuoteLineIds', () => {
  const reqs = [
    { id: 'REQ-1', state: 'pending' }, { id: 'REQ-2', state: 'approved' },
    { id: 'REQ-3', state: 'declined' }, { id: 'REQ-4', state: 'withdrawn' },
  ]
  it('maps quote lines on pending or approved requisitions to that requisition', () => {
    const m = liveQuoteLineIds(reqs, [
      { requisition_id: 'REQ-1', quote_line_id: 'Q1' },
      { requisition_id: 'REQ-2', quote_line_id: 'Q2' },
      { requisition_id: 'REQ-3', quote_line_id: 'Q3' },
      { requisition_id: 'REQ-4', quote_line_id: 'Q4' },
      { requisition_id: 'REQ-1', quote_line_id: null },
      { requisition_id: 'REQ-1' },
    ])
    expect([...m.entries()]).toEqual([['Q1', 'REQ-1'], ['Q2', 'REQ-2']])
  })
})

describe('acceptedQuoteStanding', () => {
  const e = { id: 'E', type: 'quote' as const, status: 'accepted' as const, valid_until: '2026-11-20' }
  const lines = [{ id: 'L1', enquiry_id: 'E' }, { id: 'L2', enquiry_id: 'E' }, { id: 'X', enquiry_id: 'other' }]
  const none = new Set<string>(), noLive = new Map<string, string>()
  const T = '2026-11-05'

  it('offers the lines that are neither in the basket nor on a live requisition', () => {
    expect(acceptedQuoteStanding(e, lines, T, true, none, noLive)).toEqual({ kind: 'add', lineIds: ['L1', 'L2'] })
    expect(acceptedQuoteStanding(e, lines, T, true, new Set(['L1']), noLive)).toEqual({ kind: 'add', lineIds: ['L2'] })
    expect(acceptedQuoteStanding(e, lines, T, true, none, new Map([['L2', 'REQ-9']]))).toEqual({ kind: 'add', lineIds: ['L1'] })
  })
  it('names the requisition once everything is on one', () => {
    const live = new Map([['L1', 'REQ-9'], ['L2', 'REQ-9']])
    expect(acceptedQuoteStanding(e, lines, T, true, none, live)).toEqual({ kind: 'held', requisitionId: 'REQ-9' })
  })
  it('offers nothing when all of it is already in the basket', () => {
    expect(acceptedQuoteStanding(e, lines, T, true, new Set(['L1', 'L2']), noLive)).toEqual({ kind: 'none' })
  })
  it('offers nothing for an expired, unaccepted or not-mine-to-raise quote', () => {
    expect(acceptedQuoteStanding({ ...e, valid_until: '2026-11-04' }, lines, T, true, none, noLive).kind).toBe('none')
    expect(acceptedQuoteStanding({ ...e, status: 'quoted' }, lines, T, true, none, noLive).kind).toBe('none')
    expect(acceptedQuoteStanding(e, lines, T, false, none, noLive).kind).toBe('none')
    expect(acceptedQuoteStanding(e, [], T, true, none, noLive).kind).toBe('none')
  })
})

describe('quoteChanged', () => {
  const l = (over: Partial<EnquiryLine> = {}) => ({ id: 'L1', quantity: 10, quoted_unit_price: 99, ...over })
  it('is false when nothing quoted moved', () => {
    expect(quoteChanged([l(), l({ id: 'L2' })], [l({ id: 'L2' }), l()])).toBe(false)
  })
  it('sees a new price, a new quantity or a different set of lines', () => {
    expect(quoteChanged([l()], [l({ quoted_unit_price: 95 })])).toBe(true)
    expect(quoteChanged([l()], [l({ quantity: 11 })])).toBe(true)
    expect(quoteChanged([l()], [l(), l({ id: 'L2' })])).toBe(true)
    expect(quoteChanged([l()], [l({ id: 'L9' })])).toBe(true)
  })
})

const TODAY = '2026-11-05'

function enq(over: Partial<Enquiry> = {}): Enquiry {
  return {
    id: 'ENQ-1', type: 'quote', account_id: 'A', raised_by: 'U', partner_id: 'P1', subject: 'Sensors',
    status: 'submitted', currency: 'INR', needed_by: null, valid_until: null, format: null,
    attendees: null, contact_pref: null, decline_reason: null,
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', decided_at: null,
    ...over,
  }
}

describe('bandOf', () => {
  it('puts a submitted quote with the responder', () => {
    expect(bandOf(enq(), 'buyer', TODAY)).toBe('theirs')
    expect(bandOf(enq(), 'responder', TODAY)).toBe('mine')
    expect(bandOf(enq(), 'operator', TODAY)).toBe('mine')
  })
  it('puts a live quote with the buyer', () => {
    const e = enq({ status: 'quoted', valid_until: '2026-11-20' })
    expect(bandOf(e, 'buyer', TODAY)).toBe('mine')
    expect(bandOf(e, 'responder', TODAY)).toBe('theirs')
  })
  it('puts an expired quote back with the responder', () => {
    const e = enq({ status: 'quoted', valid_until: '2026-11-01' })
    expect(bandOf(e, 'buyer', TODAY)).toBe('theirs')
    expect(bandOf(e, 'responder', TODAY)).toBe('mine')
  })
  it('makes a scheduled demo the responder’s to finish', () => {
    const e = enq({ type: 'demo', status: 'scheduled' })
    expect(bandOf(e, 'buyer', TODAY)).toBe('theirs')
    expect(bandOf(e, 'responder', TODAY)).toBe('mine')
  })
  it('closes every terminal state', () => {
    for (const status of ['accepted', 'declined', 'withdrawn', 'done', 'closed'] as const) {
      expect(isClosed({ status })).toBe(true)
      expect(bandOf(enq({ status }), 'buyer', TODAY)).toBe('closed')
    }
  })
})

describe('chipCounts', () => {
  it('partitions the list', () => {
    const list = [
      enq({ id: 'a' }),
      enq({ id: 'b', status: 'quoted', valid_until: '2026-11-20' }),
      enq({ id: 'c', status: 'accepted' }),
      enq({ id: 'd', type: 'sales', status: 'answered' }),
    ]
    const c = chipCounts(list, 'buyer', TODAY)
    expect(c).toEqual({ all: 4, mine: 2, theirs: 1, closed: 1 })
    expect(c.mine + c.theirs + c.closed).toBe(c.all)
  })
})

describe('filterEnquiries', () => {
  const list = [
    enq({ id: 'old', updated_at: '2026-11-01T00:00:00Z' }),
    enq({ id: 'new', updated_at: '2026-11-04T00:00:00Z' }),
    enq({ id: 'mine', status: 'quoted', valid_until: '2026-11-20', updated_at: '2026-10-01T00:00:00Z' }),
    enq({ id: 'demo', type: 'demo', status: 'requested', subject: 'Camera walk-through', partner_id: 'P2', updated_at: '2026-11-02T00:00:00Z' }),
  ]
  const all = { chip: 'all' as const, type: 'all' as const, query: '' }

  it('puts what is waiting on you first, then the newest', () => {
    expect(filterEnquiries(list, all, 'buyer', TODAY).map(e => e.id)).toEqual(['mine', 'new', 'demo', 'old'])
  })
  it('filters by chip and type', () => {
    expect(filterEnquiries(list, { ...all, chip: 'mine' }, 'buyer', TODAY).map(e => e.id)).toEqual(['mine'])
    expect(filterEnquiries(list, { ...all, type: 'demo' }, 'buyer', TODAY).map(e => e.id)).toEqual(['demo'])
  })
  it('searches subject, id and who answers', () => {
    const names = new Map([['P2', 'Kestrel Devices']])
    const by = (e: Enquiry) => answererName(e, names)
    expect(filterEnquiries(list, { ...all, query: 'camera' }, 'buyer', TODAY).map(e => e.id)).toEqual(['demo'])
    expect(filterEnquiries(list, { ...all, query: 'kestrel' }, 'buyer', TODAY, by).map(e => e.id)).toEqual(['demo'])
    expect(filterEnquiries(list, { ...all, query: 'OLD' }, 'buyer', TODAY).map(e => e.id)).toEqual(['old'])
  })
  it('does not reorder its input', () => {
    const copy = list.slice()
    filterEnquiries(list, all, 'buyer', TODAY)
    expect(list).toEqual(copy)
  })
})

describe('answererName', () => {
  it('names the desk when no seller has it', () => {
    expect(answererName({ partner_id: null }, new Map())).toBe('Marketplace desk')
  })
  it('falls back to the id when the name is unknown', () => {
    expect(answererName({ partner_id: 'P9' }, new Map())).toBe('P9')
  })
})

describe('localToIso', () => {
  it('turns a typed local time into an instant', () => {
    expect(localToIso('2026-11-10T10:30')).toBe(new Date('2026-11-10T10:30').toISOString())
  })
  it('refuses nothing and nonsense', () => {
    expect(localToIso('')).toBeNull()
    expect(localToIso('soon')).toBeNull()
  })
})

describe('waitingOver', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  const old = '2026-10-25T12:00:00Z'      // eleven days ago
  it('counts an open enquiry untouched for longer than the days given', () => {
    expect(waitingOver({ type: 'quote', status: 'submitted', updated_at: old }, 7, now)).toBe(true)
    expect(waitingOver({ type: 'quote', status: 'submitted', updated_at: '2026-11-04T12:00:00Z' }, 2, now)).toBe(false)
  })
  it('never counts a finished one, however old', () => {
    for (const [type, status] of [['quote', 'accepted'], ['quote', 'declined'], ['quote', 'withdrawn'],
      ['demo', 'done'], ['demo', 'declined'], ['sales', 'closed']] as const) {
      expect(waitingOver({ type, status, updated_at: old }, 2, now), `${type} ${status}`).toBe(false)
    }
  })
  it('keeps a scheduled demo and an answered sales question, which are still open', () => {
    expect(waitingOver({ type: 'demo', status: 'scheduled', updated_at: old }, 7, now)).toBe(true)
    expect(waitingOver({ type: 'sales', status: 'answered', updated_at: old }, 7, now)).toBe(true)
  })
  it('lets everything through when no age is chosen', () => {
    expect(waitingOver({ type: 'sales', status: 'closed', updated_at: old }, 0, now)).toBe(true)
  })
})

describe('quotedBasketLines', () => {
  const q = (over = {}) => ({
    product_id: 'SKU-5004', name: 'Fleet tracker', partner_id: 'PTR-1', quantity: 40, unit_price: 11697, quote_line_id: 'QL-1', ...over,
  })
  const products = new Map([
    ['SKU-5004', { id: 'SKU-5004', seller: 'TrackCo', model: 'oneoff', category_id: 'iot', unit: null }],
    ['SKU-7', { id: 'SKU-7', seller: 'SimCo', model: 'monthly', category_id: 'connectivity', unit: 'per SIM' }],
  ])
  it('takes price, quantity, partner and quote line from the quote, and the rest from the product', () => {
    expect(quotedBasketLines([q()], products)).toEqual({
      lines: [{
        product_id: 'SKU-5004', name: 'Fleet tracker', seller: 'TrackCo', partner_id: 'PTR-1',
        unit_price: 11697, model: 'oneoff', vertical: 'iot', unit: null, quote_line_id: 'QL-1', quantity: 40,
      }],
      unread: [],
    })
  })
  it('reads the model as monthly or one-off', () => {
    expect(quotedBasketLines([q({ product_id: 'SKU-7' })], products).lines[0]).toMatchObject({ model: 'monthly', unit: 'per SIM', seller: 'SimCo' })
  })
  it('names a product it could not read rather than dropping it', () => {
    const r = quotedBasketLines([q(), q({ product_id: 'SKU-GONE', name: 'Old router', quote_line_id: 'QL-2' })], products)
    expect(r.lines.map(l => l.quote_line_id)).toEqual(['QL-1'])
    expect(r.unread).toEqual(['Old router (SKU-GONE) could not be read from the catalogue, so it was not added.'])
  })
})

describe('quoteBasketClash', () => {
  it('has nothing to say for an empty basket or one in the quote currency', () => {
    expect(quoteBasketClash({ currency: '', lines: [] }, 'INR', null)).toBeNull()
    expect(quoteBasketClash({ currency: 'USD', lines: [] }, 'INR', null)).toBeNull()
    expect(quoteBasketClash({ currency: 'INR', lines: [{}] }, 'INR', null)).toBeNull()
  })
  it('says why a basket in another currency cannot take the quote, and how long it holds', () => {
    const m = quoteBasketClash({ currency: 'USD', lines: [{}] }, 'INR', '20 Nov 2026')
    expect(m).toContain('priced in USD and this quote is in INR')
    expect(m).toContain('use Add to requisition')
    expect(m).toContain('until 20 Nov 2026')
  })
})
