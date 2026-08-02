import { describe, it, expect } from 'vitest'
import { factsFor, asText, fileNameFor, templateForBill, sectionIds } from './consumerBillDoc'
import type { BillBook } from './consumerBillDoc'
import type { Section, Template } from './billTemplate'
import type { ConsumerBill } from '../types'

/* The claim under test is a narrow one and it is the whole point of the
   module: what the customer reads on screen, what lands in their download and
   what the operator configured are one document. So the tests check that the
   text rendition follows the section list rather than a shape of its own, and
   that nothing on the bill is a constant somebody typed in. */

const SECTIONS: Section[] = [
  { id: 'masthead', label: 'Masthead and logos', note: '', locked: true, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 1 },
  { id: 'parties', label: 'Billed to and bill from', note: '', locked: true, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 2 },
  { id: 'hero', label: 'Amount due panel', note: '', locked: false, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 3 },
  { id: 'subs', label: 'Subscriptions and recurring', note: '', locked: false, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 4 },
  { id: 'usage', label: 'Usage and one-off charges', note: '', locked: false, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 5 },
  { id: 'credits', label: 'Credits and adjustments', note: '', locked: false, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 6 },
  { id: 'rewards', label: 'Reward points', note: '', locked: false, audiences: ['consumer', 'enterprise'], sort_order: 7 },
  { id: 'tax', label: 'Taxation breakdown', note: '', locked: true, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 8 },
  { id: 'summary', label: 'Summary and total', note: '', locked: true, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 9 },
  { id: 'payments', label: 'Payments received', note: '', locked: false, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 10 },
  { id: 'howtopay', label: 'How to pay', note: '', locked: false, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 11 },
  { id: 'paylink', label: 'Payment link and QR', note: '', locked: false, audiences: ['consumer', 'enterprise'], sort_order: 12 },
  { id: 'support', label: 'Support and contact', note: '', locked: false, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 13 },
  { id: 'advert', label: 'Advertisement or banner', note: '', locked: false, audiences: ['consumer'], sort_order: 14 },
  { id: 'terms', label: 'Terms and conditions', note: '', locked: false, audiences: ['consumer', 'enterprise', 'partner'], sort_order: 15 },
  { id: 'slip', label: 'Payment slip', note: '', locked: false, audiences: ['consumer', 'enterprise'], sort_order: 16 },
]

const ALL_IDS = SECTIONS.map(s => s.id)

const TEMPLATE: Template = {
  id: 'BT-CON', name: 'Consumer standard', audience: 'consumer', doc_title: 'Your monthly bill',
  accent: '#0D47A1', note: '', system: true, numbering: 'BILL-{YYYY}-{SEQ}', next_seq: 88214,
  date_format: 'DD MMM YYYY', currency: 'USD', tax_label: 'GST', rounding: 'Half up, 2 decimal places',
  language: 'English', logo: true, show_order_lines: true,
  remittance: 'Pay online, by card on file, or by bank transfer quoting the bill number.',
  footer: 'Issued by Aventa Telecom.', updated_by: null, updated_on: null, sort_order: 1,
}

const bill = (over: Partial<ConsumerBill> = {}): ConsumerBill => ({
  id: 'BILL-2026-07', period: 'July 2026', issued: '01 Aug 2026', due: '15 Aug 2026',
  plan_charge: 18, subscriptions: 49.38, oneoff: 129, tax_rate: 18, tax: 35.35, total: 231.73,
  status: 'open', paid_on: null, pages: 3, ...over,
})

