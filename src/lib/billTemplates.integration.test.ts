/* Touches the live Supabase project.
 *
 * Three claims worth checking against a real database rather than a fixture.
 *
 * The first is that the four locked sections are locked by the database and not
 * only by the screen — a form is a suggestion, and RLS cannot express "compare
 * the row being deleted against a property of the section it names".
 *
 * The second is that the refusals the module gives and the refusals the guard
 * gives are the same refusals. Two statements of one rule that have drifted
 * apart is how a screen ends up explaining something that did not happen.
 *
 * The third is that a counterparty can read the shape of the document they are
 * sent, and cannot edit it. Both halves matter: a seller console shows the
 * template, and a seller must not be able to take the tax block off it.
 *
 * Everything written here is undone in the same file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import {
  loadBillTemplates, saveTemplate, duplicateTemplate, deleteTemplate,
  assignTemplate, removeOverride, saveIssuer,
} from './billTemplateRepo'
import type { BillTemplateBook, Draft } from './billTemplateRepo'
import {
  sectionsOn, canRemove, canAdd, canDelete, templateFor, nextReference,
  validateTemplate, warningsFor, blocksFor,
} from './billTemplate'
import type { Template, Issuer } from './billTemplate'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }

const draftOf = (over: Partial<Draft> = {}): Draft => ({
  name: 'Integration test template', audience: 'consumer', doc_title: 'Your monthly bill',
  accent: '#0D47A1', note: 'Written by the integration suite.',
  numbering: 'IT-{YYYY}-{SEQ}', next_seq: 1, date_format: 'DD MMM YYYY',
  tax_label: 'GST', rounding: 'Half up, 2 decimal places', language: 'English',
  logo: true, show_order_lines: true,
  remittance: 'Bank transfer quoting the reference.', footer: 'Issued by Aventa Telecom.',
  ...over,
})

const CORE = ['masthead', 'parties', 'hero', 'tax', 'summary', 'howtopay', 'support']

let book: BillTemplateBook
const made: string[] = []

describe('the seeded catalogue', () => {
  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadBillTemplates()
    expect(book.loadError, book.loadError).toBeUndefined()
  })

  it('has the sixteen sections the builder offers', () => {
    expect(book.sections.length).toBe(16)
    expect(book.sections.map(s => s.id)).toEqual([...book.sections].sort((a, b) => a.sort_order - b.sort_order).map(s => s.id))
  })

  it('locks exactly the four that make a document a bill', () => {
    expect(book.sections.filter(s => s.locked).map(s => s.id).sort())
      .toEqual(['masthead', 'parties', 'summary', 'tax'])
  })

  it('carries all four on every template', () => {
    for (const t of book.templates) {
      const ids = sectionsOn(t, book.sections, book.chosen).map(s => s.id)
      for (const need of ['masthead', 'parties', 'tax', 'summary']) {
        expect(ids, `${t.name} is missing ${need}`).toContain(need)
      }
    }
  })

  it('never puts a section on a template whose audience cannot use it', () => {
    for (const t of book.templates.filter(x => x.audience !== 'any')) {
      for (const s of sectionsOn(t, book.sections, book.chosen)) {
        expect(canAdd(s, t.audience).ok, `${t.name} carries ${s.id}`).toBe(true)
      }
    }
  })

  it('gives every audience a default, so nobody is billed on nothing', () => {
    for (const aud of ['consumer', 'enterprise', 'partner'] as const) {
      expect(templateFor({ audience: aud }, book.assignments, book.templates), aud).not.toBeNull()
    }
  })

  it('lets one seller be an exception without moving the rest', () => {
    expect(templateFor({ audience: 'partner', partyId: 'PTR-1003' }, book.assignments, book.templates)?.id)
      .toBe('BT-REG')
    expect(templateFor({ audience: 'partner', partyId: 'PTR-1004' }, book.assignments, book.templates)?.id)
      .toBe('BT-PTR')
  })

  it('produces a distinguishable reference from every seeded pattern', () => {
    const refs = book.templates.map(t => nextReference(t, { year: 2026, party: 'PTR-1003' }))
    expect(new Set(refs).size).toBe(refs.length)
    for (const r of refs) expect(r).not.toMatch(/\{[A-Z]+\}/)
  })

  it('has an issuing entity with a printable address and a tax registration', () => {
    expect(book.issuer).not.toBeNull()
    expect(book.issuer!.lines.length).toBeGreaterThan(1)
    expect(book.issuer!.tax_id).toBeTruthy()
  })

  /* The three seeded templates are the reason this is configuration rather
     than a constant, so they are asserted rather than assumed. */
  it('keeps the payment slip and the reward block off the self-billing invoice', () => {
    const ptr = book.templates.find(t => t.id === 'BT-PTR')!
    const ids = sectionsOn(ptr, book.sections, book.chosen).map(s => s.id)
    expect(ids).not.toContain('slip')
    expect(ids).not.toContain('paylink')
    expect(ids).not.toContain('rewards')
  })

  it('keeps the advert off the enterprise document', () => {
    const ent = book.templates.find(t => t.id === 'BT-ENT')!
    expect(sectionsOn(ent, book.sections, book.chosen).map(s => s.id)).not.toContain('advert')
  })

  it('says nothing is odd about any seeded template', () => {
    for (const t of book.templates) {
      const ids = sectionsOn(t, book.sections, book.chosen).map(s => s.id)
      const serious = warningsFor({ ids, audience: t.audience, showOrderLines: t.show_order_lines })
        .filter(w => w.level === 'warn')
      expect(serious.map(w => w.text), `${t.name}: ${serious.map(w => w.text).join(' | ')}`).toEqual([])
    }
  })
})

