import { describe, it, expect } from 'vitest'
import {
  isOpen, workedMinutes, standing, pastTarget, duration, queue, summarise,
  byCategory, categoriesFor, priorityFor, respondTarget, validateTicket,
  validateReply, validateResolution, waitingOn, lastMessage, STATE_LABEL, OPEN_STATES,
} from './support'
import type { Ticket, Sla, Category } from './support'

const NOW = new Date('2026-08-01T12:00:00Z')

function t(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 'SUP-1', subject: 'Something broke', category: 'service', priority: 'P2',
    status: 'open', persona: 'enterprise', org: 'SmartBuild Ltd', opened_by: 'Vikram Shah',
    owner: 'Marketplace — Tier 1', opened_at: '2026-08-01T08:00:00Z',
    sla_mins: 480, response_mins: 20, first_response_mins: 20, resolution_mins: null,
    breached: false, escalated: false, escalated_at: null,
    waiting_on_customer: false, waiting_minutes: 0, waiting_since: null,
    resolved_at: null, resolution_note: null,
    messages: [{ who: 'Vikram Shah', text: 'It is down.', when: '01 Aug 08:00' }],
    account_id: 'ENT-2007', partner_id: null, user_id: 'u1', raised_by_member: 'EU-2007-01',
    ref: null, channel: 'Enterprise portal', sort_order: 1, ...over,
  }
}

const SLA: Sla[] = [
  { priority: 'P1', label: 'Critical', meaning: '', respond_mins: 30, resolve_mins: 240, priority_queue_multiplier: 0.5, sort_order: 1 },
  { priority: 'P2', label: 'High', meaning: '', respond_mins: 120, resolve_mins: 480, priority_queue_multiplier: 0.5, sort_order: 2 },
  { priority: 'P3', label: 'Normal', meaning: '', respond_mins: 480, resolve_mins: 1440, priority_queue_multiplier: 0.75, sort_order: 3 },
]

const CATS: Category[] = [
  { id: 'service', label: 'A service is down', personas: ['operator', 'enterprise', 'consumer'], hint: '', default_priority: 'P1', sort_order: 1 },
  { id: 'billing', label: 'Billing and invoices', personas: ['operator', 'enterprise', 'consumer'], hint: '', default_priority: 'P2', sort_order: 2 },
  { id: 'licensing', label: 'Licences and seats', personas: ['operator', 'enterprise'], hint: '', default_priority: 'P2', sort_order: 3 },
]

/* ----------------------------------------------------------- the clock -- */

describe('workedMinutes', () => {
  it('counts the time since it was raised', () => {
    expect(workedMinutes(t(), NOW)).toBe(240)
  })

  it('does not count time already banked as waiting on the requester', () => {
    expect(workedMinutes(t({ waiting_minutes: 100 }), NOW)).toBe(140)
  })

  it('does not count time it is paused for right now', () => {
    const paused = t({ waiting_on_customer: true, waiting_since: '2026-08-01T10:00:00Z' })
    /* Raised 4 h ago, paused for the last 2 — so 2 h of our time. */
    expect(workedMinutes(paused, NOW)).toBe(120)
  })

  it('stops counting once it is resolved', () => {
    const done = t({ status: 'resolved', resolution_note: 'x', resolved_at: '2026-08-01T09:00:00Z' })
    expect(workedMinutes(done, NOW)).toBe(60)
  })

  it('never goes negative when the pause is longer than the elapsed time', () => {
    expect(workedMinutes(t({ waiting_minutes: 9999 }), NOW)).toBe(0)
  })
})

