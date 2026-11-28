import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
const rem = vi.hoisted(() => ({
  add: vi.fn(), update: vi.fn(), remove: vi.fn(), saveT: vi.fn(), removeT: vi.fn(), steps: vi.fn(),
}))
vi.mock('../../lib/remindersRepo', () => ({
  addStep: (...a: unknown[]) => rem.add(...a),
  updateStep: (...a: unknown[]) => rem.update(...a),
  removeStep: (...a: unknown[]) => rem.remove(...a),
  saveStepTemplate: (...a: unknown[]) => rem.saveT(...a),
  removeStepTemplate: (...a: unknown[]) => rem.removeT(...a),
  loadSteps: () => rem.steps(),
}))

import { ScheduleSection, scheduleBlock } from './RuleSchedule'
import type { Kind, NotificationEvent, Rule } from '../../lib/notifications'
import type { RuleStep } from '../../lib/remindersRepo'

const kinds = [
  { id: 'inapp', label: 'In-app', max_chars: null, needs: 'none', note: '', sort_order: 1 },
  { id: 'email', label: 'Email', max_chars: null, needs: 'email', note: '', sort_order: 2 },
] as Kind[]
const event = { id: 'invoice.due', label: 'Invoice due', description: '', personas: ['enterprise'], category: 'x',
  sort_order: 1, anchor: 'the invoice due date' } as NotificationEvent
const rule = { id: 'NR-1', persona: 'enterprise', event_id: 'invoice.due', name: 'Invoice reminder', audience: 'Finance',
  kinds: ['inapp', 'email'], throttle: 'Every time', severity: 'normal', enabled: false, mandatory: false, why: '',
  last_sent: null, sort_order: 1 } as Rule
const tpl = (step: string, kind: string) => ({ id: `T-${step}-${kind}`, step_id: step, kind_id: kind, subject: 's', body: 'b', edited_by: null, edited_on: null })
const step = (id: string, offset: number, k: string[], templated: string[], enabled = false): RuleStep => ({
  id, rule_id: 'NR-1', offset_days: offset, kinds: k as RuleStep['kinds'], enabled, sort_order: 0,
  templates: templated.map(t => tpl(id, t)) as RuleStep['templates'],
})

const mount = (steps: RuleStep[], onChanged = vi.fn(async () => {}), ev = event) => {
  render(<ScheduleSection rule={rule} event={ev} kinds={kinds} steps={steps} onChanged={onChanged} />)
  return onChanged
}
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Schedule editor', () => {
  it('lists steps as words with the n form beside them', () => {
    mount([step('S1', -7, ['email'], ['email']), step('S2', 0, ['inapp'], ['inapp']), step('S3', 2, ['inapp'], ['inapp'])])
    expect(screen.getAllByText('7 days before')[0]).toBeTruthy()
    expect(screen.getByText('n−7')).toBeTruthy()
    expect(screen.getAllByText('on the day')[0]).toBeTruthy()
    expect(screen.getAllByText('2 days after')[0]).toBeTruthy()
    expect(screen.getByText('n+2')).toBeTruthy()
  })

  it('adds a step, off, with its wording', async () => {
    rem.add.mockResolvedValue({ ok: true, value: step('NEW', -3, ['inapp'], []) })
    rem.saveT.mockResolvedValue({ ok: true, value: tpl('NEW', 'inapp') })
    const user = userEvent.setup()
    const changed = mount([])
    await user.click(screen.getByRole('button', { name: /Add step/ }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-3' } })
    expect(screen.getByText(/3 days before \(n−3\)/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('In-app subject'), { target: { value: 'Due soon' } })
    fireEvent.change(screen.getByLabelText('In-app message'), { target: { value: 'Due {anchor_date}, {days_left}' } })
    await user.click(screen.getByRole('button', { name: 'Save step' }))
    await waitFor(() => expect(rem.add).toHaveBeenCalledWith('NR-1', { offset_days: -3, kinds: ['inapp'], enabled: false }))
    expect(rem.saveT).toHaveBeenCalledWith(expect.objectContaining({ step_id: 'NEW', kind_id: 'inapp', subject: 'Due soon' }))
    await waitFor(() => expect(changed).toHaveBeenCalled())
  })

  it('refuses an offset the backend refuses', async () => {
    const user = userEvent.setup()
    mount([], vi.fn(async () => {}), { ...event, id: 'subscription.renewal' })
    await user.click(screen.getByRole('button', { name: /Add step/ }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
    expect(screen.getByText(/would never send/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save step' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '45' } })
    expect(screen.getByText(/30 days before to 30 days after/)).toBeTruthy()
  })

  it('refuses a rule that no seller is on', () => {
    mount([], vi.fn(async () => {}), { ...event, id: 'agreement.notice' })
    cleanup()
    render(<ScheduleSection rule={{ ...rule, persona: 'partner' }} event={{ ...event, id: 'agreement.notice' }}
      kinds={kinds} steps={[]} onChanged={async () => {}} />)
    expect((screen.getByRole('button', { name: /Add step/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('flags a missing template and will not turn the step on', async () => {
    const user = userEvent.setup()
    const s = step('S1', -1, ['inapp', 'email'], ['inapp'])
    mount([s])
    expect(screen.getByText('Nothing written for email')).toBeTruthy()
    await user.click(screen.getByRole('switch'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot be turned on: nothing is written for email/)
    expect(rem.update).not.toHaveBeenCalled()
    expect(scheduleBlock(rule, [s])).toMatch(/1 day before on email.*before turning the rule on/)
    expect(scheduleBlock(rule, [step('S2', 0, ['inapp'], ['inapp'])])).toBeNull()
  })

  it('turns a complete step on, and removes one', async () => {
    rem.update.mockResolvedValue({ ok: true, value: step('S1', -1, ['inapp'], ['inapp'], true) })
    rem.remove.mockResolvedValue({ ok: true, value: 1 })
    const user = userEvent.setup()
    const changed = mount([step('S1', -1, ['inapp'], ['inapp'])])
    await user.click(screen.getByRole('switch'))
    await waitFor(() => expect(rem.update).toHaveBeenCalledWith('S1', { enabled: true }))
    await waitFor(() => expect(changed).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /More actions for 1 day before/ }))
    await user.click(screen.getByRole('menuitem', { name: /Remove/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Remove this step?' })
    await user.click(within(dlg).getByRole('button', { name: 'Remove step' }))
    await waitFor(() => expect(rem.remove).toHaveBeenCalledWith('S1'))
  })
})
