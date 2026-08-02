import { describe, it, expect } from 'vitest'
import {
  type Section, type Template, type TemplateSection, type Assignment, type BillFacts,
  sectionsOn, has, offeredTo, canRemove, canAdd, warningsFor, validateTemplate,
  nextReference, referencePattern, validateNumbering, templateFor, usedBy, canDelete,
  blocksFor, suppressed, money,
} from './billTemplate'

/* The fixtures are the seeded catalogue, not an invented one. A test that
   passes against a shape the database does not hold is a test about nothing. */

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

const sec = (id: string): Section => {
  const found = SECTIONS.find(s => s.id === id)
  if (!found) throw new Error(`no such section: ${id}`)
  return found
}

const template = (over: Partial<Template> = {}): Template => ({
  id: 'BT-CON', name: 'Consumer standard', audience: 'consumer', doc_title: 'Your monthly bill',
  accent: '#0D47A1', note: '', system: true, numbering: 'BILL-{YYYY}-{SEQ}', next_seq: 88214,
  date_format: 'DD MMM YYYY', currency: 'USD', tax_label: 'GST', rounding: 'Half up, 2 decimal places',
  language: 'English', logo: true, show_order_lines: true, remittance: '', footer: '',
  updated_by: 'Anika Sharma', updated_on: '2026-07-28', sort_order: 1, ...over,
})

const CON = template()
const ENT = template({ id: 'BT-ENT', name: 'Enterprise consolidated', audience: 'enterprise', numbering: 'INV-{YYYY}-{SEQ}', next_seq: 715 })
const PTR = template({ id: 'BT-PTR', name: 'Seller self-billing', audience: 'partner', numbering: 'SB-{YYYY}-{PARTNER}-{SEQ}', next_seq: 1042 })
const MIN = template({ id: 'BT-MIN', name: 'Compact — totals only', audience: 'any', system: false, numbering: 'INV-{YYYY}-{SEQ}', next_seq: 1, show_order_lines: false })
const REG = template({ id: 'BT-REG', name: 'Regulator format (India)', audience: 'any', system: false, numbering: 'TI-{YYYY}-{SEQ}', next_seq: 401 })

const TEMPLATES = [CON, ENT, PTR, MIN, REG]

const ASSIGNMENTS: Assignment[] = [
  { id: 'IA-CON', audience: 'consumer', party_id: null, template_id: 'BT-CON', why: '', updated_by: null, updated_on: null },
  { id: 'IA-ENT', audience: 'enterprise', party_id: null, template_id: 'BT-ENT', why: '', updated_by: null, updated_on: null },
  { id: 'IA-PTR', audience: 'partner', party_id: null, template_id: 'BT-PTR', why: '', updated_by: null, updated_on: null },
  { id: 'IA-1003', audience: 'partner', party_id: 'PTR-1003', template_id: 'BT-REG', why: '', updated_by: null, updated_on: null },
]

const CON_IDS = ['masthead', 'parties', 'hero', 'subs', 'usage', 'credits', 'rewards', 'tax',
  'summary', 'payments', 'howtopay', 'paylink', 'support', 'advert', 'terms', 'slip']
const PTR_IDS = ['masthead', 'parties', 'hero', 'usage', 'credits', 'tax', 'summary', 'support', 'terms']

describe('what is on a template', () => {
  const chosen: TemplateSection[] = [
    { template_id: 'BT-MIN', section_id: 'summary', sort_order: 9 },
    { template_id: 'BT-MIN', section_id: 'masthead', sort_order: 1 },
    { template_id: 'BT-MIN', section_id: 'tax', sort_order: 8 },
    { template_id: 'BT-CON', section_id: 'advert', sort_order: 14 },
  ]

  it('returns only this template’s sections, in document order', () => {
    expect(sectionsOn(MIN, SECTIONS, chosen).map(s => s.id)).toEqual(['masthead', 'tax', 'summary'])
  })

  it('does not leak another template’s choices', () => {
    expect(sectionsOn(MIN, SECTIONS, chosen).map(s => s.id)).not.toContain('advert')
  })

  it('has() is a plain membership test', () => {
    expect(has(CON_IDS, 'advert')).toBe(true)
    expect(has(PTR_IDS, 'advert')).toBe(false)
  })
})

