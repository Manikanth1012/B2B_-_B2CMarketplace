import { describe, it, expect } from 'vitest'
import { bandOf, chipCounts, filterEnquiries, answererName, isClosed, localToIso } from './enquiryList'
import type { Enquiry } from './enquiries'

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
