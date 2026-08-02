import { describe, it, expect } from 'vitest'
import { invoiceFacts, statementFacts, issuerParty, supportBlock, reconciles } from './documentFacts'
import type { InvoiceRow, InvoiceLineRow, AccountRow, StatementRow } from './documentFacts'
import type { Issuer, Template } from './billTemplate'

const ISSUER: Issuer = {
  id: 'default',
  legal_name: 'Aventa Communications Private Limited', trading_name: 'Aventa Telecom',
  lines: ['Level 9, Prestige Tech Park', 'Bengaluru 560103'],
  tax_label: 'GSTIN', tax_id: '29AAACA4471Q1ZV', company_no: 'U64200KA2019PTC128840',
  bank_name: 'HDFC Bank', bank_detail: 'A/c 50200041127903',
  support_phone: '+91 80 4000 6000', support_hours: 'Mon to Sat',
  support_email: 'billing@aventa.com', support_portal: 'aventa.com/help',
  dispute_window: '30 days from the issue date', dispute_note: '', escalation: '',
  terms: ['Payment is due by the date shown.'], updated_by: null, updated_on: null,
}

const TEMPLATE: Template = {
  id: 'BT-ENT', name: 'Enterprise consolidated', audience: 'enterprise', doc_title: 'Consolidated bill',
  accent: '#1B5E20', note: '', system: true, numbering: 'INV-{YYYY}-{SEQ}', next_seq: 715,
  date_format: 'DD MMM YYYY', currency: 'USD', tax_label: 'VAT / GST', rounding: 'Half up, 2 decimal places',
  language: 'English', logo: true, show_order_lines: true,
  remittance: 'Payable by bank transfer within the agreed terms.',
  footer: 'Issued by Aventa Telecom.', updated_by: null, updated_on: null, sort_order: 2,
}

const ACCOUNT: AccountRow = {
  id: 'ENT-2007', company: 'SmartBuild Ltd',
  legal_name: 'SmartBuild Infrastructure Private Limited',
  registration: '29AAJCS4718R1ZM', place_of_supply: 'Karnataka, India', terms: 'Net 30',
}

const INVOICE: InvoiceRow = {
  id: 'INV-2026-0779', account_id: 'ENT-2007', period: 'Jul 2026',
  issued: '2026-07-29', due: '2026-08-20',
  recurring: 6700, oneoff: 5432, tax_rate: 18, tax: 2183.76, total: 14315.76,
  status: 'open', po_ref: 'PO-SB-2026-0409', currency: 'INR',
}

const LINES: InvoiceLineRow[] = [
  { invoice_id: 'INV-2026-0779', kind: 'subscription', description: 'Sentinel MDR', seller: 'Sentinel Cyber', cost_centre: 'CC-OPS', requisition_id: null, quantity: 40, unit_price: 100, amount: 4000 },
  { invoice_id: 'INV-2026-0779', kind: 'subscription', description: 'IoT Connect', seller: 'Aventa Telecom', cost_centre: null, requisition_id: null, quantity: 1, unit_price: 2700, amount: 2700 },
  { invoice_id: 'INV-2026-0779', kind: 'oneoff', description: 'Devices', seller: 'Kestrel Devices', cost_centre: null, requisition_id: 'REQ-4410', quantity: 1, unit_price: 5432, amount: 5432 },
  /* Another invoice's line. It must not leak into this document. */
  { invoice_id: 'INV-2026-0762', kind: 'oneoff', description: 'Elsewhere', seller: null, cost_centre: null, requisition_id: null, quantity: 1, unit_price: 99, amount: 99 },
]

const STATEMENT: StatementRow = {
  id: 'ss-1004-202605', partner_id: 'PTR-1004', partner_name: 'Nimbus Sensors', period: 'May 2026',
  gross: 23237.61, commission: 2556.14, commission_rate: 11, fees: 446.91,
  withholding: 0, refunds: 92.95, net: 20141.61, status: 'paid', order_count: 27,
}

describe('the half that is the same on every document', () => {
  it('prints the trading name in the masthead and the legal entity in the parties block', () => {
    const p = issuerParty(ISSUER)
    expect(p.mark).toBe('Aventa Telecom')
    expect(p.name).toBe('Aventa Communications Private Limited')
    expect(p.tax).toBe('GSTIN 29AAACA4471Q1ZV')
  })

  it('falls back rather than printing a blank bill-from block', () => {
    expect(issuerParty(null).name).toBeTruthy()
    expect(issuerParty(null).tax).toBeNull()
  })

  it('has no support block when the entity has published no way to be reached', () => {
    expect(supportBlock({ ...ISSUER, support_phone: '', support_email: '' })).toBeNull()
    expect(supportBlock(ISSUER)?.phone).toBe('+91 80 4000 6000')
  })
})

