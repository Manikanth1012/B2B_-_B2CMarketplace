import { describe, it, expect } from 'vitest'
import { billPages, hex, pdfNameFor } from './billPdf'
import { buildPdf } from './pdf'
import type { BillFacts, Template, Section } from './billTemplate'

/* The fourth rendition of one document. What these check is that it is the
   same document: the same sections, in the catalogue's order, appearing and
   disappearing on the same rules as the screen and the text file. */

const SECTIONS: Section[] = [
  ['masthead', 'Masthead and logos', true], ['parties', 'Billed to and bill from', true],
  ['hero', 'Amount due panel', false], ['subs', 'Subscriptions and recurring', false],
  ['usage', 'Usage and one-off charges', false], ['credits', 'Credits and adjustments', false],
  ['rewards', 'Reward points', false], ['tax', 'Taxation breakdown', true],
  ['summary', 'Summary and total', true], ['payments', 'Payments received', false],
  ['howtopay', 'How to pay', false], ['paylink', 'Payment link and QR', false],
  ['support', 'Support and contact', false], ['advert', 'Advertisement or banner', false],
  ['terms', 'Terms and conditions', false], ['slip', 'Payment slip', false],
].map(([id, label, locked], i) => ({
  id: id as string, label: label as string, note: '', locked: locked as boolean,
  audiences: ['consumer', 'enterprise', 'partner'], sort_order: i + 1,
}))

const ALL = SECTIONS.map(s => s.id)

const TEMPLATE: Template = {
  id: 'BT-CON', name: 'Consumer standard', audience: 'consumer', doc_title: 'Your monthly bill',
  accent: '#0D47A1', note: '', system: true, numbering: 'BILL-{YYYY}-{SEQ}', next_seq: 88214,
  date_format: 'DD MMM YYYY', currency: 'USD', tax_label: 'GST', rounding: 'Half up, 2 decimal places',
  language: 'English', logo: true, show_order_lines: true,
  remittance: 'Pay online, by card on file, or by bank transfer quoting the bill number.',
  footer: 'Issued by Aventa Telecom.', updated_by: null, updated_on: null, sort_order: 1,
}

const facts = (over: Partial<BillFacts> = {}): BillFacts => ({
  reference: 'BILL-2026-07', issued: '01 Aug 2026', due: '15 Aug 2026',
  currency: 'INR', currencyMark: '₹', taxLabel: 'GST',
  billedTo: {
    name: 'Priya Raman', ref: 'CUS-449021',
    lines: ['42 Rustom Bagh, HAL Old Airport Road', 'Bengaluru 560017'],
    contact: 'priya.raman@6dtech.co.in', tax: null,
  },
  billedFrom: {
    name: 'Aventa Communications Private Limited', mark: 'Aventa Telecom',
    lines: ['Level 9, Prestige Tech Park', 'Bengaluru 560103'],
    tax: 'GSTIN 29AAACA4471Q1ZV',
  },
  lines: [{ label: 'Monthly plan charge', detail: 'July 2026', amount: 18 }],
  usage: [{ label: 'One-off charges and devices', detail: 'Billed in arrears', amount: 129 }],
  credits: 0, paid: 0, taxRate: 18, tax: 35.35, total: 231.73,
  rewards: { earned: 3440, redeemed: 1500, balance: 2500 },
  advert: { title: 'Add a second line', subtitle: 'Half price for six months', cta: 'See offers', accent: '#0f6ab4' },
  paid_already: false,
  support: {
    phone: '+91 80 4000 6000', hours: 'Mon to Sat, 09:00–20:00 IST',
    email: 'billing@aventa.com', portal: 'aventa.com/help', window: '30 days from the issue date',
  },
  howToPay: 'Bank transfer.', terms: ['Payment is due by the date shown.'], payRef: 'CUS-449021',
  ...over,
})

const words = (pages: ReturnType<typeof billPages>) =>
  pages.flat().filter(o => o.kind === 'text').map(o => (o as { text: string }).text).join(' | ')

describe('the accent colour', () => {
  it('reads a hex triple', () => {
    expect(hex('#0D47A1')).toEqual([13, 71, 161])
    expect(hex('4527A0')).toEqual([69, 39, 160])
  })

  it('falls back rather than throwing on nonsense', () => {
    expect(hex('teal')).toEqual([13, 71, 161])
    expect(hex('')).toEqual([13, 71, 161])
  })
})

