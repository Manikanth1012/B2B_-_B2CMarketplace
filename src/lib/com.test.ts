import { describe, it, expect } from 'vitest'
import {
  inFlight, stuck, retryable, pollable, backoffFor, attemptsLeft, unacknowledged, waitingMinutes,
  explain, queueHealth, workOrder, mappingFor, sourceLabel, mappingProblems, missingFor,
  reachable, systemLine, routeNote, STATE_LABEL, STATE_MEANING,
} from './com'
import type { ComSystem, Mapping, Push, ComState } from './com'

const KE: ComSystem = {
  id: 'COM-KE', market: 'KE', name: 'Aventa COM — Kenya', vendor: 'Amdocs',
  standard: 'TMF622', api_version: '4.0.0', base_url: 'https://x/v4',
  auth: 'oauth2-client-credentials', token_url: 'https://x/token',
  timeout_ms: 20000, max_attempts: 5, backoff_seconds: 90, ack_sla_seconds: 600,
  environment: 'production', status: 'live', status_note: null, contact: null,
  note: null, sort_order: 2,
}
const AE: ComSystem = {
  ...KE, id: 'COM-AE', market: 'AE', name: 'Aventa COM — UAE', vendor: 'Ericsson',
  auth: 'mtls', token_url: null, max_attempts: 4, backoff_seconds: 120, ack_sla_seconds: 300,
  status: 'degraded', status_note: 'Acknowledgements are twelve minutes behind.',
}

const push = (over: Partial<Push> = {}): Push => ({
  id: 'COM-1', order_ref: 'ORD-1', order_item_id: 'i1', system_id: 'COM-KE',
  market: 'KE', product_id: 'SKU-2003', product_name: 'Travel eSIM', fulfil: 'esim',
  quantity: 1, state: 'acknowledged', com_order_id: 'PO-ABC', correlation_id: 'c1',
  payload: null, attempts: 1,
  last_attempt_at: '2026-08-08T09:00:00Z', next_attempt_at: null,
  sent_at: '2026-08-08T09:00:00Z', acknowledged_at: '2026-08-08T09:01:00Z',
  completed_at: null, failure_code: null, failure_reason: null, note: null,
  created_at: '2026-08-08T08:58:00Z', ...over,
})

const NOW = '2026-08-08T10:00:00Z'

describe('the states, and what they are not', () => {
  it('does not call an accepted order a delivered one', () => {
    expect(inFlight('acknowledged')).toBe(true)
    expect(inFlight('completed')).toBe(false)
    expect(STATE_MEANING.acknowledged).toMatch(/not on yet/)
    expect(STATE_MEANING.completed).toMatch(/can use it/)
  })

  it('has a word and a meaning for every state', () => {
    const all: ComState[] = ['queued', 'sent', 'acknowledged', 'in-progress',
                             'completed', 'rejected', 'failed', 'cancelled']
    for (const s of all) {
      expect(STATE_LABEL[s], s).toBeTruthy()
      expect(STATE_MEANING[s].length, s).toBeGreaterThan(20)
    }
  })

  it('separates what is waiting from what has stopped', () => {
    expect(stuck('rejected')).toBe(true)
    expect(stuck('failed')).toBe(true)
    expect(stuck('cancelled')).toBe(false)
    expect(stuck('sent')).toBe(false)
  })
})

