import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeskQuoteLines } from './DeskQuoteLines'
import type { DeskQuoteLine } from '../../lib/enquiryPayload'

afterEach(() => cleanup())

const money = (n: number, c: string) => `${c} ${n.toFixed(2)}`
const line = (over: Partial<DeskQuoteLine> = {}): DeskQuoteLine => ({
  line_id: 'EQL-1', enquiry_id: 'ENQ-SEED-4', subject: 'Sensors for the depot', status: 'submitted',
  currency: 'INR', needed_by: null, raised_at: '2026-11-11T09:00:00Z', product_id: 'SKU-5004',
  name: 'Occupancy sensor', quantity: 40, target_unit_price: 4100, floor_price: 3500, sort_order: 1,
  seller_unit_price: null, seller_note: null, seller_priced_at: null, ...over,
})

describe('DeskQuoteLines', () => {
  it('says calmly that pricing is not set up when the database has no rpc yet, and offers no form', () => {
    render(<DeskQuoteLines state={{ kind: 'missing' }} money={money} onPropose={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toMatch(/not set up yet/)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows nothing when the seller has no lines on desk quotes', () => {
    const { container } = render(<DeskQuoteLines state={{ kind: 'ready', lines: [] }} money={money} onPropose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('offers a labelled price and note on an open line, and sends them', async () => {
    const onPropose = vi.fn(async () => null)
    render(<DeskQuoteLines state={{ kind: 'ready', lines: [line()] }} money={money} onPropose={onPropose} />)
    const price = screen.getByLabelText('Your unit price (INR)')
    const note = screen.getByLabelText('Note to the desk (optional)')
    fireEvent.change(price, { target: { value: '3899' } })
    fireEvent.change(note, { target: { value: ' Includes pairing. ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Propose this price' }))
    await waitFor(() => expect(onPropose).toHaveBeenCalledWith('EQL-1', 3899, 'Includes pairing.'))
    expect(await screen.findByText('The desk has your price.')).toBeTruthy()
  })

  it('refuses a blank or zero price, and one under the floor, in a sentence, without sending', async () => {
    const onPropose = vi.fn(async () => null)
    render(<DeskQuoteLines state={{ kind: 'ready', lines: [line()] }} money={money} onPropose={onPropose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Propose this price' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a unit price above zero.')
    fireEvent.change(screen.getByLabelText('Your unit price (INR)'), { target: { value: '3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Propose this price' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/below the minimum you agreed for this listing, which is INR 3500\.00\./)
    expect(screen.getByLabelText('Your unit price (INR)').getAttribute('aria-invalid')).toBe('true')
    expect(onPropose).not.toHaveBeenCalled()
  })

  it("shows the database's refusal as it was said", async () => {
    const onPropose = vi.fn(async () => 'The desk has already answered ENQ-SEED-4 (it is quoted), so a price can no longer be proposed on it.')
    render(<DeskQuoteLines state={{ kind: 'ready', lines: [line()] }} money={money} onPropose={onPropose} />)
    fireEvent.change(screen.getByLabelText('Your unit price (INR)'), { target: { value: '3600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Propose this price' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/already answered/)
  })

  it('shows the last proposal and offers a new one', () => {
    render(<DeskQuoteLines state={{ kind: 'ready', lines: [line({ seller_unit_price: 3700, seller_priced_at: '2026-11-11T10:00:00Z' })] }}
      money={money} onPropose={vi.fn()} />)
    expect(screen.getByText(/You proposed INR 3700\.00 a unit/)).toBeTruthy()
    expect((screen.getByLabelText('Your unit price (INR)') as HTMLInputElement).value).toBe('3700')
    expect(screen.getByRole('button', { name: 'Propose a new price' })).toBeTruthy()
  })

  it('offers no form once the desk has answered', () => {
    render(<DeskQuoteLines state={{ kind: 'ready', lines: [line({ status: 'quoted' })] }} money={money} onPropose={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toMatch(/already answered this quote/)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