describe('what the document contains', () => {
  it('names both parties, the charges, the tax and the total', () => {
    const t = words(billPages(facts(), TEMPLATE, ALL, SECTIONS))
    expect(t).toContain('Aventa Telecom')
    expect(t).toContain('Your monthly bill')
    expect(t).toContain('Priya Raman')
    expect(t).toContain('Account CUS-449021')
    expect(t).toContain('GSTIN 29AAACA4471Q1ZV')
    expect(t).toContain('Monthly plan charge')
    expect(t).toContain('GST at 18%')
    expect(t).toContain('\u20b9231.73')
  })

  /* The rule that makes this the same document as the other three. */
  it('omits a section the template does not carry', () => {
    const without = words(billPages(facts(), TEMPLATE, ALL.filter(id => id !== 'advert' && id !== 'slip'), SECTIONS))
    expect(without).not.toContain('Add a second line')
    expect(without).not.toContain('Payment slip')
  })

  it('omits a block this particular bill suppresses', () => {
    const paid = words(billPages(facts({ paid_already: true }), TEMPLATE, ALL, SECTIONS))
    /* The payment link and the slip, not the word "pay" — the remittance line
       says "Pay online, by card on file" and is a different block that should
       still be there. */
    expect(paid).not.toContain('aventa.com/pay/')
    expect(paid).not.toContain('Payment slip')
    expect(paid).toContain('How to pay')
  })

  it('omits the reward block for a customer with no programme', () => {
    expect(words(billPages(facts({ rewards: null }), TEMPLATE, ALL, SECTIONS))).not.toContain('Reward points')
  })

  /* Ticked in any order, printed in the catalogue's. A bill whose total
     precedes its charges is not a bill. */
  it('lays the sections out in document order, not the order they were ticked', () => {
    const scrambled = ['slip', 'summary', 'masthead', 'tax', 'parties', 'subs']
    const t = words(billPages(facts(), TEMPLATE, scrambled, SECTIONS))
    expect(t.indexOf('Your monthly bill')).toBeLessThan(t.indexOf('Monthly plan charge'))
    expect(t.indexOf('Monthly plan charge')).toBeLessThan(t.indexOf('Total due'))
    expect(t.indexOf('Total due')).toBeLessThan(t.indexOf('Payment slip'))
  })

  it('prints a totals line rather than items when line detail is suppressed', () => {
    const compact = words(billPages(facts(), { ...TEMPLATE, show_order_lines: false }, ALL, SECTIONS))
    expect(compact).toContain('line detail suppressed')
    expect(compact).not.toContain('Monthly plan charge')
  })

  it('says who is paid on a self-billing invoice, rather than who owes', () => {
    const seller = words(billPages(facts(), { ...TEMPLATE, audience: 'partner' }, ALL, SECTIONS))
    expect(seller).toContain('Net payable to seller')
    expect(seller).toContain('SELF-BILLED FOR')
    expect(seller).not.toContain('Amount due')
  })

  it('numbers every page, and says how many there are', () => {
    const pages = billPages(facts(), TEMPLATE, ALL, SECTIONS)
    const stamps = pages.map(p =>
      p.filter(o => o.kind === 'text').map(o => (o as { text: string }).text).find(t => t.includes('Page ')))
    expect(stamps.every(Boolean)).toBe(true)
    expect(stamps[0]).toContain(`Page 1 of ${pages.length}`)
    expect(stamps[0]).toContain('BILL-2026-07')
  })

  it('carries the footer the template sets', () => {
    expect(words(billPages(facts(), TEMPLATE, ALL, SECTIONS))).toContain('Issued by Aventa Telecom.')
  })

  it('is named after the bill', () => {
    expect(pdfNameFor(facts())).toBe('BILL-2026-07.pdf')
  })
})

describe('the file it produces', () => {
  it('is a PDF a reader would open', () => {
    const bytes = buildPdf(billPages(facts(), TEMPLATE, ALL, SECTIONS), { title: 'Bill' })
    const text = String.fromCharCode(...bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Type /Page')
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(bytes.length).toBeGreaterThan(1000)
  })

  /* A seller called "Kestrel (Devices)" would otherwise end the string early
     and turn the rest of the page into PDF operators. */
  it('survives a counterparty whose name contains brackets', () => {
    const odd = facts({ billedTo: { ...facts().billedTo, name: 'Kestrel (Devices) \\ Ltd' } })
    const text = String.fromCharCode(...buildPdf(billPages(odd, TEMPLATE, ALL, SECTIONS)))
    expect(text).toContain('Kestrel \\(Devices\\) \\\\ Ltd')
  })

  it('stays on one page for an ordinary bill', () => {
    expect(billPages(facts(), TEMPLATE, ALL, SECTIONS).length).toBe(1)
  })

  it('runs onto a second page for a long one rather than off the bottom', () => {
    const many = facts({
      usage: Array.from({ length: 60 }, (_, i) => ({
        label: `Usage line ${i + 1}`, detail: 'Billed in arrears', amount: 12.5,
      })),
    })
    expect(billPages(many, TEMPLATE, ALL, SECTIONS).length).toBeGreaterThan(1)
  })
})