const book = (over: Partial<BillBook> = {}): BillBook => ({
  sections: SECTIONS,
  templates: [TEMPLATE],
  chosen: ALL_IDS.map((section_id, i) => ({ template_id: 'BT-CON', section_id, sort_order: i + 1 })),
  assignments: [{
    id: 'IA-CON', audience: 'consumer', party_id: null, template_id: 'BT-CON',
    why: '', updated_by: null, updated_on: null,
  }],
  issuer: {
    id: 'default',
    legal_name: 'Aventa Communications Private Limited', trading_name: 'Aventa Telecom',
    lines: ['Level 9, Prestige Tech Park', 'Bengaluru 560103'],
    tax_label: 'GSTIN', tax_id: '29AAACA4471Q1ZV', company_no: 'U64200KA2019PTC128840',
    bank_name: 'HDFC Bank', bank_detail: 'A/c 50200041127903',
    support_phone: '+91 80 4000 6000', support_hours: 'Mon to Sat, 09:00–20:00 IST',
    support_email: 'billing@aventa.com', support_portal: 'aventa.com/help',
    dispute_window: '30 days from the issue date', dispute_note: '', escalation: '',
    terms: ['Payment is due by the date shown.', 'Queries within 30 days.'],
    updated_by: null, updated_on: null,
  },
  profile: { name: 'Priya Raman', customer_id: 'CUS-449021', email: 'priya@example.com', msisdn: '+91 98860 41127', city: 'Bengaluru', user_id: 'u1' },
  address: { line1: '42 Rustom Bagh', city: 'Bengaluru', pin: '560017' },
  member: { id: 'LM-4001', name: 'Priya Raman', balance: '2500', user_id: 'u1' },
  ledger: [
    { member: 'LM-4001', when_date: '04 Jul 2026', type: 'earn', points: '1890' },
    { member: 'LM-4001', when_date: '12 Jul 2026', type: 'bonus', points: '500' },
    { member: 'LM-4001', when_date: '19 Jul 2026', type: 'reverse', points: '-585' },
    { member: 'LM-4001', when_date: '24 Jul 2026', type: 'redeem', points: '-1500' },
    /* Outside the period, and on somebody else's ledger. Neither counts. */
    { member: 'LM-4001', when_date: '01 Jun 2026', type: 'adjust', points: '2320' },
    { member: 'LM-4002', when_date: '04 Jul 2026', type: 'earn', points: '9999' },
  ],
  advert: { title: 'Add a second line', subtitle: 'Half price for six months', cta: 'See offers', accent: '#0f6ab4' },
  ...over,
})

describe('which template the customer’s bill is issued on', () => {
  it('is the one assigned to consumers', () => {
    expect(templateForBill(book())?.id).toBe('BT-CON')
  })

  it('carries the sections that template carries, in document order', () => {
    expect(sectionIds(book(), TEMPLATE)).toEqual(ALL_IDS)
  })

  it('has no sections at all when no template is assigned', () => {
    expect(sectionIds(book(), null)).toEqual([])
  })
})

describe('what the bill says', () => {
  it('reads every figure off the bill row', () => {
    const f = factsFor(bill(), book())
    expect(f.reference).toBe('BILL-2026-07')
    expect(f.total).toBe(231.73)
    expect(f.tax).toBe(35.35)
    expect([...f.lines, ...f.usage].reduce((n, l) => n + l.amount, 0)).toBeCloseTo(196.38, 2)
  })

  /* The old download asserted eighteen percent over a bill charged at nine, and
     neither figure could be checked against the other because only one of them
     existed. The rate is a column now, and it is the one that prints. */
  it('prints the rate the bill states', () => {
    expect(factsFor(bill(), book()).taxRate).toBe(18)
    expect(factsFor(bill({ tax_rate: 5, tax: 9.82, total: 206.20 }), book()).taxRate).toBe(5)
  })

  /* A bill from before the column existed still prints something honest. */
  it('falls back to the arithmetic when a bill states no rate', () => {
    const legacy = { ...bill({ tax: 17.76, total: 214.14 }), tax_rate: undefined as unknown as number }
    expect(factsFor(legacy, book()).taxRate).toBe(9)
  })

  it('takes the issuing entity from the record, not from a literal', () => {
    const f = factsFor(bill(), book())
    expect(f.billedFrom.name).toBe('Aventa Communications Private Limited')
    expect(f.billedFrom.mark).toBe('Aventa Telecom')
    expect(f.billedFrom.tax).toBe('GSTIN 29AAACA4471Q1ZV')
  })

  it('drops a charge line that is nil rather than printing a zero', () => {
    const f = factsFor(bill({ subscriptions: 0, oneoff: 0 }), book())
    expect(f.lines.map(l => l.label)).toEqual(['Monthly plan charge'])
    expect(f.usage).toEqual([])
  })

  it('counts reward movements inside the period only, and by type', () => {
    const r = factsFor(bill(), book()).rewards!
    /* 1890 earned + 500 bonus, less the 585 a refund clawed back. */
    expect(r.earned).toBe(1805)
    expect(r.redeemed).toBe(1500)
    expect(r.balance).toBe(2500)
  })

  it('has no reward block for somebody with no membership', () => {
    expect(factsFor(bill(), book({ member: null })).rewards).toBeNull()
  })

  it('marks a settled bill as settled', () => {
    const f = factsFor(bill({ status: 'paid', paid_on: '08 Aug 2026' }), book())
    expect(f.paid_already).toBe(true)
    expect(f.paid).toBe(231.73)
  })
})