describe('standing', () => {
  it('says how much is left of the target', () => {
    const s = standing(t(), NOW)
    expect(s.state).toBe('ok')
    expect(s.left).toBe(240)
    expect(s.text).toMatch(/4 h left of the 8 h target/)
  })

  it('warns as it gets close rather than only once it is missed', () => {
    expect(standing(t({ opened_at: '2026-08-01T05:00:00Z' }), NOW).state).toBe('close')
  })

  it('says how far past it is, not just that it is past', () => {
    const s = standing(t({ opened_at: '2026-07-31T20:00:00Z' }), NOW)
    expect(s.state).toBe('over')
    expect(s.text).toMatch(/8 h past the 8 h target/)
  })

  it('says the clock is paused rather than pretending it is on track', () => {
    const s = standing(t({ waiting_on_customer: true, waiting_since: '2026-08-01T10:00:00Z' }), NOW)
    expect(s.state).toBe('paused')
    expect(s.text).toMatch(/paused/)
  })

  it('reports a resolved ticket in worked time, not elapsed', () => {
    const s = standing(t({ status: 'resolved', resolution_note: 'x', resolved_at: '2026-08-01T11:00:00Z', resolution_mins: 90 }), NOW)
    expect(s.state).toBe('settled')
    expect(s.text).toMatch(/1 h 30 min of worked time/)
  })
})

describe('pastTarget', () => {
  it('is read from the clock, not from a flag somebody set', () => {
    /* The stored flag says false; the clock says otherwise. */
    expect(pastTarget(t({ opened_at: '2026-07-31T20:00:00Z', breached: false }), NOW)).toBe(true)
  })

  it('is never true while we are waiting on the requester', () => {
    const paused = t({ opened_at: '2026-07-20T00:00:00Z', waiting_on_customer: true, waiting_since: '2026-07-20T01:00:00Z' })
    expect(pastTarget(paused, NOW)).toBe(false)
  })

  it('is never true for something already resolved', () => {
    expect(pastTarget(t({ status: 'resolved', resolution_note: 'x', opened_at: '2026-01-01T00:00:00Z' }), NOW)).toBe(false)
  })
})

describe('duration', () => {
  it('reads in the units a person would use', () => {
    expect(duration(45)).toBe('45 min')
    expect(duration(120)).toBe('2 h')
    expect(duration(150)).toBe('2 h 30 min')
    expect(duration(2880)).toBe('2 d')
    expect(duration(3000)).toBe('2 d 2 h')
  })

  it('never shows a negative', () => {
    expect(duration(-30)).toBe('0 min')
  })
})

/* ------------------------------------------------------------- the queue -- */

describe('queue', () => {
  it('puts what is past target first and what we are waiting on last', () => {
    const rows = [
      t({ id: 'fresh', opened_at: '2026-08-01T11:30:00Z' }),
      t({ id: 'paused', waiting_on_customer: true, waiting_since: '2026-08-01T09:00:00Z' }),
      t({ id: 'late', opened_at: '2026-07-31T20:00:00Z' }),
      t({ id: 'done', status: 'resolved', resolution_note: 'x' }),
      t({ id: 'close', opened_at: '2026-08-01T05:00:00Z' }),
    ]
    expect(queue(rows, NOW).map(r => r.id)).toEqual(['late', 'close', 'fresh', 'paused', 'done'])
  })
})

describe('summarise', () => {
  const rows = [
    t({ id: 'a', opened_at: '2026-07-31T20:00:00Z' }),
    t({ id: 'b', waiting_on_customer: true, waiting_since: '2026-08-01T10:00:00Z' }),
    t({ id: 'c', owner: null, status: 'new' }),
    t({ id: 'd', status: 'resolved', resolution_note: 'x', resolution_mins: 190 }),
    t({ id: 'e', status: 'closed', resolution_note: 'x', resolution_mins: 60 }),
  ]

  it('separates what is past target from what is merely open', () => {
    const s = summarise(rows, NOW)
    expect(s.open).toBe(3)
    expect(s.past).toBe(1)
    expect(s.waiting).toBe(1)
    expect(s.unassigned).toBe(1)
    expect(s.resolved).toBe(2)
  })

  it('reports a median of worked time rather than elapsed', () => {
    expect(summarise(rows, NOW).medianWorked).toBe(190)
  })

  it('has no median when nothing has been resolved', () => {
    expect(summarise([t()], NOW).medianWorked).toBeNull()
  })
})

