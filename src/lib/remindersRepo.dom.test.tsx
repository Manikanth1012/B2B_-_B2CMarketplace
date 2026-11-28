import { describe, it, expect, vi, beforeEach } from 'vitest'

/* A chainable stand-in for the query builder: every call is recorded, and
   awaiting it (or .single()) gives the next queued result. */
const db = vi.hoisted(() => {
  const calls: { table: string; ops: [string, unknown[]][] }[] = []
  const results: { data: unknown; error: unknown }[] = []
  const next = () => results.shift() ?? { data: null, error: null }
  function builder(table: string) {
    const entry = { table, ops: [] as [string, unknown[]][] }
    calls.push(entry)
    const b: Record<string, unknown> = {}
    for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'order', 'limit', 'in']) {
      b[op] = (...args: unknown[]) => { entry.ops.push([op, args]); return b }
    }
    b.single = () => { entry.ops.push(['single', []]); return Promise.resolve(next()) }
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, bad)
    return b
  }
  return { calls, results, from: vi.fn((t: string) => builder(t)) }
})

vi.mock('./supabase', () => ({ supabase: { from: db.from } }))

import {
  loadBasketSettings, saveBasketSettings, removeBasketSettings,
  loadSteps, addStep, updateStep, removeStep, saveStepTemplate, removeStepTemplate, loadScheduleLog,
} from './remindersRepo'

const op = (i: number, name: string) => db.calls[i].ops.find(o => o[0] === name)?.[1]

beforeEach(() => { db.calls.length = 0; db.results.length = 0 })

describe('basket settings', () => {
  it('reads every market, the default first', async () => {
    db.results.push({ data: [
      { market: 'KE', pending_days: 3, abandoned_after_days: 5, clear_after_days: 30, updated_at: null, updated_by: null },
      { market: 'default', pending_days: 7, abandoned_after_days: 7, clear_after_days: 90, updated_at: '2026-11-28', updated_by: 'Seeded' },
    ], error: null })
    const r = await loadBasketSettings()
    expect(db.calls[0].table).toBe('basket_settings')
    expect(r.ok && r.value.map(x => x.market)).toEqual(['default', 'KE'])
  })

  it('saves one market by upsert on its code', async () => {
    db.results.push({ data: { market: 'KE', pending_days: 3, abandoned_after_days: 5, clear_after_days: 30 }, error: null })
    const r = await saveBasketSettings('KE', { pending_days: 3, abandoned_after_days: 5, clear_after_days: 30 })
    expect(op(0, 'upsert')).toEqual([{ market: 'KE', pending_days: 3, abandoned_after_days: 5, clear_after_days: 30 }, { onConflict: 'market' }])
    expect(r.ok && r.value.clear_after_days).toBe(30)
  })

  it('says when the database refuses, and when the migration is missing', async () => {
    db.results.push({ data: null, error: { message: 'new row violates check constraint "basket_settings_clearing_after_abandoned"', code: '23514' } })
    const refused = await saveBasketSettings('default', { pending_days: 7, abandoned_after_days: 7, clear_after_days: 7 })
    expect(refused).toEqual({ ok: false, missing: false, error: expect.stringContaining('basket_settings_clearing_after_abandoned') })
    db.results.push({ data: null, error: { message: 'relation "public.basket_settings" does not exist', code: '42P01' } })
    const missing = await loadBasketSettings()
    expect(missing.ok === false && missing.missing).toBe(true)
  })

  it('never removes the default, and removes a market', async () => {
    expect((await removeBasketSettings('default')).ok).toBe(false)
    expect(db.calls).toHaveLength(0)
    db.results.push({ data: [{ market: 'KE' }], error: null })
    const r = await removeBasketSettings('KE')
    expect(op(0, 'delete')).toEqual([])
    expect(op(0, 'eq')).toEqual(['market', 'KE'])
    expect(r).toEqual({ ok: true, value: 1 })
  })
})