describe('the downloaded file', () => {
  const text = (ids: readonly string[] = ALL_IDS, b = bill(), bk = book()) =>
    asText(factsFor(b, bk), TEMPLATE, ids, SECTIONS)

  it('is named after the bill', () => {
    expect(fileNameFor(bill())).toBe('BILL-2026-07.txt')
  })

  it('carries the document title and the trading mark', () => {
    const t = text()
    expect(t).toContain('Your monthly bill')
    expect(t).toContain('Aventa Telecom')
  })

  it('carries both parties, the charges, the tax and the total', () => {
    const t = text()
    expect(t).toContain('Priya Raman')
    expect(t).toContain('Account CUS-449021')
    expect(t).toContain('42 Rustom Bagh')
    expect(t).toContain('GSTIN 29AAACA4471Q1ZV')
    expect(t).toContain('Monthly plan charge')
    expect(t).toContain('GST at 18%')
    expect(t).toContain('$231.73')
  })

  /* The section list is the contract between the three renditions. A file that
     printed a block the operator switched off would make the template screen a
     description of something else. */
  it('omits a section the template does not carry', () => {
    const without = text(ALL_IDS.filter(id => id !== 'advert' && id !== 'slip'))
    expect(without).not.toContain('Add a second line')
    expect(without).not.toContain('PAYMENT SLIP')
    expect(text()).toContain('Add a second line')
    expect(text()).toContain('PAYMENT SLIP')
  })

  it('omits a block this particular bill suppresses', () => {
    /* Already paid: no payment link, no slip — the same rule the screen uses. */
    const paid = text(ALL_IDS, bill({ status: 'paid', paid_on: '08 Aug 2026' }))
    expect(paid).not.toContain('PAY ONLINE')
    expect(paid).not.toContain('PAYMENT SLIP')
  })

  it('omits the reward block when there is no membership', () => {
    expect(text(ALL_IDS, bill(), book({ member: null }))).not.toContain('REWARD POINTS')
  })

  it('prints a totals line rather than items when line detail is suppressed', () => {
    const compact = asText(factsFor(bill(), book()),
      { ...TEMPLATE, show_order_lines: false }, ALL_IDS, SECTIONS)
    expect(compact).toContain('Charges for the period')
    expect(compact).not.toContain('Monthly plan charge')
  })

  it('numbers the terms in the order the issuer wrote them', () => {
    const t = text()
    expect(t).toContain('1. Payment is due by the date shown.')
    expect(t).toContain('2. Queries within 30 days.')
  })

  /* The literals that used to be typed into this file and were wrong. */
  it('carries none of the figures the old hard-coded bill invented', () => {
    const t = text()
    expect(t).not.toContain('Tax (18% GST)')
    expect(t).not.toContain('29AABCI1234L1ZJ')
    expect(t).not.toContain('Whitefield')
    expect(t).not.toContain('Aventa Freedom 50 GB')
  })
})