describe('the document the preview draws', () => {
  it('has a real bill for every audience, with figures that reconcile', () => {
    for (const aud of ['consumer', 'enterprise', 'partner'] as const) {
      const f = book.samples[aud]
      expect(f, `no sample for ${aud}`).not.toBeNull()
      expect(f!.reference).toBeTruthy()
      expect(f!.billedTo.name).toBeTruthy()
      expect(f!.billedFrom.lines.length).toBeGreaterThan(0)
    }
  })

  /* If the summary does not add up the document is wrong, and a preview that
     hides that is worse than no preview. This is the assertion that caught the
     seller statement printing its deductions without its gross. */
  it('reconciles every line, credit and tax figure to the total, on all three', () => {
    for (const aud of ['consumer', 'enterprise', 'partner'] as const) {
      const f = book.samples[aud]!
      const lines = [...f.lines, ...f.usage].reduce((n, l) => n + l.amount, 0)
      expect(Math.abs(lines + f.credits + f.tax - f.total), `${aud} does not reconcile`).toBeLessThan(0.02)
    }
  })

  /* Every charge the document shows has to be on a section the template
     actually carries, or the figure exists in the data and never reaches the
     page — which is exactly how the total stopped adding up. */
  it('puts every charge on a section the assigned template carries', () => {
    for (const aud of ['consumer', 'enterprise', 'partner'] as const) {
      const t = templateFor({ audience: aud }, book.assignments, book.templates)!
      const ids = sectionsOn(t, book.sections, book.chosen).map(s => s.id)
      const f = book.samples[aud]!
      if (f.lines.length) expect(ids, `${aud}: charges in subs, template has none`).toContain('subs')
      if (f.usage.length) expect(ids, `${aud}: charges in usage, template has none`).toContain('usage')
    }
  })

  it('never offers an advertisement on an enterprise or seller document', () => {
    expect(book.samples.enterprise!.advert).toBeNull()
    expect(book.samples.partner!.advert).toBeNull()
  })

  it('suppresses the payment link on a bill that is already settled', () => {
    const paid = { ...book.samples.consumer!, paid_already: true }
    expect(blocksFor(['paylink', 'slip', 'summary'], paid)).toEqual(['summary'])
  })

  it('draws the reward figure from the ledger-backed member record', () => {
    const r = book.samples.consumer!.rewards
    expect(r).not.toBeNull()
    expect(r!.balance).toBeGreaterThan(0)
  })
})