describe('byCategory', () => {
  it('names the category and ranks by what is still open', () => {
    const rows = [
      t({ id: 'a', category: 'billing' }),
      t({ id: 'b', category: 'service', status: 'resolved', resolution_note: 'x' }),
      t({ id: 'c', category: 'service', status: 'resolved', resolution_note: 'x' }),
    ]
    const out = byCategory(rows, CATS, NOW)
    expect(out[0].label).toBe('Billing and invoices')
    expect(out[0].open).toBe(1)
    expect(out[1].total).toBe(2)
  })
})

/* ------------------------------------------------------------- raising --- */

describe('categoriesFor', () => {
  it('offers a customer only what applies to them', () => {
    expect(categoriesFor(CATS, 'consumer').map(c => c.id)).toEqual(['service', 'billing'])
  })

  it('offers a business the ones only it has', () => {
    expect(categoriesFor(CATS, 'enterprise').map(c => c.id)).toContain('licensing')
  })
})

describe('priorityFor', () => {
  it('takes the priority from the category rather than asking the requester', () => {
    expect(priorityFor('service', CATS)).toBe('P1')
    expect(priorityFor('nonsense', CATS)).toBe('P3')
  })
})

describe('respondTarget', () => {
  it('quotes the standard target by default', () => {
    expect(respondTarget('P2', SLA)).toBe(120)
  })

  it('halves it for an account whose tier pays for a faster queue', () => {
    expect(respondTarget('P2', SLA, 0.5)).toBe(60)
  })

  it('falls back rather than throwing on a priority it does not know', () => {
    expect(respondTarget('P4' as never, SLA)).toBe(480)
  })
})

describe('validateTicket', () => {
  const draft = { subject: 'Sensors will not pair', category: 'service', note: 'Twelve of the ninety will not pair at all.' }

  it('accepts a usable one', () => {
    expect(validateTicket(draft).ok).toBe(true)
  })

  it('asks for a subject a queue can be triaged on', () => {
    expect(validateTicket({ ...draft, subject: '  ' }).ok).toBe(false)
  })

  it('refuses a note too short to act on, and says why', () => {
    const c = validateTicket({ ...draft, note: 'broken' })
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/only what you write here/)
  })
})

describe('validateResolution', () => {
  it('refuses closing something with no note', () => {
    const c = validateResolution(' ')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/cleared from a queue/)
  })

  it('accepts a real one', () => {
    expect(validateResolution('Replaced the units.').ok).toBe(true)
  })
})

describe('validateReply', () => {
  it('will not send an empty reply', () => {
    expect(validateReply('  ').ok).toBe(false)
    expect(validateReply('ok').ok).toBe(true)
  })
})

describe('waitingOn', () => {
  it('names the requester when the ball is with them', () => {
    expect(waitingOn(t({ waiting_on_customer: true }))).toBe('You')
  })

  it('names the owner when it is being worked', () => {
    expect(waitingOn(t())).toBe('Marketplace — Tier 1')
  })

  it('says plainly that nobody has picked a new one up', () => {
    expect(waitingOn(t({ status: 'new', owner: null }))).toBe('Nobody yet')
  })

  it('has nobody to name once it is closed', () => {
    expect(waitingOn(t({ status: 'resolved', resolution_note: 'x' }))).toBe('—')
  })
})

describe('shared vocabulary', () => {
  it('treats new, open, waiting and escalated as still open', () => {
    expect(OPEN_STATES).toHaveLength(4)
    expect(isOpen(t({ status: 'escalated' }))).toBe(true)
    expect(isOpen(t({ status: 'closed', resolution_note: 'x' }))).toBe(false)
  })

  it('labels the waiting state from the requester\'s side, not the desk\'s', () => {
    expect(STATE_LABEL.waiting).toBe('Waiting on you')
  })

  it('finds the last thing anybody said', () => {
    const two = t({ messages: [
      { who: 'a', text: 'first', when: '1' },
      { who: 'b', text: 'second', when: '2' },
    ] })
    expect(lastMessage(two)!.text).toBe('second')
    expect(lastMessage(t({ messages: [] }))).toBeNull()
  })
})