describe('which sections an audience may be offered', () => {
  it('offers an advert to a consumer and to nobody else', () => {
    expect(offeredTo(sec('advert'), 'consumer')).toBe(true)
    expect(offeredTo(sec('advert'), 'enterprise')).toBe(false)
    expect(offeredTo(sec('advert'), 'partner')).toBe(false)
  })

  it('does not offer a payment slip or a payment link to a seller', () => {
    for (const id of ['slip', 'paylink']) {
      expect(offeredTo(sec(id), 'consumer')).toBe(true)
      expect(offeredTo(sec(id), 'enterprise')).toBe(true)
      expect(offeredTo(sec(id), 'partner')).toBe(false)
    }
  })

  it('does not offer reward points to a seller, who funds them rather than earns them', () => {
    expect(offeredTo(sec('rewards'), 'partner')).toBe(false)
    expect(offeredTo(sec('rewards'), 'enterprise')).toBe(true)
  })

  /* A template written for "any" is picked up by an override for a single
     counterparty, so it cannot be narrowed to one audience's catalogue. */
  it('offers everything to a template written for any audience', () => {
    for (const s of SECTIONS) expect(offeredTo(s, 'any')).toBe(true)
  })
})

describe('the four that cannot come off', () => {
  it.each(['masthead', 'parties', 'tax', 'summary'])('refuses to remove %s', id => {
    const check = canRemove(sec(id))
    expect(check.ok).toBe(false)
    if (!check.ok) {
      expect(check.reason).toContain(sec(id).label)
      expect(check.reason).toMatch(/is not a bill/)
    }
  })

  it.each(['hero', 'subs', 'usage', 'credits', 'rewards', 'payments', 'howtopay',
    'paylink', 'support', 'advert', 'terms', 'slip'])('allows %s to be switched off', id => {
    expect(canRemove(sec(id)).ok).toBe(true)
  })
})

describe('the sections an audience cannot be given', () => {
  it('refuses a payment slip on a self-billing invoice, and says which way the money goes', () => {
    const check = canAdd(sec('slip'), 'partner')
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/we pay them/)
  })

  it('refuses a payment link to a seller the marketplace settles', () => {
    const check = canAdd(sec('paylink'), 'partner')
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/nothing for them to pay/)
  })

  it('refuses an advert on a business document', () => {
    for (const audience of ['enterprise', 'partner'] as const) {
      const check = canAdd(sec('advert'), audience)
      expect(check.ok).toBe(false)
      if (!check.ok) expect(check.reason).toMatch(/did not ask to be sold to/)
    }
  })

  it('refuses reward points on a seller document', () => {
    const check = canAdd(sec('rewards'), 'partner')
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/earned by buyers/)
  })

  it('allows every section the seeded consumer template carries', () => {
    for (const id of CON_IDS) expect(canAdd(sec(id), 'consumer').ok).toBe(true)
  })

  it('allows every section the seeded seller template carries', () => {
    for (const id of PTR_IDS) expect(canAdd(sec(id), 'partner').ok).toBe(true)
  })
})

describe('what is odd but allowed', () => {
  const warn = (ids: string[], audience: Template['audience'] = 'consumer', showOrderLines = true) =>
    warningsFor({ ids, audience, showOrderLines }).map(w => w.text).join(' | ')

  it('says nothing about the seeded consumer template', () => {
    expect(warningsFor({ ids: CON_IDS, audience: 'consumer', showOrderLines: true })).toEqual([])
  })

  it('says nothing about the seeded seller template', () => {
    expect(warningsFor({ ids: PTR_IDS, audience: 'partner', showOrderLines: true })).toEqual([])
  })

  it('flags an advert on a business document without refusing an "any" template', () => {
    expect(warn([...PTR_IDS, 'advert', 'howtopay'], 'any')).toMatch(/some contracts forbid it/)
    expect(warn(CON_IDS, 'consumer')).not.toMatch(/forbid it/)
  })

  it('flags a payment slip on a self-billing document', () => {
    expect(warn([...PTR_IDS, 'slip', 'howtopay'], 'partner')).toMatch(/backwards/)
  })

  it('flags a slip with nowhere to send it', () => {
    expect(warn(['masthead', 'parties', 'tax', 'summary', 'support', 'slip', 'paylink']))
      .toMatch(/nowhere to send it/)
  })

  it('does not flag a slip that comes with payment instructions', () => {
    expect(warn(['masthead', 'parties', 'tax', 'summary', 'support', 'slip', 'howtopay']))
      .not.toMatch(/nowhere to send it/)
  })

  it('flags a payment link with no figure beside it', () => {
    expect(warn(['masthead', 'parties', 'tax', 'summary', 'support', 'paylink']))
      .toMatch(/add up themselves/)
  })

  it('flags a bill with no support block', () => {
    expect(warn(['masthead', 'parties', 'tax', 'summary', 'howtopay'])).toMatch(/search engine/)
  })

  it('flags a bill that says what is owed and not how to settle it', () => {
    expect(warn(['masthead', 'parties', 'tax', 'summary', 'support'])).toMatch(/how to settle it/)
  })

  /* A seller is paid by the marketplace, so no payment route on their document
     is correct rather than an omission. */
  it('does not ask a self-billing invoice for a payment route', () => {
    expect(warn(PTR_IDS, 'partner')).not.toMatch(/how to settle it/)
  })

  it('flags charge sections printed as totals when line detail is suppressed', () => {
    expect(warn(CON_IDS, 'consumer', false)).toMatch(/prints? a totals line|totals line/)
    expect(warn(['masthead', 'parties', 'tax', 'summary', 'support', 'howtopay'], 'consumer', false))
      .not.toMatch(/totals line/)
  })

  it('notes what reward points mean on a seller document', () => {
    expect(warn([...PTR_IDS, 'rewards'], 'partner')).toMatch(/what the seller funded/)
  })

  it('grades the backwards slip as a warning and the missing figure as information', () => {
    const w = warningsFor({ ids: [...PTR_IDS, 'slip'], audience: 'partner', showOrderLines: true })
    expect(w.find(x => /backwards/.test(x.text))?.level).toBe('warn')
    const info = warningsFor({
      ids: ['masthead', 'parties', 'tax', 'summary', 'support', 'paylink'],
      audience: 'consumer', showOrderLines: true,
    })
    expect(info.find(x => /add up themselves/.test(x.text))?.level).toBe('info')
  })
})