describe('what the database refuses', () => {
  let mine: Template | null = null

  it('creates a template through the repo', async () => {
    const res = await saveTemplate({
      id: null, draft: draftOf(), ids: CORE, actor: 'Integration suite', all: book.sections,
    })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)
    expect(res.id).toBeTruthy()
    made.push(res.id!)

    book = await loadBillTemplates()
    mine = book.templates.find(t => t.id === res.id) ?? null
    expect(mine).not.toBeNull()
    expect(sectionsOn(mine!, book.sections, book.chosen).map(s => s.id).sort()).toEqual([...CORE].sort())
  })

  /* The module refuses this before it reaches the wire. The next test proves
     the database refuses it too, in case somebody reaches it another way. */
  it('will not let the module save a template missing a locked section', () => {
    const check = validateTemplate(draftOf(), ['masthead', 'parties', 'hero'], book.sections)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/Taxation breakdown|Summary/)
  })

  it('refuses a direct delete of a locked section, in the database', async () => {
    const { error } = await supabase.from('invoice_template_sections')
      .delete().eq('template_id', mine!.id).eq('section_id', 'tax')
    expect(error, 'the tax block came off').not.toBeNull()
    expect(error!.message).toMatch(/cannot be switched off/)

    /* And it is still there, rather than gone with a warning. */
    const { data } = await supabase.from('invoice_template_sections')
      .select('section_id').eq('template_id', mine!.id).eq('section_id', 'tax')
    expect(data?.length).toBe(1)
  })

  it('says the same thing the module says', () => {
    const tax = book.sections.find(s => s.id === 'tax')!
    const check = canRemove(tax)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/cannot be switched off/)
  })

  it('refuses an assignment naming a template written for somebody else', async () => {
    const res = await assignTemplate({
      audience: 'partner', partyId: 'PTR-TEST-9999', templateId: mine!.id,
      why: 'Integration suite — should not land.', actor: 'Integration suite',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/not written for a partner/)
  })

  it('refuses to delete a template somebody is still billed on', async () => {
    const con = book.templates.find(t => t.id === 'BT-CON')!
    const check = canDelete(con, book.assignments)
    expect(check.ok).toBe(false)

    const res = await deleteTemplate({ template: con, assignments: book.assignments, actor: 'Integration suite' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/edited but not deleted/)

    /* And it survived — a refusal that deletes the row anyway is not a refusal. */
    const { data } = await supabase.from('invoice_templates').select('id').eq('id', 'BT-CON')
    expect(data?.length).toBe(1)
  })

  it('refuses a numbering pattern with no sequence, at the constraint', async () => {
    const { error } = await supabase.from('invoice_templates')
      .update({ numbering: 'IT-{YYYY}' }).eq('id', mine!.id)
    expect(error, 'a pattern with no sequence was accepted').not.toBeNull()
  })
})

describe('editing a template', () => {
  let mine: Template

  beforeAll(async () => {
    book = await loadBillTemplates()
    mine = book.templates.find(t => t.id === made[0])!
  })

  it('reconciles the section list rather than replacing it', async () => {
    const next = [...CORE, 'terms', 'payments']
    const res = await saveTemplate({
      id: mine.id, draft: draftOf({ name: 'Integration test template (edited)' }),
      ids: next, actor: 'Integration suite', all: book.sections,
    })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)

    book = await loadBillTemplates()
    const after = book.templates.find(t => t.id === mine.id)!
    expect(sectionsOn(after, book.sections, book.chosen).map(s => s.id).sort()).toEqual([...next].sort())
    expect(after.name).toBe('Integration test template (edited)')
  })

  it('takes an unlocked section back off', async () => {
    const res = await saveTemplate({
      id: mine.id, draft: draftOf({ name: 'Integration test template (edited)' }),
      ids: CORE, actor: 'Integration suite', all: book.sections,
    })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)

    book = await loadBillTemplates()
    const after = book.templates.find(t => t.id === mine.id)!
    expect(sectionsOn(after, book.sections, book.chosen).map(s => s.id)).not.toContain('terms')
  })

  it('duplicates as a draft rather than as another built-in', async () => {
    const res = await duplicateTemplate({
      source: mine, ids: CORE, actor: 'Integration suite',
    })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)
    made.push(res.id!)

    book = await loadBillTemplates()
    const copy = book.templates.find(t => t.id === res.id)!
    expect(copy.system).toBe(false)
    expect(copy.name).toMatch(/\(copy\)$/)
    expect(sectionsOn(copy, book.sections, book.chosen).length).toBe(CORE.length)
  })
})