describe('a business invoice', () => {
  const f = () => invoiceFacts(INVOICE, LINES, { issuer: ISSUER, account: ACCOUNT, template: TEMPLATE })

  it('names the registered entity and its tax registration', () => {
    expect(f().billedTo.name).toBe('SmartBuild Infrastructure Private Limited')
    expect(f().billedTo.tax).toBe('29AAJCS4718R1ZM')
  })

  it('quotes the purchase order the account requires', () => {
    expect(f().payRef).toBe('PO-SB-2026-0409')
  })

  /* A line counted in both blocks is an invoice whose summary does not
     reconcile, which is the one thing an invoice may not be. */
  it('splits subscriptions from one-offs without counting either twice', () => {
    expect(f().lines).toHaveLength(2)
    expect(f().usage).toHaveLength(1)
    expect(reconciles(f())).toBe(true)
  })

  it('does not take another invoice’s lines', () => {
    expect([...f().lines, ...f().usage].map(l => l.label).join(' ')).not.toContain('Elsewhere')
  })

  it('never carries an advertisement, whatever is live in the storefront', () => {
    expect(f().advert).toBeNull()
  })

  it('carries the rate the invoice states', () => {
    expect(f().taxRate).toBe(18)
  })

  it('reads a settled invoice as settled', () => {
    const paid = invoiceFacts({ ...INVOICE, status: 'paid' }, LINES,
      { issuer: ISSUER, account: ACCOUNT, template: TEMPLATE })
    expect(paid.paid_already).toBe(true)
    expect(paid.paid).toBe(14315.76)
  })

  it('formats the dates the way the document reads them', () => {
    expect(f().issued).toBe('29 Jul 2026')
    expect(f().due).toBe('20 Aug 2026')
  })

  it('takes its payment instructions from the template rather than from nowhere', () => {
    expect(f().howToPay).toBe('Payable by bank transfer within the agreed terms.')
  })
})

describe('a self-billing invoice', () => {
  const f = () => statementFacts(STATEMENT, { issuer: ISSUER, template: TEMPLATE })

  it('reads as a deduction sheet, and reconciles to the net', () => {
    expect(reconciles(f())).toBe(true)
    expect(f().total).toBe(20141.61)
  })

  /* All of it in `usage` and none in `subs`: the seller template carries no
     subscription section, so a gross figure put there would never print and
     the page would be pure deductions with a positive total. */
  it('puts every figure on the section the seller template actually carries', () => {
    expect(f().lines).toEqual([])
    expect(f().usage.map(l => l.label)).toContain('Gross sales')
  })

  it('shows the deductions as negative, and the gross as positive', () => {
    const by = Object.fromEntries(f().usage.map(l => [l.label, l.amount]))
    expect(by['Gross sales']).toBeGreaterThan(0)
    expect(by['Marketplace commission']).toBeLessThan(0)
    expect(by['Platform and payment fees']).toBeLessThan(0)
  })

  it('drops a deduction that is nil rather than printing a zero row', () => {
    const clean = statementFacts({ ...STATEMENT, refunds: 0, fees: 0 }, { issuer: ISSUER, template: TEMPLATE })
    expect(clean.usage.map(l => l.label)).not.toContain('Refunds passed back')
    expect(clean.usage.map(l => l.label)).not.toContain('Platform and payment fees')
    expect(reconciles(clean)).toBe(false)   // because the figures no longer add up to the same net
  })

  it('never carries rewards or an advert — a seller funds them', () => {
    expect(f().rewards).toBeNull()
    expect(f().advert).toBeNull()
  })

  it('takes the reference from the template’s own numbering when given one', () => {
    const withRef = statementFacts(STATEMENT, { issuer: ISSUER, template: TEMPLATE, reference: 'SB-2026-1004-1042' })
    expect(withRef.reference).toBe('SB-2026-1004-1042')
  })

  it('falls back to the statement id when no reference is minted', () => {
    expect(f().reference).toBe('ss-1004-202605')
  })
})

describe('whether a document adds up', () => {
  it('accepts a document whose lines, credits and tax reach its total', () => {
    expect(reconciles(invoiceFacts(INVOICE, LINES, { issuer: ISSUER, account: ACCOUNT, template: TEMPLATE }))).toBe(true)
  })

  it('refuses one that is a cent out in either direction', () => {
    const f = invoiceFacts(INVOICE, LINES, { issuer: ISSUER, account: ACCOUNT, template: TEMPLATE })
    expect(reconciles({ ...f, total: f.total + 0.5 })).toBe(false)
    expect(reconciles({ ...f, total: f.total - 0.5 })).toBe(false)
  })

  it('tolerates a rounding hair', () => {
    const f = invoiceFacts(INVOICE, LINES, { issuer: ISSUER, account: ACCOUNT, template: TEMPLATE })
    expect(reconciles({ ...f, total: f.total + 0.005 })).toBe(true)
  })
})
