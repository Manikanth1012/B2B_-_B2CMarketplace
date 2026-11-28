import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
const h = vi.hoisted(() => ({ cfg: vi.fn(), enable: vi.fn(), steps: vi.fn() }))
vi.mock('../../lib/notificationRepo', async orig => ({
  ...(await orig<object>()),
  loadConfiguration: () => h.cfg(),
  setRuleEnabled: (...a: unknown[]) => h.enable(...a),
}))
vi.mock('../../lib/remindersRepo', () => ({ loadSteps: () => h.steps() }))

import { OperatorNotifications } from './OperatorNotifications'

const book = {
  kinds: [{ id: 'inapp', label: 'In-app', max_chars: null, needs: 'none', note: '', sort_order: 1 },
    { id: 'email', label: 'Email', max_chars: null, needs: 'email', note: '', sort_order: 2 }],
  events: [
    { id: 'basket.clearing', label: 'Basket clearing', description: '', personas: ['consumer'], category: 'Baskets', sort_order: 1, anchor: 'the clearing night' },
    { id: 'order.placed', label: 'Order placed', description: '', personas: ['consumer'], category: 'Orders', sort_order: 2, anchor: null },
  ],
  rules: [
    { id: 'NR-C', persona: 'consumer', event_id: 'basket.clearing', name: 'Basket clearing soon', audience: 'Everyone', kinds: ['inapp', 'email'],
      throttle: 'Every time', severity: 'normal', enabled: false, mandatory: false, why: 'x', last_sent: null, sort_order: 1 },
    { id: 'NR-O', persona: 'consumer', event_id: 'order.placed', name: 'Order placed', audience: 'Everyone', kinds: ['inapp'],
      throttle: 'Every time', severity: 'normal', enabled: true, mandatory: false, why: 'y', last_sent: null, sort_order: 2 },
  ],
  templates: [], preferences: [], log: [], gateways: [], recipients: [], integrations: [], rates: [], tests: [],
}
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Notifications rules: schedule', () => {
  it('shows a Schedule only on the dated rule, and refuses to resume it while a step says nothing', async () => {
    h.cfg.mockResolvedValue(book)
    h.steps.mockResolvedValue({ ok: true, value: [
      { id: 'S1', rule_id: 'NR-C', offset_days: -1, kinds: ['inapp', 'email'], enabled: true, sort_order: 0,
        templates: [{ id: 'T1', step_id: 'S1', kind_id: 'inapp', subject: 's', body: 'b', edited_by: null, edited_on: null }] }] })
    const user = userEvent.setup()
    render(<OperatorNotifications />)
    expect(await screen.findByText('Schedule: Basket clearing soon')).toBeTruthy()
    expect(screen.queryByText('Schedule: Order placed')).toBeNull()
    expect(screen.getByText('Nothing written for email')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(h.enable).not.toHaveBeenCalled()
  })

  it('says scheduled reminders arrive with the migration, and the rules still show', async () => {
    h.cfg.mockResolvedValue(book)
    h.steps.mockResolvedValue({ ok: false, missing: true, error: 'does not exist' })
    render(<OperatorNotifications />)
    expect(await screen.findByText(/Scheduled reminders arrive with migration 20261127400000/)).toBeTruthy()
    expect(screen.getByText('Basket clearing soon')).toBeTruthy()
    expect(screen.queryByText(/^Schedule:/)).toBeNull()
  })

  it('will not resume a dated rule while its schedule could not be read', async () => {
    h.cfg.mockResolvedValue(book)
    h.steps.mockResolvedValue({ ok: false, missing: false, error: 'timeout' })
    const user = userEvent.setup()
    render(<OperatorNotifications />)
    await screen.findByText('Basket clearing soon')
    const row = screen.getByText('Basket clearing soon').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Resume' }))
    expect(h.enable).not.toHaveBeenCalled()
  })
})