describe('whether a template is a document somebody could be sent', () => {
  const draft = (over: Partial<Parameters<typeof validateTemplate>[0]> = {}) => ({
    name: 'Consumer standard', doc_title: 'Your monthly bill',
    numbering: 'BILL-{YYYY}-{SEQ}', audience: 'consumer' as Template['audience'], ...over,
  })

  it('accepts the seeded consumer template and counts its sections', () => {
    const check = validateTemplate(draft(), CON_IDS, SECTIONS)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.note).toContain('16 sections')
  })

  it('refuses a template with no name', () => {
    const check = validateTemplate(draft({ name: '   ' }), CON_IDS, SECTIONS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/needs a name/)
  })

  it('refuses a document with no title', () => {
    const check = validateTemplate(draft({ doc_title: '' }), CON_IDS, SECTIONS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/needs a title/)
  })

  it('refuses a numbering pattern that would repeat itself', () => {
    const check = validateTemplate(draft({ numbering: 'BILL-{YYYY}' }), CON_IDS, SECTIONS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/\{SEQ\}/)
  })

  it('names every locked section that has gone missing', () => {
    const check = validateTemplate(draft(), ['masthead', 'parties', 'hero'], SECTIONS)
    expect(check.ok).toBe(false)
    if (!check.ok) {
      expect(check.reason).toContain('Taxation breakdown')
      expect(check.reason).toContain('Summary and total')
    }
  })

  it('refuses a section written for another audience, with the reason canAdd gives', () => {
    const check = validateTemplate(draft({ audience: 'partner' }), [...PTR_IDS, 'slip'], SECTIONS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/we pay them/)
  })

  it('accepts a document that is merely odd, and says how odd', () => {
    const check = validateTemplate(
      draft({ audience: 'enterprise', name: 'Enterprise plus offer' }),
      ['masthead', 'parties', 'tax', 'summary', 'support'], SECTIONS)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.note).toMatch(/1 thing worth a second look/)
  })

  it('pluralises the second look', () => {
    const check = validateTemplate(draft(), ['masthead', 'parties', 'tax', 'summary', 'slip'], SECTIONS)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.note).toMatch(/3 things worth a second look/)
  })
})

describe('the reference the next document carries', () => {
  it('fills the year and the sequence', () => {
    expect(nextReference(CON, { year: 2026 })).toBe('BILL-2026-88214')
  })

  it('fills the counterparty on a seller pattern, digits only', () => {
    expect(nextReference(PTR, { year: 2026, party: 'PTR-1003' })).toBe('SB-2026-1003-1042')
  })

  it('falls back rather than printing an empty segment when no party is given', () => {
    expect(nextReference(PTR, { year: 2026 })).toBe('SB-2026-0000-1042')
  })

  it('understands a two-digit year', () => {
    expect(nextReference({ numbering: 'INV-{YY}-{SEQ}', next_seq: 7 }, { year: 2026 })).toBe('INV-26-7')
  })

  it('uses this year when none is given', () => {
    expect(nextReference(ENT)).toBe(`INV-${new Date().getFullYear()}-715`)
  })

  /* An audience default serves every seller, so there is no counterparty to
     substitute and pretending otherwise prints a reference nobody will ever
     be sent. */
  it('leaves the counterparty token standing when there is no counterparty', () => {
    expect(referencePattern(PTR, 2026)).toBe('SB-2026-{PARTNER}-1042')
    expect(referencePattern(CON, 2026)).toBe('BILL-2026-88214')
  })
})

