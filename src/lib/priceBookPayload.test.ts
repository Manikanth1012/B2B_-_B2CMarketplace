/* What crosses the wire for price books. No database. */
import { describe, it, expect } from 'vitest'
import {
  toAccountPrice, toRules, toPreference, toSellerAccountPrice, toPromotable,
  setPriceArgs, endPriceArgs, promoteArgs, isMissing, friendly, joinNote, settleRows, settleRules,
} from './priceBookPayload'
import { DEFAULT_RULES } from './accountPrices'

describe('rows from the database', () => {
  it('reads an account price, numerics through Number, nulls kept', () => {
    const p = toAccountPrice({
      id: 'AP-1001', account_id: 'ENT-2007', product_id: 'SKU-9001', currency: 'INR',
      unit_price: '21999.00', starts_on: '2026-11-12', ends_on: null, source: 'negotiated',
      quote_line_id: null, quote_ref: null, note: null, set_by: 'Anika Sharma',
      set_at: '2026-11-12T09:00:00+00:00', ended_by: null, ended_at: null, end_reason: null,
    })
    expect(p.unit_price).toBe(21999)
    expect(typeof p.unit_price).toBe('number')
    expect(p.ends_on).toBeNull()
    expect(p.quote_line_id).toBeNull()
    expect(p.source).toBe('negotiated')
  })

  it('keeps a quote-sourced price and its end', () => {
    const p = toAccountPrice({
      id: 'AP-1002', account_id: 'ENT-2007', product_id: 'SKU-9001', currency: 'INR', unit_price: 100.5,
      starts_on: '2026-11-12', ends_on: '2026-12-31', source: 'quote', quote_line_id: 'EL-1', quote_ref: 'ENQ-1',
      note: 'From quote ENQ-1.', set_by: 'x', set_at: 't', ended_by: null, ended_at: null, end_reason: null,
    })
    expect(p).toMatchObject({ unit_price: 100.5, ends_on: '2026-12-31', source: 'quote', quote_ref: 'ENQ-1' })
  })

  it('reads a missing rules row as the default, allow', () => {
    expect(toRules(null, 'ENT-2007')).toEqual(DEFAULT_RULES('ENT-2007'))
    expect(toRules(undefined, 'ENT-2007').off_contract).toBe('allow')
  })

  it('reads a rules row', () => {
    const r = toRules({ account_id: 'ENT-2007', off_contract: 'reason', note: 'n', updated_by: 'Vikram Shah', updated_on: '2026-11-12' }, 'ENT-2007')
    expect(r).toEqual({ account_id: 'ENT-2007', off_contract: 'reason', note: 'n', updated_by: 'Vikram Shah', updated_on: '2026-11-12' })
  })

  it('reads an unknown rule as allow rather than inventing a stricter one', () => {
    expect(toRules({ account_id: 'A', off_contract: 'whatever' }, 'A').off_contract).toBe('allow')
  })

  it('reads a preference', () => {
    expect(toPreference({ id: 'P1', account_id: 'A', kind: 'seller', partner_id: 'PTR-002', product_id: null, note: null, added_by: 'x', added_on: '2026-11-12' }))
      .toEqual({ id: 'P1', account_id: 'A', kind: 'seller', partner_id: 'PTR-002', product_id: null, note: null, added_by: 'x', added_on: '2026-11-12' })
  })

  it('reads a seller account price', () => {
    const s = toSellerAccountPrice({ id: 'AP-1', company: 'SmartBuild Ltd', product_id: 'SKU-9', product_name: 'Thing', currency: 'INR', unit_price: '99.90', starts_on: '2026-11-12', ends_on: null, source: 'negotiated' })
    expect(s.unit_price).toBe(99.9)
    expect(s.company).toBe('SmartBuild Ltd')
  })

  it('reads a promotable quote line from the embedded enquiry, and skips one with no listing', () => {
    const row = { id: 'EL-1', enquiry_id: 'ENQ-1', product_id: 'SKU-9', name: 'Thing', quoted_unit_price: '500.00',
      enquiries: { account_id: 'ENT-2007', status: 'accepted', type: 'quote', currency: 'INR' } }
    expect(toPromotable(row)).toEqual({ id: 'EL-1', enquiry_id: 'ENQ-1', account_id: 'ENT-2007', status: 'accepted', currency: 'INR', product_id: 'SKU-9', name: 'Thing', quoted_unit_price: 500 })
    expect(toPromotable({ ...row, quoted_unit_price: null })?.quoted_unit_price).toBeNull()
    expect(toPromotable({ ...row, product_id: null })).toBeNull()
  })
})

