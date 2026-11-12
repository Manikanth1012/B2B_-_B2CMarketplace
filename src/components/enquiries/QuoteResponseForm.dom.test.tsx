import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QuoteResponseForm } from './QuoteResponseForm'
import type { Enquiry, EnquiryLine } from '../../lib/enquiries'
import type { LineProposal } from '../../lib/enquiryPayload'

afterEach(() => cleanup())

const money = (n: number, c: string) => `${c} ${n.toFixed(2)}`
const enquiry = {
  id: 'ENQ-SEED-4', type: 'quote', account_id: 'ENT-2007', raised_by: 'EU-2007-01', partner_id: null,
  subject: 'Sensors and firewalls', status: 'submitted', currency: 'INR', needed_by: null, valid_until: null,
  format: null, attendees: null, contact_pref: null, decline_reason: null,
  created_at: '2026-11-11T09:00:00Z', updated_at: '2026-11-11T09:00:00Z', decided_at: null,
} as unknown as Enquiry
const line = (id: string, name: string, over: Partial<EnquiryLine> = {}) => ({
  id, enquiry_id: 'ENQ-SEED-4', product_id: `P-${id}`, name, partner_id: 'PTR-1004', quantity: 4,
  target_unit_price: null, quoted_unit_price: null, sort_order: 1, ...over,
})

const proposal: LineProposal = {
  line_id: 'a', enquiry_id: 'ENQ-SEED-4', partner_id: 'PTR-1004', unit_price: 3899,
  note: 'Includes pairing', proposed_at: '', proposed_by: 'Nimbus Sensors',
}

describe('QuoteResponseForm on a desk quote', () => {
  it("shows each seller's proposal and fills the line with it on 'Use the seller's price'", async () => {
    const onSubmit = vi.fn(async () => null)
    render(<QuoteResponseForm enquiry={enquiry} today="2026-11-12" floors={{}} money={money} onCancel={vi.fn()}
      onSubmit={onSubmit}
      proposals={{ a: proposal }}
      lines={[
        line('a', 'Sensor'),
        line('b', 'Firewall', { sort_order: 2 }),
      ]} />)
    expect(screen.getByText(/Nimbus Sensors proposes INR 3899\.00 a unit/).textContent).toMatch(/Includes pairing/)
    /* Only the line with a proposal offers the button. */
    const use = screen.getAllByRole('button', { name: /Use the seller's price/ })
    expect(use).toHaveLength(1)
    expect(use[0].getAttribute('aria-label')).toBe("Use the seller's price for Sensor")
    expect(use[0].style.minHeight).toBe('44px')

    const sensor = screen.getByLabelText('Sensor · unit price (INR)') as HTMLInputElement
    expect(sensor.value).toBe('')
    fireEvent.click(use[0])
    expect(sensor.value).toBe('3899')

    /* The desk can still price the line itself. */
    fireEvent.change(sensor, { target: { value: '4000' } })
    fireEvent.change(screen.getByLabelText('Firewall · unit price (INR)'), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText(/Quote valid until/), { target: { value: '2026-12-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send the quote' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ a: 4000, b: 120 }, '2026-12-01', ''))
  })

  it('works exactly as before with no proposals (the table is not there yet, or a seller quote)', () => {
    render(<QuoteResponseForm enquiry={enquiry} today="2026-11-12" floors={{}} money={money} onCancel={vi.fn()}
      onSubmit={vi.fn(async () => null)} lines={[line('a', 'Sensor')]} />)
    expect(screen.queryByRole('button', { name: /Use the seller's price/ })).toBeNull()
    expect(screen.queryByText(/proposes/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Send the quote' })).toBeTruthy()
  })
})
