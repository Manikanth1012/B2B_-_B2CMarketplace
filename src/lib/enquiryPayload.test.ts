import { describe, it, expect } from 'vitest'
import {
  quoteLinesPayload, sendQuotePayload, asLine, proposeLinePricePayload, asDeskQuoteLine, isMissingFunction,
  asProposal, isMissingTable,
} from './enquiryPayload'

describe("the seller's proposal on a line", () => {
  it('maps a proposal row, turning a numeric string into a number', () => {
    const p = asProposal({ line_id: 'L1', enquiry_id: 'E', partner_id: 'PTR-1', unit_price: '3899.00',
      note: '', proposed_at: '2026-11-12T10:00:00Z', proposed_by: 'Nimbus' })
    expect(p.unit_price).toBe(3899)
    expect(p.note).toBeNull()
    expect(p.proposed_by).toBe('Nimbus')
  })
  it('knows a table that is not there yet from any other failure', () => {
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.enquiry_line_proposals' in the schema cache" }, 'enquiry_line_proposals')).toBe(true)
    expect(isMissingTable({ code: '42P01', message: 'relation "enquiry_line_proposals" does not exist' }, 'enquiry_line_proposals')).toBe(true)
    expect(isMissingTable({ code: '42501', message: 'permission denied for table enquiry_line_proposals' }, 'enquiry_line_proposals')).toBe(false)
  })
  it('sends a blank note as null', () => {
    expect(proposeLinePricePayload('L1', 10, '  ')).toEqual({ p_line_id: 'L1', p_price: 10, p_note: null })
    expect(proposeLinePricePayload('L1', 10, ' why ')).toEqual({ p_line_id: 'L1', p_price: 10, p_note: 'why' })
  })
  it('maps a desk quote line', () => {
    const d = asDeskQuoteLine({ line_id: 'L1', enquiry_id: 'E', subject: 's', status: 'submitted', currency: 'INR',
      needed_by: null, raised_at: 't', product_id: 'p', name: 'n', quantity: '3', target_unit_price: null,
      floor_price: '100.50', sort_order: 2, seller_unit_price: null, seller_note: null, seller_priced_at: null })
    expect(d.quantity).toBe(3)
    expect(d.floor_price).toBe(100.5)
    expect(d.seller_unit_price).toBeNull()
  })
  it('knows a function that is not there yet from any other failure', () => {
    expect(isMissingFunction({ code: 'PGRST202', message: 'Could not find the function public.my_desk_quote_lines' }, 'my_desk_quote_lines')).toBe(true)
    expect(isMissingFunction({ message: 'function public.propose_line_price(text, numeric, text) does not exist' }, 'propose_line_price')).toBe(true)
    expect(isMissingFunction({ code: 'P0001', message: 'That line is not one of yours on a desk quote.' }, 'propose_line_price')).toBe(false)
    expect(isMissingFunction(null, 'propose_line_price')).toBe(false)
    /* A missing helper inside a function that is there is a real failure. */
    expect(isMissingFunction({ code: '42883', message: 'function enquiry_seller_floor(text, text) does not exist' }, 'propose_line_price')).toBe(false)
  })
})

describe('quoteLinesPayload', () => {
  it('sends product, quantity and target; a missing target is null', () => {
    expect(quoteLinesPayload([
      { product_id: 'SKU-1', quantity: 120, target_unit_price: 3800 },
      { product_id: 'SKU-2', quantity: 5 },
      { product_id: 'SKU-3', quantity: 1, target_unit_price: null },
    ])).toEqual([
      { product_id: 'SKU-1', quantity: 120, target_unit_price: 3800 },
      { product_id: 'SKU-2', quantity: 5, target_unit_price: null },
      { product_id: 'SKU-3', quantity: 1, target_unit_price: null },
    ])
  })
  it('sends nothing the client could use to route or name the line', () => {
    const out = quoteLinesPayload([{ product_id: 'SKU-1', quantity: 1, name: 'x', partner_id: 'p' } as never])
    expect(Object.keys(out[0]).sort()).toEqual(['product_id', 'quantity', 'target_unit_price'])
  })
})

describe('asLine', () => {
  it('turns numeric strings into numbers and keeps nulls', () => {
    const l = asLine({
      id: 'a', enquiry_id: 'ENQ-1', product_id: 'p', name: 'n', partner_id: null,
      quantity: 2, target_unit_price: '10.50', quoted_unit_price: null, sort_order: 1,
    })
    expect(l.target_unit_price).toBe(10.5)
    expect(l.quoted_unit_price).toBeNull()
    expect(l.quantity).toBe(2)
  })
})

describe('sendQuotePayload', () => {
  it('names the arguments send_quote takes and keys prices by line', () => {
    expect(sendQuotePayload('ENQ-1001', { L1: 3899, L2: 0 }, '2026-12-05', '  Holds for the full 120.  ')).toEqual({
      p_id: 'ENQ-1001', p_prices: { L1: 3899, L2: 0 }, p_valid_until: '2026-12-05', p_note: 'Holds for the full 120.',
    })
  })
  it('sends a blank or missing note as null', () => {
    expect(sendQuotePayload('E', { L: 1 }, '2026-12-05', '   ').p_note).toBeNull()
    expect(sendQuotePayload('E', { L: 1 }, '2026-12-05').p_note).toBeNull()
  })
})
