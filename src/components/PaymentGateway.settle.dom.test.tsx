/* The provider's page says "succeeded"; the database can still refuse when the
   payment settles (a bundle not bought whole). What the shopper is shown is
   the database's answer. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }))

import { PaymentGateway } from './PaymentGateway'
import { oneTimeCode, settledAs } from '../lib/gateway'
import type { PaymentAttempt, PaymentMethod } from '../lib/gateway'

const WHY = 'A bundle was not bought whole, so nothing was charged.'

const method: PaymentMethod = {
  id: 'card', label: 'Card', kind: 'card', blurb: '', redirects: true, asks_for: 'card details',
  typical: '', sort_order: 1,
}
const attempt: PaymentAttempt = {
  id: 'PA-000123', reference: 'PAY-TEST-1', purpose: 'order', user_id: 'U-1', wallet_id: null,
  order_ref: 'ORD-1', amount: 1200, currency: 'INR', method_id: 'card', market_code: 'IN',
  provider: 'Razorpay', instrument: null, state: 'initiated', failure_reason: null, gateway_ref: null,
  started_at: '2026-11-13T00:00:00Z', decided_at: null, ledger_id: null,
} as PaymentAttempt

async function pay(user: ReturnType<typeof userEvent.setup>) {
  const cvv = document.querySelector('input[type="password"]') as HTMLInputElement
  await user.type(cvv, '123')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.type(screen.getByRole('textbox'), oneTimeCode(attempt.reference))
  await user.click(screen.getByRole('button', { name: 'Confirm payment' }))
}

beforeEach(() => { rpc.mockReset() })
afterEach(cleanup)

describe('PaymentGateway, after settling', () => {
  it('reports a success the database refused as a failed payment, with its reason', async () => {
    rpc.mockResolvedValue({
      data: { already: false, state: 'failed', reference: attempt.reference, note: WHY, reason: WHY, bundles: 'Home office' },
      error: null,
    })
    const onSettled = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<PaymentGateway attempt={attempt} method={method} savedLabel="Visa ending 4242" merchant="Aventa"
      money={n => `₹${n}`} onSettled={onSettled} />)
    await pay(user)

    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    expect(rpc).toHaveBeenCalledWith('settle_payment_attempt', expect.objectContaining({ p_outcome: 'succeeded' }))
    const settled = onSettled.mock.calls[0][0] as PaymentAttempt
    expect(settled.state).toBe('failed')
    expect(settled.failure_reason).toBe(WHY)
  })

  it('passes a success through when the database agrees', async () => {
    rpc.mockResolvedValue({ data: { already: false, state: 'succeeded', reference: attempt.reference, orders: 1 }, error: null })
    const onSettled = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<PaymentGateway attempt={attempt} method={method} savedLabel="Visa ending 4242" merchant="Aventa"
      money={n => `₹${n}`} onSettled={onSettled} />)
    await pay(user)

    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    const settled = onSettled.mock.calls[0][0] as PaymentAttempt
    expect(settled.state).toBe('succeeded')
    expect(settled.failure_reason).toBeNull()
  })
})

describe('settledAs', () => {
  it("takes the database's state over the one asked for", () => {
    expect(settledAs('succeeded', { state: 'failed', note: WHY, failure: WHY })).toEqual({ state: 'failed', failure_reason: WHY })
    expect(settledAs('succeeded', { state: 'failed', note: 'There was nothing left to pay for.' }))
      .toEqual({ state: 'failed', failure_reason: 'There was nothing left to pay for.' })
    expect(settledAs('succeeded', { state: 'succeeded' })).toEqual({ state: 'succeeded', failure_reason: null })
  })

  it("keeps the provider's own reason on a decline", () => {
    expect(settledAs('failed', { state: 'failed' }, 'Your bank declined.')).toEqual({ state: 'failed', failure_reason: 'Your bank declined.' })
  })

  it('finds the first answer on a second call', () => {
    expect(settledAs('failed', { state: 'succeeded', note: 'Payment X was already succeeded.' }, 'Declined'))
      .toEqual({ state: 'succeeded', failure_reason: null })
  })

  it('falls back to what was asked when the answer has no state, and never leaves a failure unexplained', () => {
    expect(settledAs('cancelled', {})).toEqual({ state: 'cancelled', failure_reason: null })
    expect(settledAs('succeeded', { state: 'failed' }).failure_reason).toBe('The payment did not go through.')
    expect(settledAs('succeeded', { state: 'nonsense' })).toEqual({ state: 'succeeded', failure_reason: null })
  })
})