describe('retryable', () => {
  /* The distinction the whole failure model turns on. */
  it('never offers to retry a rejection, because the field will still be empty', () => {
    expect(retryable(push({ state: 'rejected', failure_code: 'TMF-400' }))).toBe(false)
  })

  it('retries a transport failure, which is what retries are for', () => {
    expect(retryable(push({ state: 'queued', failure_code: 'TRANSPORT' }))).toBe(true)
    expect(retryable(push({ state: 'failed', failure_code: 'TRANSPORT' }))).toBe(true)
  })

  it('does not retry what is already done or in flight at the far end', () => {
    expect(retryable(push({ state: 'completed' }))).toBe(false)
    expect(retryable(push({ state: 'in-progress' }))).toBe(false)
  })

  /* The two actions are disjoint exactly where it matters. A sent-and-silent
     order must be asked about and must not be resent: the far end has the
     request, and a second one is a second SIM. */
  it('asks about a sent order rather than sending it again', () => {
    const p = push({ state: 'sent', acknowledged_at: null })
    expect(retryable(p)).toBe(false)
    expect(pollable(p)).toBe(true)
  })

  it('has nothing to ask about something the far end has never seen', () => {
    expect(pollable(push({ state: 'queued' }))).toBe(false)
    expect(pollable(push({ state: 'rejected' }))).toBe(false)
  })

  it('leaves every stuck row with exactly one thing to do, or a reason there is none', () => {
    for (const state of ['queued', 'sent', 'acknowledged', 'in-progress', 'failed'] as const) {
      const p = push({ state })
      expect(retryable(p) || pollable(p), `${state} offers nothing at all`).toBe(true)
    }
    /* Except a rejection, which is the one case where the answer is genuinely
       "fix the data upstream" and the explanation says so. */
    const r = push({ state: 'rejected', failure_reason: 'Customer reference could not be supplied.' })
    expect(retryable(r) || pollable(r)).toBe(false)
  })
})

describe('backoff', () => {
  it('doubles from the system’s own first interval', () => {
    expect(backoffFor(0, KE)).toBe(90)
    expect(backoffFor(1, KE)).toBe(180)
    expect(backoffFor(3, KE)).toBe(720)
  })

  /* Otherwise a system that has been down for a day schedules a retry beyond
     the heat death of the queue. */
  it('stops doubling before the interval becomes meaningless', () => {
    expect(backoffFor(20, KE)).toBe(backoffFor(6, KE))
  })

  it('counts what is left against the system’s own budget', () => {
    expect(attemptsLeft(push({ attempts: 3 }), KE)).toBe(2)
    expect(attemptsLeft(push({ attempts: 9 }), KE)).toBe(0)
  })
})

describe('unacknowledged', () => {
  /* The state nothing else catches: not failed, so not on a failure list; not
     queued, so no retry picks it up; and the customer is waiting. */
  it('finds an order sent and never answered, past that system’s own window', () => {
    const p = push({ state: 'sent', sent_at: '2026-08-08T09:00:00Z', acknowledged_at: null })
    expect(unacknowledged(p, AE, NOW)).toBe(true)
    expect(unacknowledged(p, KE, NOW)).toBe(true)
  })

  it('measures against the system’s SLA, not a constant', () => {
    /* Six minutes: past the Emirati window of five, inside the Kenyan ten. */
    const p = push({ state: 'sent', sent_at: '2026-08-08T09:54:00Z', acknowledged_at: null })
    expect(unacknowledged(p, AE, NOW)).toBe(true)
    expect(unacknowledged(p, KE, NOW)).toBe(false)
  })

  it('is not a thing that happens to an acknowledged or queued order', () => {
    expect(unacknowledged(push({ state: 'acknowledged' }), AE, NOW)).toBe(false)
    expect(unacknowledged(push({ state: 'queued', sent_at: null }), AE, NOW)).toBe(false)
  })

  it('counts the wait from when it was sent', () => {
    expect(waitingMinutes(push({ sent_at: '2026-08-08T09:30:00Z' }), NOW)).toBe(30)
    expect(waitingMinutes(push({ sent_at: null, created_at: '2026-08-08T09:45:00Z' }), NOW)).toBe(15)
  })
})

describe('explain', () => {
  it('quotes the refusal rather than the state', () => {
    const p = push({
      state: 'rejected',
      failure_reason: 'Aventa COM — Kenya rejected the order: Customer reference could not be supplied.',
    })
    expect(explain(p, KE, NOW)).toMatch(/Customer reference could not be supplied/)
  })

  /* "Rejected" with no next step leaves somebody watching a queue and
     expecting it to clear. */
  it('says a rejection will not be retried, even when the far end said nothing', () => {
    const p = push({ state: 'rejected', failure_reason: null })
    expect(explain(p, KE, NOW)).toMatch(/will not be retried/)
  })

  it('tells a support agent that an accepted order is not a live one', () => {
    expect(explain(push({ state: 'acknowledged' }), KE, NOW)).toMatch(/not on yet/)
  })

  it('names the window a silent order has run past, and the platform note', () => {
    const p = push({ state: 'sent', sent_at: '2026-08-08T09:00:00Z', acknowledged_at: null })
    const s = explain(p, AE, NOW)
    expect(s).toMatch(/60 minutes ago/)
    expect(s).toMatch(/5-minute window/)
    expect(s).toMatch(/twelve minutes behind/)
  })

  it('says when the next attempt is due on something still queued', () => {
    const p = push({ state: 'queued', attempts: 2, next_attempt_at: '2026-08-08T10:06:00Z' })
    expect(explain(p, KE, NOW)).toMatch(/next is due 2026-08-08 10:06/)
  })
})