describe('an exception for one counterparty', () => {
  const PARTY = 'ENT-TEST-9001'

  it('is added, wins over the default, and moves nobody else', async () => {
    const compact = book.templates.find(t => t.id === 'BT-MIN')!
    const res = await assignTemplate({
      audience: 'enterprise', partyId: PARTY, templateId: compact.id,
      why: 'Integration suite.', actor: 'Integration suite',
    })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)

    book = await loadBillTemplates()
    expect(templateFor({ audience: 'enterprise', partyId: PARTY }, book.assignments, book.templates)?.id)
      .toBe('BT-MIN')
    expect(templateFor({ audience: 'enterprise', partyId: 'ENT-2007' }, book.assignments, book.templates)?.id)
      .toBe('BT-ENT')
  })

  it('is taken away again, and the counterparty falls back to the default', async () => {
    const a = book.assignments.find(x => x.party_id === PARTY)!
    const res = await removeOverride({ assignment: a, actor: 'Integration suite' })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)

    book = await loadBillTemplates()
    expect(book.assignments.find(x => x.party_id === PARTY)).toBeUndefined()
    expect(templateFor({ audience: 'enterprise', partyId: PARTY }, book.assignments, book.templates)?.id)
      .toBe('BT-ENT')
  })

  it('will not let an audience default be removed as though it were an exception', async () => {
    const def = book.assignments.find(x => x.audience === 'consumer' && x.party_id === null)!
    const res = await removeOverride({ assignment: def, actor: 'Integration suite' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/no template has no bill/)
  })
})

describe('the billing identity', () => {
  let before: Issuer

  beforeAll(() => { before = book.issuer! })

  it('refuses an entity with no registered address', async () => {
    const res = await saveIssuer({ issuer: { ...before, lines: ['  '] }, actor: 'Integration suite' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/registered address is required/)
  })

  it('saves a change and puts it on the next preview', async () => {
    const res = await saveIssuer({
      issuer: { ...before, support_phone: '+91 80 4000 6001' }, actor: 'Integration suite',
    })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)

    const after = await loadBillTemplates()
    expect(after.issuer!.support_phone).toBe('+91 80 4000 6001')
    expect(after.samples.consumer!.support!.phone).toBe('+91 80 4000 6001')
  })

  it('is put back', async () => {
    const res = await saveIssuer({ issuer: before, actor: 'Integration suite' })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)
    const after = await loadBillTemplates()
    expect(after.issuer!.support_phone).toBe(before.support_phone)
  })
})

describe('a counterparty looking at their own document shape', () => {
  afterAll(async () => { await signOut() })

  it('lets a seller read the templates and the issuing entity', async () => {
    await signOut()
    await signIn(PARTNER.email, PARTNER.password)

    const { data: templates, error } = await supabase.from('invoice_templates').select('id')
    expect(error, error?.message).toBeNull()
    expect((templates ?? []).length).toBeGreaterThan(0)

    const { data: issuer } = await supabase.from('invoice_issuer').select('legal_name').eq('id', 'default')
    expect(issuer?.length).toBe(1)
  })

  /* RLS narrows the rows a statement can see rather than raising on it, so a
     forbidden update succeeds and changes nothing. That is why every write in
     the repo asks for the row back. */
  it('does not let a seller take the tax block off their own invoice', async () => {
    const { data } = await supabase.from('invoice_template_sections')
      .delete().eq('template_id', 'BT-PTR').eq('section_id', 'tax').select('section_id')
    expect(data ?? []).toEqual([])

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data: still } = await supabase.from('invoice_template_sections')
      .select('section_id').eq('template_id', 'BT-PTR').eq('section_id', 'tax')
    expect(still?.length).toBe(1)
  })

  it('does not let a customer rename the document they are sent', async () => {
    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)

    const { data } = await supabase.from('invoice_templates')
      .update({ doc_title: 'Free stuff' }).eq('id', 'BT-CON').select('id')
    expect(data ?? []).toEqual([])

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data: still } = await supabase.from('invoice_templates').select('doc_title').eq('id', 'BT-CON')
    expect(still?.[0]?.doc_title).toBe('Your monthly bill')
  })
})

describe('tidying up', () => {
  afterAll(async () => { await signOut() })

  /* This is also the assertion that deleting a template is not the same act as
     switching a section off. Both templates here carry all four locked
     sections; the cascade hits the section guard on every one of them, and it
     has to let them through because the document is ceasing to exist rather
     than losing its tax block. It did not, once. */
  it('removes everything this file created, locked sections and all', async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)

    for (const id of made) {
      const { error } = await supabase.from('invoice_templates').delete().eq('id', id)
      expect(error, `${id}: ${error?.message}`).toBeNull()
    }
    const { data } = await supabase.from('invoice_templates').select('id').in('id', made)
    expect(data ?? []).toEqual([])

    /* The sections went with them rather than being left pointing at nothing. */
    const { data: orphans } = await supabase.from('invoice_template_sections')
      .select('template_id').in('template_id', made)
    expect(orphans ?? []).toEqual([])

    /* And the catalogue is back to the five it started with. */
    const after = await loadBillTemplates()
    expect(after.templates.map(t => t.id).sort()).toEqual(['BT-CON', 'BT-ENT', 'BT-MIN', 'BT-PTR', 'BT-REG'])
    expect(after.assignments.length).toBe(4)
  })
})

