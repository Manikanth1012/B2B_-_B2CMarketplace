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
}

export function statusTone(status: string): Tone {
  return Object.prototype.hasOwnProperty.call(TONES, status) ? TONES[status] : 'neutral'
}