describe('queueHealth', () => {
  const rows = [
    push({ id: 'a', state: 'completed' }),
    push({ id: 'b', state: 'in-progress' }),
    push({ id: 'c', state: 'sent', sent_at: '2026-08-08T08:00:00Z', acknowledged_at: null }),
    push({ id: 'd', state: 'failed', failure_code: 'TRANSPORT' }),
    push({ id: 'e', state: 'rejected', failure_code: 'TMF-400', failure_reason: 'no customer' }),
  ]

  it('counts what is live, what is moving and what has stopped', () => {
    const h = queueHealth(rows, [KE], NOW)
    expect(h.total).toBe(5)
    expect(h.live).toBe(1)
    expect(h.inFlight).toBe(2)
    expect(h.stuck).toBe(2)
    expect(h.silent).toBe(1)
  })

  /* A customer has paid and cannot be served. Nothing else in the queue
     outranks that. */
  it('puts a rejection above a give-up above silence', () => {
    expect(queueHealth(rows, [KE], NOW).worst!.push.id).toBe('e')
    expect(queueHealth(rows.filter(r => r.id !== 'e'), [KE], NOW).worst!.push.id).toBe('d')
    expect(queueHealth(rows.filter(r => r.id !== 'e' && r.id !== 'd'), [KE], NOW).worst!.push.id).toBe('c')
  })

  it('has nothing to say when there is nothing wrong, which is not the same as zero', () => {
    expect(queueHealth([push({ state: 'completed' })], [KE], NOW).worst).toBeNull()
    expect(queueHealth([], [KE], NOW).worst).toBeNull()
  })

  it('orders the queue the way somebody would work it', () => {
    expect(workOrder(rows, [KE], NOW).map(r => r.id)).toEqual(['e', 'd', 'c', 'b', 'a'])
  })
})