/* One jurisdiction, one rate.
 *
 * Retail bills charged about nine percent and business invoices charged
 * eighteen, under one registration in one country. The drift was possible
 * because only one of the two tables recorded the rate it used — a figure with
 * no stated basis cannot be checked, so it never was.
 *
 * Both record it now, and this is the check that keeps them together.
 */
describe('the tax on a document', () => {
  /* This block runs after the tidy-up signed out. Without its own session the
     reads return nothing and every loop below passes over an empty list —
     which is the quietest way for a test to stop testing anything. */
  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })
  afterAll(async () => { await signOut() })

  it('is the rate the document itself states, on both sides', async () => {
    const { data: bills } = await supabase.from('consumer_bills').select('*')
    expect((bills ?? []).length, 'no retail bills to check').toBeGreaterThan(0)
    for (const b of bills ?? []) {
      const net = Number(b.plan_charge) + Number(b.subscriptions) + Number(b.oneoff)
      const expected = Math.round(net * Number(b.tax_rate)) / 100
      expect(Number(b.tax), `${b.id} charges a tax its own rate does not produce`)
        .toBeCloseTo(expected, 2)
      expect(Number(b.total), `${b.id} does not add up`).toBeCloseTo(net + Number(b.tax), 2)
    }

    const { data: invoices } = await supabase.from('enterprise_invoices').select('*')
    expect((invoices ?? []).length, 'no business invoices to check').toBeGreaterThan(0)
    for (const i of invoices ?? []) {
      const net = Number(i.recurring) + Number(i.oneoff)
      const expected = Math.round(net * Number(i.tax_rate)) / 100
      expect(Number(i.tax), `${i.id} charges a tax its own rate does not produce`)
        .toBeCloseTo(expected, 2)
      expect(Number(i.total), `${i.id} does not add up`).toBeCloseTo(net + Number(i.tax), 2)
    }
  })

  /* This used to assert one rate across the whole marketplace, which was right
     while there was one jurisdiction and became wrong when there were three:
     India charges GST at 18, the UAE VAT at 5, Kenya VAT at 16. The invariant
     was never really "one rate" — it was "one rate per jurisdiction, and the
     document says which". A retail bill and a business invoice raised in the
     same market must still agree. */
  it('charges each market its own rate, and only its own rate', async () => {
    const { data: markets } = await supabase.from('markets').select('code,tax_rate,tax_label')
    const { data: bills } = await supabase.from('consumer_bills').select('id,market,tax_rate')
    const { data: invoices } = await supabase.from('enterprise_invoices').select('id,market,tax_rate')

    const rateFor = new Map((markets ?? []).map(m => [m.code as string, Number(m.tax_rate)]))
    expect(rateFor.size, 'no markets to charge tax in').toBeGreaterThan(1)

    for (const row of [...(bills ?? []), ...(invoices ?? [])]) {
      expect(Number(row.tax_rate), `${row.id} is taxed at a rate ${row.market} does not charge`)
        .toBe(rateFor.get(row.market as string))
    }

    /* And a retail bill and a business invoice in the same market agree — the
       original point of the test, now stated per market. */
    for (const [code, rate] of rateFor) {
      const here = [...(bills ?? []), ...(invoices ?? [])].filter(r => r.market === code)
      const rates = new Set(here.map(r => Number(r.tax_rate)))
      expect([...rates].length, `${code} charges more than one rate`).toBeLessThanOrEqual(1)
      if (here.length) expect([...rates][0]).toBe(rate)
    }
  })

  it('prints that rate on the document rather than inferring one', () => {
    /* The sample documents are drawn for the default market. */
    expect(book.samples.consumer!.taxRate).toBeGreaterThan(0)
    expect(book.samples.enterprise!.taxRate).toBeGreaterThan(0)
  })
})