describe('steps and their templates', () => {
  const step = {
    id: 'NRS-1', rule_id: 'NR-C-BSK-CLEARING', offset_days: -1, kinds: ['email', 'whatsapp'], enabled: false, sort_order: 2,
    templates: [{ id: 'T-1', step_id: 'NRS-1', kind_id: 'email', subject: 'Clears tomorrow', body: 'On {anchor_date}', edited_by: null, edited_on: null }],
  }

  it('lists a rule’s steps in order, with templates', async () => {
    db.results.push({ data: [step, { ...step, id: 'NRS-0', offset_days: -7, sort_order: 1, templates: [] }], error: null })
    const r = await loadSteps('NR-C-BSK-CLEARING')
    expect(db.calls[0].table).toBe('notification_rule_steps')
    expect(op(0, 'eq')).toEqual(['rule_id', 'NR-C-BSK-CLEARING'])
    expect(String(op(0, 'select')?.[0])).toContain('templates:notification_step_templates(')
    expect(r.ok && r.value.map(s => s.id)).toEqual(['NRS-0', 'NRS-1'])
    expect(r.ok && r.value[1].templates[0].kind_id).toBe('email')
  })

  it('adds a step off by default', async () => {
    db.results.push({ data: step, error: null })
    await addStep('NR-C-BSK-CLEARING', { offset_days: -1, kinds: ['email', 'whatsapp'] })
    expect(op(0, 'insert')).toEqual([{ rule_id: 'NR-C-BSK-CLEARING', offset_days: -1, kinds: ['email', 'whatsapp'], enabled: false, sort_order: 0 }])
  })

  it('updates and removes a step by id', async () => {
    db.results.push({ data: { ...step, enabled: true }, error: null })
    const u = await updateStep('NRS-1', { enabled: true })
    expect(op(0, 'update')).toEqual([{ enabled: true }])
    expect(op(0, 'eq')).toEqual(['id', 'NRS-1'])
    expect(u.ok && u.value.enabled).toBe(true)
    db.results.push({ data: [{ id: 'NRS-1' }], error: null })
    expect(await removeStep('NRS-1')).toEqual({ ok: true, value: 1 })
    expect(db.calls[1].table).toBe('notification_rule_steps')
  })

  it('passes on the guard’s refusal of a channel the rule does not use', async () => {
    db.results.push({ data: null, error: { message: 'A step can only send on the channels its rule uses (email, whatsapp).', code: 'P0001' } })
    const r = await addStep('NR-C-BSK-CLEARING', { offset_days: 0, kinds: ['sms'] })
    expect(r).toEqual({ ok: false, missing: false, error: 'A step can only send on the channels its rule uses (email, whatsapp).' })
  })

  it('writes a template by upsert on step and channel, and removes one', async () => {
    db.results.push({ data: step.templates[0], error: null })
    const r = await saveStepTemplate({ step_id: 'NRS-1', kind_id: 'email', subject: 'Clears tomorrow', body: 'On {anchor_date}' })
    expect(db.calls[0].table).toBe('notification_step_templates')
    const [row, opts] = op(0, 'upsert') as [Record<string, unknown>, unknown]
    expect(row).toMatchObject({ step_id: 'NRS-1', kind_id: 'email', subject: 'Clears tomorrow', body: 'On {anchor_date}' })
    expect(opts).toEqual({ onConflict: 'step_id,kind_id' })
    expect(r.ok && r.value.id).toBe('T-1')
    db.results.push({ data: [], error: null })
    expect(await removeStepTemplate('T-9')).toEqual({ ok: true, value: 0 })
  })
})

describe('the schedule log', () => {
  it('reads newest first, filtered, capped', async () => {
    db.results.push({ data: [{
      id: 7, step_id: 'NRS-1', step_label: '1 day before (n−1)', rule_id: 'NR-B-BSK-CLEARING', event_id: 'basket.clearing', offset_days: -1,
      subject_id: 'B-1', anchor_date: '2026-11-29', sent_on: '2026-11-28', outcome: 'sent', detail: null,
      notification_ids: ['NL-REM-1', 'NL-REM-2'], recipient: 'Vikram Shah', user_id: 'U-1', ref: 'B-1', created_at: '2026-11-28T00:30:05Z',
    }], error: null })
    const r = await loadScheduleLog({ subjectId: 'B-1', limit: 20 })
    expect(db.calls[0].table).toBe('notification_schedule_log')
    expect(op(0, 'eq')).toEqual(['subject_id', 'B-1'])
    expect(op(0, 'order')).toEqual(['created_at', { ascending: false }])
    expect(op(0, 'limit')).toEqual([20])
    expect(r.ok && r.value[0]).toMatchObject({ outcome: 'sent', anchor_date: '2026-11-29', notification_ids: ['NL-REM-1', 'NL-REM-2'] })
  })

  it('keeps the history of a removed step, by its label', async () => {
    db.results.push({ data: [{
      id: 8, step_id: null, step_label: '7 days before (n−7)', rule_id: 'NR-B-BSK-CLEARING', event_id: 'basket.clearing',
      offset_days: -7, subject_id: 'B-1', anchor_date: '2026-12-05', sent_on: '2026-11-28', outcome: 'deferred', detail: 'held back',
      notification_ids: null, recipient: null, user_id: null, ref: null, created_at: '2026-11-28T00:30:05Z',
    }], error: null })
    const r = await loadScheduleLog()
    expect(r.ok && r.value[0]).toMatchObject({ step_id: null, step_label: '7 days before (n−7)', outcome: 'deferred', notification_ids: [] })
  })
})