describe('whether a numbering pattern will do', () => {
  it('accepts every seeded pattern', () => {
    for (const t of TEMPLATES) expect(validateNumbering(t.numbering).ok).toBe(true)
  })

  it('refuses an empty pattern', () => {
    expect(validateNumbering('  ').ok).toBe(false)
  })

  it('refuses a pattern with no sequence', () => {
    const check = validateNumbering('INV-{YYYY}')
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/every document carries the same reference/)
  })

  it('refuses a token it would print literally', () => {
    const check = validateNumbering('INV-{MONTH}-{SEQ}')
    expect(check.ok).toBe(false)
    if (!check.ok) {
      expect(check.reason).toContain('{MONTH}')
      expect(check.reason).toMatch(/\{SEQ\}, \{YYYY\}, \{YY\} or \{PARTNER\}/)
    }
  })

  it('accepts a pattern that is nothing but a sequence', () => {
    expect(validateNumbering('{SEQ}').ok).toBe(true)
  })
})

describe('which template a counterparty’s bill comes out on', () => {
  it('gives each audience its default', () => {
    expect(templateFor({ audience: 'consumer' }, ASSIGNMENTS, TEMPLATES)?.id).toBe('BT-CON')
    expect(templateFor({ audience: 'enterprise' }, ASSIGNMENTS, TEMPLATES)?.id).toBe('BT-ENT')
    expect(templateFor({ audience: 'partner' }, ASSIGNMENTS, TEMPLATES)?.id).toBe('BT-PTR')
  })

  /* The whole point of having both: one seller in a prescribed jurisdiction
     must not change the document every other seller gets. */
  it('lets an override beat the default for the one counterparty it names', () => {
    expect(templateFor({ audience: 'partner', partyId: 'PTR-1003' }, ASSIGNMENTS, TEMPLATES)?.id).toBe('BT-REG')
    expect(templateFor({ audience: 'partner', partyId: 'PTR-1001' }, ASSIGNMENTS, TEMPLATES)?.id).toBe('BT-PTR')
  })

  it('does not apply one audience’s override to another', () => {
    expect(templateFor({ audience: 'consumer', partyId: 'PTR-1003' }, ASSIGNMENTS, TEMPLATES)?.id).toBe('BT-CON')
  })

  it('returns null rather than guessing when an audience has no assignment', () => {
    expect(templateFor({ audience: 'partner' }, ASSIGNMENTS.slice(0, 2), TEMPLATES)).toBeNull()
  })

  it('returns null when the assignment names a template that has gone', () => {
    expect(templateFor({ audience: 'partner', partyId: 'PTR-1003' }, ASSIGNMENTS,
      TEMPLATES.filter(t => t.id !== 'BT-REG'))).toBeNull()
  })
})

describe('who is on a template, and whether it can go', () => {
  it('names the audience for a default and the counterparty for an override', () => {
    expect(usedBy('BT-CON', ASSIGNMENTS)).toEqual(['every consumer'])
    expect(usedBy('BT-REG', ASSIGNMENTS)).toEqual(['PTR-1003'])
    expect(usedBy('BT-MIN', ASSIGNMENTS)).toEqual([])
  })

  it('refuses to delete a template that ships with the marketplace', () => {
    const check = canDelete(CON, ASSIGNMENTS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/edited but not deleted/)
  })

  it('refuses to delete a template somebody is still billed on', () => {
    const check = canDelete(REG, ASSIGNMENTS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/still assigned to PTR-1003/)
  })

  it('allows an unassigned template to go, and says what that does not change', () => {
    const check = canDelete(MIN, ASSIGNMENTS)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.note).toMatch(/Documents already issued on it are unaffected/)
  })

  it('checks the system flag before the assignments, so the truer refusal wins', () => {
    const check = canDelete(CON, ASSIGNMENTS)
    if (!check.ok) expect(check.reason).not.toMatch(/still assigned/)
  })
})

