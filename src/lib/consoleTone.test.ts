import { describe, it, expect } from 'vitest'
import { statusTone } from './consoleTone'

/* Every key the console's StatusPill and PriorityPill have ever coloured, with
   the tone it carried before the restyle (green = success, amber = warning,
   red = danger, blue = info, grey = neutral). */
const expected: Record<string, string> = {
  pending: 'warning', approved: 'success', rejected: 'danger', cleared: 'success',
  current: 'info', open: 'info', resolved: 'success', active: 'success',
  paused: 'warning', escalated: 'danger', degraded: 'warning', healthy: 'success',
  live: 'success', draft: 'neutral', deprecated: 'warning', sunset: 'danger',
  supported: 'info', retired: 'danger', revoked: 'danger', expired: 'neutral',
  rotating: 'warning', refused: 'danger', suspended: 'danger', sandbox: 'info',
  production: 'success', required: 'warning', delivered: 'success',
  unhandled: 'danger', timeout: 'danger', not_configured: 'neutral',
  configured: 'info', verified: 'success', failing: 'danger', passed: 'success',
  failed: 'danger',
  P1: 'danger', P2: 'warning', P3: 'info', P4: 'neutral',
}

describe('statusTone', () => {
  for (const [status, tone] of Object.entries(expected)) {
    it(`${status} -> ${tone}`, () => expect(statusTone(status)).toBe(tone))
  }
  it('unknown statuses are neutral', () => {
    expect(statusTone('something_new')).toBe('neutral')
    expect(statusTone('')).toBe('neutral')
  })
  it('does not trip over object prototype keys', () => {
    expect(statusTone('constructor')).toBe('neutral')
  })
})
