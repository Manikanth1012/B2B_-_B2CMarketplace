/* The checkout confirmation does not promise a held order will activate or
   ship (spec 17, decision 6). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../lib/MarketContext', () => ({ useMarket: () => ({}) }))

import { OrderPlaced } from './Checkout'
import { HELD_FOR_BUYER } from '../lib/risk'

afterEach(cleanup)

describe('the order confirmation', () => {
  it('when an order is held, says it is being checked and promises nothing about activation', () => {
    render(<OrderPlaced orderRef="ORD-1 · ORD-2" email="priya@example.com" held onComplete={() => {}} />)
    expect(screen.getByRole('status').textContent).toBe(HELD_FOR_BUYER)
    expect(screen.getByText(/We've sent a confirmation to priya@example\.com\./)).toBeTruthy()
    expect(screen.queryByText(/activate immediately/)).toBeNull()
    expect(screen.queryByText(/will ship within/)).toBeNull()
  })

  it('when nothing is held, says when it activates and ships, and no check', () => {
    render(<OrderPlaced orderRef="ORD-1" email="priya@example.com" held={false} onComplete={() => {}} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/Digital services will activate immediately/)).toBeTruthy()
  })
})