describe('what a particular bill actually renders', () => {
  const facts = (over: Partial<BillFacts> = {}): BillFacts => ({
    reference: 'BILL-2026-88214', issued: '01 Jul 2026', due: '15 Jul 2026',
    billedTo: { name: 'Priya Raman', ref: 'CUS-449021', lines: ['12 Nandi Road', 'Bengaluru 560001'], contact: 'priya.raman@example.com', tax: null },
    billedFrom: { name: 'Aventa Communications Private Limited', mark: 'Aventa Telecom', lines: ['1 Marathahalli', 'Bengaluru 560037'], tax: '29AAACA1234F1Z5' },
    lines: [{ label: 'Aventa Fibre 500', detail: '1 × $59.00', amount: 59 }],
    usage: [], credits: 0, paid: 0, taxRate: 18, tax: 10.62, total: 69.62,
    rewards: { earned: 120, balance: 2500, redeemed: 0 },
    advert: { title: 'Add a second line', subtitle: null, cta: 'See offers', accent: '#0f6ab4' },
    paid_already: false,
    support: {
      phone: '+91 80 4000 6000', hours: 'Mon to Sat, 09:00–20:00 IST',
      email: 'billing@aventa.com', portal: 'aventa.com/help',
      window: '30 days from the issue date',
    },
    howToPay: 'Bank transfer quoting the bill number.',
    terms: ['Payment is due by the date shown.'],
    payRef: 'CUS-449021',
    ...over,
  })

  it('renders every ticked section when the bill supports all of them', () => {
    expect(blocksFor(CON_IDS, facts({ paid: 20 }))).toEqual(CON_IDS)
  })

  it('drops the payment link and the slip once the bill is settled', () => {
    const shown = blocksFor(CON_IDS, facts({ paid_already: true }))
    expect(shown).not.toContain('paylink')
    expect(shown).not.toContain('slip')
    expect(shown).toContain('howtopay')
  })

  it('drops the reward block for a customer with no programme', () => {
    expect(blocksFor(CON_IDS, facts({ rewards: null }))).not.toContain('rewards')
  })

  it('drops the advert when no banner is live', () => {
    expect(blocksFor(CON_IDS, facts({ advert: null }))).not.toContain('advert')
  })

  it('drops the payments block when nothing was paid this period', () => {
    expect(blocksFor(CON_IDS, facts({ paid: 0 }))).not.toContain('payments')
    expect(blocksFor(CON_IDS, facts({ paid: 12.5 }))).toContain('payments')
  })

  /* Nil on purpose: an empty adjustments block is how somebody learns nothing
     was adjusted, rather than wondering whether it was forgotten. */
  it('keeps the credits block at nil', () => {
    expect(blocksFor(CON_IDS, facts({ credits: 0, paid: 0 }))).toContain('credits')
  })

  it('never renders a block the template did not tick', () => {
    expect(blocksFor(PTR_IDS, facts())).not.toContain('advert')
  })

  /* Ticked and empty is worse than absent: a heading with nothing under it
     reads as a document that lost something in production. */
  it('drops the support block when the issuing entity has published no contact', () => {
    expect(blocksFor(CON_IDS, facts({ support: null }))).not.toContain('support')
  })

  it('drops the terms and the payment instructions when there is nothing to print', () => {
    const shown = blocksFor(CON_IDS, facts({ terms: [], howToPay: '   ' }))
    expect(shown).not.toContain('terms')
    expect(shown).not.toContain('howtopay')
  })

  it('explains each section it held back', () => {
    const why = Object.fromEntries(
      suppressed(CON_IDS, facts({ paid_already: true, rewards: null, advert: null }))
        .map(s => [s.id, s.why]))
    expect(why.paylink).toMatch(/invites paying twice/)
    expect(why.slip).toMatch(/already paid/)
    expect(why.rewards).toMatch(/not on a rewards programme/)
    expect(why.advert).toMatch(/no banner is live/)
    expect(why.payments).toMatch(/nothing was paid/)
  })

  it('points at the screen that fixes an empty support block', () => {
    const [only] = suppressed(['support'], facts({ support: null }))
    expect(only.why).toMatch(/Billing identity/)
  })

  it('explains nothing when nothing was held back', () => {
    expect(suppressed(CON_IDS, facts({ paid: 20 }))).toEqual([])
  })
})

describe('money', () => {
  it('always carries two decimals and a thousands separator', () => {
    expect(money(69.6)).toBe('$69.60')
    expect(money(11840)).toBe('$11,840.00')
    expect(money(0)).toBe('$0.00')
  })

  /* A deduction on a self-billing invoice is a negative amount, and it is
     printed the way people write money rather than the way JavaScript
     concatenates it. */
  it('puts the sign outside the currency symbol', () => {
    expect(money(-1893.44)).toBe('-$1,893.44')
    expect(money(-0.5)).toBe('-$0.50')
  })

  it('does not print minus zero', () => {
    expect(money(-0)).toBe('$0.00')
    expect(money(-0.001)).toBe('$0.00')
  })
})
