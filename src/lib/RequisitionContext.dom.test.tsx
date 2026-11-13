/* The requisition basket kept in the database: loaded on sign-in and re-priced,
   saved after a change, re-read on focus, cleared after a raise — and in memory
   only, as before, when the tables do not exist yet. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { KeptBasket, KeptLine } from './baskets'
import type { RequisitionState } from './RequisitionContext'

vi.mock('./supabase', () => ({ supabase: {} }))

const repo = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn(), accept: vi.fn(), recheck: vi.fn(), leave: vi.fn() }))
vi.mock('./basketRepo', () => ({
  loadRequisitionBasket: () => repo.load(),
  saveRequisitionBasket: (c: string, l: unknown[]) => repo.save(c, l),
  clearRequisitionBasket: () => repo.clear(),
  acceptBasketFlag: (k: string, id: string) => repo.accept(k, id),
  keepBasketOnLeave: (c: string, l: unknown[]) => repo.leave(c, l),
  watchLeaveToken: () => () => {},
}))
vi.mock('./authRepo', () => ({
  onUserChange: (cb: (id: string | null) => void) => { queueMicrotask(() => cb('U-1')); return () => {} },
}))
vi.mock('./requisitionRecheck', () => ({ recheck: (...a: unknown[]) => repo.recheck(...a) }))

import { RequisitionProvider, useRequisition } from './RequisitionContext'

const kept = (over: Partial<KeptLine> = {}): KeptLine => ({
  id: 'L-1', product_id: 'SKU-1', name: 'Gateway', seller: 'Nimbus', partner_id: null, quantity: 2, unit_price: 1000,
  model: 'oneoff', vertical: 'iot', unit: null, quote_line_id: null, bundle_selection_id: null, bundle: null,
  on_contract: true, off_contract_reason: null, stock_note: null, was_quantity: null, flagged_at: null, sort_order: 0,
  ...over,
})
const basketOf = (lines: KeptLine[]): KeptBasket => ({
  id: 'B-1', account_id: 'ENT-1', currency: 'INR', updated_at: '2026-11-01T00:00:00Z', reminded_at: null, lines,
})
const noChange = { prices: [], rules: { account_id: 'ENT-1', off_contract: 'allow' }, changes: [], published: new Map([['SKU-1', { price: 1000, floor_price: null }], ['SKU-2', { price: 50, floor_price: null }]]) }

let state: RequisitionState
function Probe() { state = useRequisition(); return null }
const mount = () => render(<RequisitionProvider><Probe /></RequisitionProvider>)

const ITEM = { product_id: 'SKU-2', name: 'Sensor', seller: 'Nimbus', partner_id: null, unit_price: 50, model: 'oneoff' as const, vertical: 'iot', unit: null, on_contract: true }

beforeEach(() => {
  for (const f of Object.values(repo)) f.mockReset()
  repo.recheck.mockResolvedValue(noChange)
  repo.clear.mockResolvedValue({ ok: true, value: 1 })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('the kept requisition basket', () => {
  it('comes back on sign-in, re-priced: a moved line takes today’s price and one off the shelf is listed', async () => {
    repo.load.mockResolvedValue({ ok: true, value: basketOf([kept(), kept({ id: 'L-2', product_id: 'SKU-9', name: 'Old modem', sort_order: 1 })]) })
    repo.recheck.mockResolvedValue({
      ...noChange,
      changes: [{ product_id: 'SKU-1', name: 'Gateway', was: { unit_price: 1000, on_contract: true }, now: { unit_price: 900, on_contract: true } }],
    })
    repo.save.mockImplementation((_c: string, lines: { product_id: string }[]) =>
      Promise.resolve({ ok: true, value: basketOf(lines.map(() => kept({ unit_price: 900 }))) }))
    mount()
    await waitFor(() => expect(state.restored).not.toBeNull())
    expect(state.basket.lines.map(l => [l.product_id, l.unit_price])).toEqual([['SKU-1', 900]])
    expect(state.restored!.dropped).toEqual(['Old modem'])
    expect(state.restored!.changes.map(c => c.product_id)).toEqual(['SKU-1'])
    /* The re-priced basket is kept. */
    await waitFor(() => expect(repo.save).toHaveBeenCalledTimes(1), { timeout: 2000 })
  })

  it('saves after a change, and takes the flag and id the database returned', async () => {
    repo.load.mockResolvedValue({ ok: true, value: null })
    repo.save.mockResolvedValue({ ok: true, value: basketOf([kept({ id: 'L-9', product_id: 'SKU-2', name: 'Sensor', quantity: 1, unit_price: 50, stock_note: 'No longer available' })]) })
    mount()
    await waitFor(() => expect(repo.load).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    act(() => { state.add(ITEM, 'INR', 1) })
    expect(state.basket.lines).toHaveLength(1)
    await waitFor(() => expect(repo.save).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(repo.save.mock.calls[0][0]).toBe('INR')
    await waitFor(() => expect(state.basket.lines[0].stock_note).toBe('No longer available'))
    expect(state.basket.lines[0].id).toBe('L-9')
  })

  it('keeps a change at once when the page is closed, without waiting out the 400 ms', async () => {
    repo.load.mockResolvedValue({ ok: true, value: null })
    repo.leave.mockReturnValue(true)
    mount()
    await waitFor(() => expect(repo.load).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    act(() => { state.add(ITEM, 'INR', 1) })
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(repo.leave).toHaveBeenCalledTimes(1)
    expect(repo.leave.mock.calls[0][0]).toBe('INR')
    expect((repo.leave.mock.calls[0][1] as { product_id: string }[]).map(l => l.product_id)).toEqual(['SKU-2'])
    /* Sent once: the ordinary save does not follow it. */
    await new Promise(r => setTimeout(r, 600))
    expect(repo.save).not.toHaveBeenCalled()
  })

  it('keeps a change at once when the page is hidden', async () => {
    repo.load.mockResolvedValue({ ok: true, value: null })
    repo.save.mockResolvedValue({ ok: true, value: basketOf([kept({ id: 'L-9', product_id: 'SKU-2', name: 'Sensor', quantity: 1, unit_price: 50 })]) })
    mount()
    await waitFor(() => expect(repo.load).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    act(() => { state.add(ITEM, 'INR', 1) })
    const was = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(repo.save).toHaveBeenCalledTimes(1)
    } finally {
      if (was) Object.defineProperty(document, 'visibilityState', was)
      else delete (document as unknown as Record<string, unknown>).visibilityState
    }
    expect(repo.leave).not.toHaveBeenCalled()
  })

  it('sends nothing on leaving when nothing changed', async () => {
    repo.load.mockResolvedValue({ ok: true, value: basketOf([kept()]) })
    mount()
    await waitFor(() => expect(state.basket.lines).toHaveLength(1))
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(repo.leave).not.toHaveBeenCalled()
  })

  it('reads the basket again on focus and shows a flag written since', async () => {
    repo.load.mockResolvedValueOnce({ ok: true, value: basketOf([kept()]) })
    mount()
    await waitFor(() => expect(state.basket.lines).toHaveLength(1))
    repo.load.mockResolvedValueOnce({ ok: true, value: basketOf([kept({ quantity: 1, stock_note: 'Only 1 left — we reduced this from 2', was_quantity: 2 })]) })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(state.basket.lines[0].stock_note).toBe('Only 1 left — we reduced this from 2'))
    expect(state.basket.lines[0].quantity).toBe(1)
  })

  it('accepts a flag through the database, then reads it again', async () => {
    repo.load.mockResolvedValue({ ok: true, value: basketOf([kept({ stock_note: 'Only 2 left — we reduced this from 4', was_quantity: 4 })]) })
    repo.accept.mockResolvedValue({ ok: true, value: { quantity: 2 } })
    mount()
    await waitFor(() => expect(state.basket.lines[0]?.stock_note).toBeTruthy())
    repo.load.mockResolvedValue({ ok: true, value: basketOf([kept()]) })
    let r: unknown
    await act(async () => { r = await state.acceptFlag('L-1') })
    expect(r).toEqual({ ok: true })
    expect(repo.accept).toHaveBeenCalledWith('requisition', 'L-1')
    expect(state.basket.lines[0].stock_note).toBeNull()
  })

  it('clears the kept basket once a requisition is raised', async () => {
    repo.load.mockResolvedValue({ ok: true, value: basketOf([kept()]) })
    mount()
    await waitFor(() => expect(state.basket.lines).toHaveLength(1))
    await act(async () => { await state.raised() })
    expect(state.basket.lines).toHaveLength(0)
    expect(repo.clear).toHaveBeenCalledTimes(1)
  })

  it('before the migration: warns once, keeps the basket in memory and never saves', async () => {
    repo.load.mockResolvedValue({ ok: false, missing: true, error: 'relation "public.requisition_baskets" does not exist' })
    mount()
    await waitFor(() => expect(repo.load).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    act(() => { state.add(ITEM, 'INR', 1) })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await new Promise(r => setTimeout(r, 500))
    expect(state.basket.lines).toHaveLength(1)
    expect(repo.save).not.toHaveBeenCalled()
    const said = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(c => String(c[0]).includes('baskets migration is not applied'))
    expect(said.length).toBeLessThanOrEqual(1)
    await act(async () => { await state.raised() })
    expect(repo.clear).not.toHaveBeenCalled()
  })
})