describe('arguments to the functions', () => {
  it('names set_account_price arguments as the migration does', () => {
    expect(setPriceArgs({ account_id: 'A', product_id: 'P', currency: 'INR', unit_price: 10, starts_on: '2026-11-12', ends_on: null, note: '  ' }))
      .toEqual({ p_account: 'A', p_product: 'P', p_currency: 'INR', p_unit_price: 10, p_starts_on: '2026-11-12', p_ends_on: null, p_note: null, p_quote_line: null })
    expect(setPriceArgs({ account_id: 'A', product_id: 'P', currency: 'INR', unit_price: 10, starts_on: '2026-11-12', ends_on: '2026-12-31', note: ' Agreed. ', quote_line_id: 'EL-1' }))
      .toMatchObject({ p_ends_on: '2026-12-31', p_note: 'Agreed.', p_quote_line: 'EL-1' })
  })

  it('names end_account_price and promote_quote_line arguments', () => {
    expect(endPriceArgs('AP-1', ' Contract ended ')).toEqual({ p_id: 'AP-1', p_reason: 'Contract ended' })
    expect(promoteArgs('EL-1', '2026-11-12', null, '')).toEqual({ p_quote_line: 'EL-1', p_starts_on: '2026-11-12', p_ends_on: null, p_note: null })
  })
})

describe('a database the migration has not reached', () => {
  it('recognises a missing table or function', () => {
    expect(isMissing({ code: '42P01', message: 'relation "public.account_prices" does not exist' })).toBe(true)
    expect(isMissing({ code: 'PGRST202', message: 'Could not find the function public.set_account_price' })).toBe(true)
    expect(isMissing({ code: 'PGRST205', message: "Could not find the table 'public.account_prices' in the schema cache" })).toBe(true)
    expect(isMissing({ code: '', message: 'Not found' }, 404)).toBe(true)
  })

  const gone = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.account_prices' in the schema cache" }, status: 404 }

  it('reads a missing table as no prices and no preferences', () => {
    expect(settleRows(gone, toAccountPrice)).toEqual({ ok: true, value: [] })
    expect(settleRows({ ...gone, error: { code: '42P01', message: 'relation "account_preferences" does not exist' }, status: 400 }, toPreference))
      .toEqual({ ok: true, value: [] })
    expect(settleRows({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 }, toSellerAccountPrice))
      .toEqual({ ok: true, value: [] })
  })

  it('reads a missing table, or a missing row, as the default rules', () => {
    expect(settleRules(gone, 'ENT-2007')).toEqual({ ok: true, value: DEFAULT_RULES('ENT-2007') })
    expect(settleRules({ data: null, error: null, status: 200 }, 'ENT-2007')).toEqual({ ok: true, value: DEFAULT_RULES('ENT-2007') })
  })

  it('reports any other failure, and maps rows that came back', () => {
    const refused = settleRows({ data: null, error: { code: '42501', message: 'ERROR: permission denied for table account_prices' }, status: 403 }, toAccountPrice)
    expect(refused).toEqual({ ok: false, error: 'permission denied for table account_prices' })
    expect(settleRules({ data: null, error: { code: '42501', message: 'permission denied' }, status: 403 }, 'A').ok).toBe(false)
    const rows = settleRows({ data: [{ id: 'P1', account_id: 'A', kind: 'product', product_id: 'SKU-9', partner_id: null }], error: null, status: 200 }, toPreference)
    expect(rows.ok && rows.value[0].product_id).toBe('SKU-9')
  })

  it('does not mistake a refusal for a missing table', () => {
    expect(isMissing(null)).toBe(false)
    expect(isMissing({ code: '42501', message: 'new row violates row-level security policy' }, 403)).toBe(false)
    expect(isMissing({ code: 'P0001', message: 'That is below the floor' }, 400)).toBe(false)
  })
})

describe('the database in its own words', () => {
  it('strips the Postgres wrapper', () => {
    expect(friendly('ERROR:  A price starts today or later.')).toBe('A price starts today or later.')
  })
  it('says row-level security in plain words', () => {
    expect(friendly('new row violates row-level security policy for table "account_prices"'))
      .toBe('You are not allowed to change that on this account.')
  })
  it('joins a note only when there is a second sentence', () => {
    expect(joinNote('Below the threshold', null)).toBe('Below the threshold')
    expect(joinNote('Below the threshold.', '1 line is off')).toBe('Below the threshold. 1 line is off')
  })
})