describe('the mapping', () => {
  const M = (over: Partial<Mapping>): Mapping => ({
    id: 'm', applies_to: 'all', source: 'ctx:x', target: 't', transform: null,
    required: false, label: 'X', note: null, sort_order: 1, ...over,
  })

  it('sends the envelope plus the fields for that fulfilment class, and nothing else’s', () => {
    const all = [
      M({ id: '1', applies_to: 'all', target: 'externalId', sort_order: 1 }),
      M({ id: '2', applies_to: 'esim', target: 'e', sort_order: 2 }),
      M({ id: '3', applies_to: 'provisioned', target: 'p', sort_order: 3 }),
    ]
    expect(mappingFor(all, 'esim').map(m => m.id)).toEqual(['1', '2'])
    expect(mappingFor(all, 'provisioned').map(m => m.id)).toEqual(['1', '3'])
  })

  it('says where a value comes from, literal or looked up', () => {
    expect(sourceLabel(M({ source: 'const:MKTPL' }))).toBe('“MKTPL”')
    expect(sourceLabel(M({ source: 'ctx:customer_ref' }))).toBe('customer_ref')
  })

  describe('mappingProblems', () => {
    /* Each of these is a way an integration goes wrong quietly. */
    it('finds two rows fighting over one target', () => {
      const p = mappingProblems([
        M({ id: '1', label: 'Customer', target: 'relatedParty[0].id' }),
        M({ id: '2', label: 'Account', target: 'relatedParty[0].id' }),
      ])
      expect(p[0]).toMatch(/Customer and Account both write to/)
      expect(p[0]).toMatch(/looks like the far end ignoring it/)
    })

    it('finds a characteristic value with no name beside it', () => {
      const p = mappingProblems([
        M({ id: '1', label: 'APN', target: 'productOrderItem[0].product.productCharacteristic[2].value' }),
      ])
      expect(p[0]).toMatch(/no name beside it/)
    })

    it('finds a characteristic named and never sent', () => {
      const p = mappingProblems([
        M({ id: '1', label: 'APN name', target: 'productOrderItem[0].product.productCharacteristic[2].name' }),
      ])
      expect(p[0]).toMatch(/never sends a value/)
    })

    it('is quiet about a properly paired characteristic', () => {
      expect(mappingProblems([
        M({ id: '1', label: 'APN name', source: 'const:apn', target: 'productOrderItem[0].product.productCharacteristic[2].name' }),
        M({ id: '2', label: 'APN', source: 'ctx:apn', target: 'productOrderItem[0].product.productCharacteristic[2].value' }),
      ])).toEqual([])
    })

    /* One class per index, not one index globally: an eSIM and a provisioned
       line send different second characteristics and neither is wrong. */
    it('does not confuse two fulfilment classes using the same index', () => {
      expect(mappingProblems([
        M({ id: '1', applies_to: 'esim', label: 'EID name', target: 'productOrderItem[0].product.productCharacteristic[1].name' }),
        M({ id: '2', applies_to: 'esim', label: 'EID', target: 'productOrderItem[0].product.productCharacteristic[1].value' }),
        M({ id: '3', applies_to: 'provisioned', label: 'ICCID name', target: 'productOrderItem[0].product.productCharacteristic[1].name' }),
        M({ id: '4', applies_to: 'provisioned', label: 'ICCID', target: 'productOrderItem[0].product.productCharacteristic[1].value' }),
      ])).toEqual([])
    })
  })

  describe('missingFor', () => {
    const map = [
      M({ id: '1', label: 'Customer reference', source: 'ctx:customer_ref', target: 'relatedParty[0].id', required: true }),
      M({ id: '2', label: 'Channel', source: 'const:MKTPL', target: 'channel[0].id', required: true }),
      M({ id: '3', label: 'APN', applies_to: 'provisioned', source: 'ctx:apn', target: 'a', required: true }),
      M({ id: '4', label: 'Note', source: 'ctx:note', target: 'n', required: false }),
    ]

    it('names what a rejection would be about, before anything is sent', () => {
      expect(missingFor(map, 'provisioned', { apn: 'iot.aventa' }))
        .toEqual(['Customer reference (relatedParty[0].id)'])
    })

    it('never counts a constant as missing — it cannot be', () => {
      expect(missingFor(map, 'esim', { customer_ref: 'CUS-1' })).toEqual([])
    })

    it('treats an empty string as absent, because the far end will', () => {
      expect(missingFor(map, 'esim', { customer_ref: '' })).toHaveLength(1)
    })

    it('ignores optional fields, which is the point of them being optional', () => {
      expect(missingFor(map, 'esim', { customer_ref: 'CUS-1', note: null })).toEqual([])
    })
  })
})

describe('the systems', () => {
  it('refuses a system that is down, and says orders are queued rather than lost', () => {
    const r = reachable({ ...KE, status: 'down', status_note: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/nothing is lost/i)
  })

  /* Degraded is not down. Orders are getting through slowly, and refusing to
     send would turn a latency problem into an outage. */
  it('still pushes to a degraded system', () => {
    expect(reachable(AE).ok).toBe(true)
  })

  it('describes the interface, the retry budget and the window it owes', () => {
    const s = systemLine(AE)
    expect(s).toMatch(/TMF622 4\.0\.0/)
    expect(s).toMatch(/mutual TLS/)
    expect(s).toMatch(/4 attempts/)
    expect(s).toMatch(/5 minutes/)
  })
})

describe('routes', () => {
  it('says what each route means about who does the work', () => {
    expect(routeNote('telco-com')).toMatch(/not delivered until that system says/)
    expect(routeNote('marketplace')).toMatch(/Nothing leaves for the network/)
    expect(routeNote('seller')).toMatch(/does not perform it/)
  })
})
