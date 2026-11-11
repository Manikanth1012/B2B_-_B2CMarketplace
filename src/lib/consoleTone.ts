export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/* Which tone a console status wears. These are the keys `StatusPill` and
   `PriorityPill` have always coloured, each keeping the colour family it had:
   green is done or healthy, amber is waiting or ageing, red is refused or
   broken, blue is in progress or informational, grey is nothing yet. Anything
   not listed is neutral rather than guessed at. */
const TONES: Record<string, Tone> = {
  pending: 'warning', approved: 'success', rejected: 'danger', cleared: 'success',
  current: 'info', open: 'info', resolved: 'success', active: 'success',
  paused: 'warning', escalated: 'danger', degraded: 'warning', healthy: 'success',
  live: 'success', draft: 'neutral', deprecated: 'warning', sunset: 'danger',
  supported: 'info',
  /* The developer portal's own words. */
  retired: 'danger', revoked: 'danger', expired: 'neutral', rotating: 'warning',
  refused: 'danger', suspended: 'danger', sandbox: 'info', production: 'success',
  required: 'warning', delivered: 'success', unhandled: 'danger', timeout: 'danger',
  /* Gateway integration: `configured` (filled in) is not `verified` (proved). */
  not_configured: 'neutral', configured: 'info', verified: 'success',
  failing: 'danger', passed: 'success', failed: 'danger',
  /* Ticket priorities. */
  P1: 'danger', P2: 'warning', P3: 'info', P4: 'neutral',
  /* The account screens: orders on their way are in progress, a refund or
     member still waiting on somebody is amber, a ticket nobody has picked up
     yet is waiting too. `refunded` is the money back, which is the outcome
     asked for; `partial` is final but mixed, so it informs rather than
     celebrates. */
  placed: 'info', processing: 'info', shipped: 'info', 'in-transit': 'info',
  'partly-failed': 'danger', refunded: 'success', cancelled: 'danger',
  requested: 'warning', declined: 'danger', partial: 'info',
  paid: 'success', overdue: 'danger',
  invited: 'warning',
  new: 'warning', inprogress: 'info', closed: 'success',
  /* A ticket parked on somebody outside the desk. */
  waiting: 'warning',
  /* Enquiries: a quote or answer sitting with the buyer is amber. */
  submitted: 'info', quoted: 'warning', accepted: 'success',
  scheduled: 'success', done: 'success', answered: 'warning', withdrawn: 'neutral',
  /* Account prices. `scheduled` is already green for a confirmed demo, and a
     price that has not started must not read like one in force, so a
     scheduled price goes through priceStandingStatus and is shown as
     "scheduled" with this key's tone. */
  'in force': 'success', ended: 'neutral', 'starts later': 'info',
}

export function statusTone(status: string): Tone {
  return Object.prototype.hasOwnProperty.call(TONES, status) ? TONES[status] : 'neutral'
}

/* The status key for a price's standing: only `scheduled` is renamed, so the
   enquiry reading of `scheduled` stays untouched. Pair it with
   label={standing} so the word on screen is still the standing. */
export function priceStandingStatus(standing: 'scheduled' | 'in force' | 'ended' | 'withdrawn'): string {
  return standing === 'scheduled' ? 'starts later' : standing
}
