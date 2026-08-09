/* The only module that talks to Supabase about bill templates.
 *
 * Two jobs, and the second is the one worth explaining. The first is the
 * ordinary CRUD over the template catalogue. The second is assembling a real
 * bill for the preview — a real one, from `consumer_bills`,
 * `enterprise_invoices` and `settlement_statements`, rather than a plausible
 * arrangement of round numbers.
 *
 * That matters because the whole point of a section list is checking your own
 * work against it, and you cannot check a document whose figures were invented
 * to look tidy. An operator who ticks "Reward points" should find out here that
 * their seller documents have no reward figures to print, not from a customer.
 */
import { supabase } from './supabase'
import { markFor } from './money'
import {
  type Section, type Template, type TemplateSection, type Assignment, type Issuer,
  type Audience, type BillFacts,
  canDelete, nextReference, validateTemplate, money, issuerFor, issuersByMarket, taxLabelFor,
} from './billTemplate'
import { faceOfDocument, regimeFor, scannable } from './einvoice'
import type { ClearanceRecord, Regime, DocKind } from './einvoice'

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

export interface BillTemplateBook {
  sections: Section[]
  templates: Template[]
  chosen: TemplateSection[]
  assignments: Assignment[]
  /* One issuing entity per market. The preview renders through the Indian one
     because the specimen customer it samples is Indian; the operator picks
     which to edit. */
  issuers: Issuer[]
  issuer: Issuer | null
  /* One genuine document per audience, for the preview to render through
     whichever template is being edited. */
  samples: Record<Audience, BillFacts | null>
  loadError?: string
}

const EMPTY_SAMPLES: Record<Audience, BillFacts | null> =
  { consumer: null, enterprise: null, partner: null }

export async function loadBillTemplates(): Promise<BillTemplateBook> {
  const [secRes, tplRes, tsRes, asgRes, issRes, mktRes] = await Promise.all([
    supabase.from('invoice_sections').select('*').order('sort_order'),
    supabase.from('invoice_templates').select('*').order('sort_order'),
    supabase.from('invoice_template_sections').select('*'),
    supabase.from('invoice_template_assignments').select('*').order('id'),
    supabase.from('invoice_issuer').select('*'),
    supabase.from('markets').select('code, sort_order').order('sort_order'),
  ])

  const issuers = issuersByMarket(
    (issRes.data ?? []) as Issuer[],
    (mktRes.data ?? []) as { code: string; sort_order: number }[],
  )
  /* The specimen customer the preview samples is the Indian demo row, so the
     preview is rendered under the Indian entity. Anything else would print a
     Kenyan company's KRA PIN above a rupee bill. */
  const issuer = issuerFor('IN', issuers) ?? issuers[0] ?? null
  const book: BillTemplateBook = {
    sections: (secRes.data ?? []) as Section[],
    templates: (tplRes.data ?? []) as Template[],
    chosen: (tsRes.data ?? []) as TemplateSection[],
    assignments: (asgRes.data ?? []) as Assignment[],
    issuers,
    issuer,
    samples: EMPTY_SAMPLES,
  }

  /* The catalogue is what the screen is for. A sample that fails to load costs
     the preview its figures, which is a smaller thing than a blank screen, so
     only the first three reads can fail it. */
  const failed = [secRes.error, tplRes.error, tsRes.error].find(Boolean)
  if (failed) return { ...book, loadError: failed.message }

  book.samples = await loadSamples(issuer, book.templates, book.assignments)
  return book
}

/* ------------------------------------------------------- the real document -- */

async function loadSamples(
  issuer: Issuer | null, templates: readonly Template[], assignments: readonly Assignment[],
): Promise<Record<Audience, BillFacts | null>> {
  const [bills, invoices, lines, statements, banners, profile, address, account, member, ledger,
         clearance, regimes, taxLabels] =
    await Promise.all([
      /* Ordered by id, not by `issued`. Those columns hold "01 Jun 2026" as
         text, and sorting that lexically puts April after June. */
      supabase.from('consumer_bills').select('*').order('id', { ascending: false }),
      supabase.from('enterprise_invoices').select('*').order('id', { ascending: false }),
      supabase.from('enterprise_invoice_lines').select('*').order('sort_order'),
      supabase.from('settlement_statements').select('*').order('sort_order', { ascending: false }),
      supabase.from('operator_banners').select('*').eq('status', 'live'),
      /* Deliberately the demo customer. This runs as the operator designing a
         bill template, and the preview needs one specimen customer to render
         against — not whoever happens to be signed in, which for an operator is
         nobody. The other call sites of this table are the shopper's own row
         and do not filter. */
      supabase.from('consumer_profile').select('*').eq('id', 'me').maybeSingle(),
      supabase.from('consumer_addresses').select('*').eq('is_default', true).maybeSingle(),
      supabase.from('enterprise_accounts').select('*').eq('id', 'ENT-2007').maybeSingle(),
      supabase.from('loyalty_members').select('*').eq('kind', 'consumer'),
      supabase.from('loyalty_ledger').select('*'),
      /* The tax authority's stamp on the specimen documents. A preview that
         omitted it would show an operator a fiscal-clearance section rendering
         as nothing and leave them to conclude the section is broken — the
         specimen bills this samples are Kenyan and Indian, and both carry
         one. */
      supabase.from('einvoice_clearance').select('*'),
      supabase.from('tax_regime').select('*').order('sort_order'),
      /* What each market calls its own tax. The preview hard-coded 'GST' on
         all three specimens, so the Kenyan bill it samples printed "GST at
         16%" — an Indian tax name over a Kenyan VAT rate, on the screen whose
         entire job is showing an operator what will actually be issued. */
      supabase.from('markets').select('code, tax_label'),
    ])

  const labelFor = (market: string | null | undefined) =>
    taxLabelFor(market, (taxLabels.data ?? []) as { code: string; tax_label: string }[])

  /* Reduced once, the same way the customer's own bill reduces it, so the
     preview and the issued document cannot print different stamps. */
  const stampFor = (kind: DocKind, id: string, market: string | null) => {
    const rec = ((clearance.data ?? []) as ClearanceRecord[])
      .find(c => c.doc_kind === kind && c.doc_id === id) ?? null
    const regime = regimeFor((regimes.data ?? []) as Regime[], market ?? '')
    return { clearance: faceOfDocument(regime, rec), verifyUrl: scannable(rec) }
  }

  const from = issuer
    ? { name: issuer.legal_name, lines: issuer.lines, tax: `${issuer.tax_label} ${issuer.tax_id}` }
    : { name: 'Aventa Telecom', lines: [], tax: null }
  /* The masthead carries the mark somebody recognises; the parties block
     carries the entity that is legally issuing the document. On a real bill
     they are printed in different places and are not the same string. */
  const mark = issuer?.trading_name || from.name

  const support = issuer && (issuer.support_phone || issuer.support_email)
    ? {
      phone: issuer.support_phone, hours: issuer.support_hours,
      email: issuer.support_email, portal: issuer.support_portal,
      window: issuer.dispute_window,
    }
    : null
  const terms = issuer?.terms ?? []

  /* The advert draws from whatever is live in the storefront right now. A
     preview that renders a banner nobody is running is a preview of a document
     that will never be issued. */
  const advertFor = (audience: Audience) => {
    const live = (banners.data ?? []).filter((b: Record<string, unknown>) => b.audience === audience)
    const b = live[0] as Record<string, string> | undefined
    return b ? { title: b.title, subtitle: b.subtitle ?? null, cta: b.cta, accent: b.accent || '#0D47A1' } : null
  }

  /* What a customer earned and redeemed inside the billing period.
   *
   * Split by movement type rather than by sign, which is not the same answer.
   * A refund claws points back with a negative movement and a reversed
   * redemption puts them back with a positive one — take the sign at face value
   * and the bill reports a refund as a redemption and a cancelled redemption as
   * earnings. So a reversal is netted against whichever side it undoes, and
   * expiries and opening balances sit in neither: they are in the balance, and
   * the balance is stated separately.
   */
  const rewardsIn = (memberId: string, period: string) => {
    const rows = (ledger.data ?? []).filter((l: Record<string, string>) =>
      l.member === memberId && sameMonth(l.when_date, period)) as Record<string, string>[]
    const sum = (f: (l: Record<string, string>) => boolean) =>
      rows.filter(f).reduce((n, l) => n + Number(l.points), 0)

    const earned = sum(l => l.type === 'earn' || l.type === 'bonus')
      + sum(l => l.type === 'reverse' && Number(l.points) < 0)
    const redeemed = -(sum(l => l.type === 'redeem')
      + sum(l => l.type === 'reverse' && Number(l.points) > 0))
    return { earned, redeemed }
  }

  const remit = (audience: Audience) => {
    const t = templateOf(audience, templates, assignments)
    return t?.remittance ?? ''
  }
  const refOf = (audience: Audience, party?: string) => {
    const t = templateOf(audience, templates, assignments)
    return t ? nextReference(t, { party }) : '—'
  }

  return {
    consumer: consumerFacts(),
    enterprise: enterpriseFacts(),
    partner: partnerFacts(),
  }

  function consumerFacts(): BillFacts | null {
    const bill = (bills.data ?? [])[0] as Record<string, string> | undefined
    if (!bill) return null
    const p = profile.data as Record<string, string> | null
    const a = address.data as Record<string, string> | null
    /* The customer's own membership, not the first one on file. `consumer_profile`
       carries a points figure of its own and the ledger is the one that
       reconciles, so the balance on the preview comes from the member record. */
    const lm = (member.data ?? []).find((m: Record<string, unknown>) =>
      (p?.user_id && m.user_id === p.user_id) || m.name === p?.name) as
      Record<string, number> | undefined

    const plan = Number(bill.plan_charge ?? 0)
    const subs = Number(bill.subscriptions ?? 0)
    const oneoff = Number(bill.oneoff ?? 0)
    const tax = Number(bill.tax ?? 0)
    const total = Number(bill.total ?? 0)
    const net = total - tax

    return {
      reference: bill.id,
      issued: bill.issued, due: bill.due,
      billedTo: {
        name: p?.name ?? 'A retail customer',
        ref: p?.customer_id ?? null,
        lines: a ? [a.line1, `${a.city} ${a.pin}`] : [p?.city ?? ''].filter(Boolean),
        contact: [p?.email, p?.msisdn].filter(Boolean).join(' · '),
        /* A retail customer has no tax registration, and printing a blank line
           where one would go is how a bill starts looking like a form. */
        tax: null,
      },
      billedFrom: { ...from, mark },
      lines: [
        { label: 'Monthly plan charge', detail: bill.period, amount: plan },
        { label: 'Subscriptions and add-ons', detail: 'Billed in advance', amount: subs },
      ].filter(l => l.amount > 0),
      usage: oneoff > 0
        ? [{ label: 'One-off charges and devices', detail: 'Billed in arrears', amount: oneoff }]
        : [],
      credits: 0,
      paid: bill.status === 'paid' ? total : 0,
      taxRate: Number(bill.tax_rate ?? 0) || (net > 0 ? Math.round((tax / net) * 1000) / 10 : 0),
      tax, total,
      /* "Earned this period" has to mean this period. The member record holds
         lifetime figures, and printing those under a period heading is the
         kind of wrong that only a customer notices — so the movements are
         summed over the month the bill covers instead. */
      rewards: lm
        ? { ...rewardsIn(String(lm.id), bill.period), balance: Number(lm.balance ?? 0) }
        : null,
      advert: advertFor('consumer'),
      paid_already: bill.status === 'paid',
      support, terms,
      howToPay: remit('consumer'),
      payRef: p?.customer_id ?? bill.id,
      currency: bill.currency,
      currencyMark: markFor(bill.currency),
      taxLabel: labelFor(bill.market),
      ...stampFor('consumer_bill', bill.id, bill.market ?? null),
    }
  }

  function enterpriseFacts(): BillFacts | null {
    const all = (invoices.data ?? []).filter((i: Record<string, string>) => i.account_id === 'ENT-2007') as
      Record<string, string>[]
    const lineCount = (id: string) =>
      (lines.data ?? []).filter((l: Record<string, string>) => l.invoice_id === id).length
    /* The invoice with the most detail behind it, rather than the most recent.
       An operator ticking "Subscriptions" and "Usage" needs a document that has
       both to show them; the newest invoice happens to have only one. */
    const inv = [...all].sort((a, b) => lineCount(b.id) - lineCount(a.id))[0]
    if (!inv) return null
    const acc = account.data as Record<string, string> | null
    const mine = (lines.data ?? []).filter((l: Record<string, string>) => l.invoice_id === inv.id) as
      Record<string, string>[]

    /* Split, never overlapping: a line counted in both blocks is a bill whose
       summary does not reconcile, which is the one thing a bill may not be. */
    const recurring = mine.filter(l => l.kind === 'subscription')
    const oneoff = mine.filter(l => l.kind !== 'subscription')
    const tax = Number(inv.tax ?? 0)
    const total = Number(inv.total ?? 0)

    return {
      reference: inv.id,
      issued: day(inv.issued), due: day(inv.due),
      billedTo: {
        name: acc?.legal_name ?? acc?.company ?? 'A business account',
        ref: inv.account_id ?? null,
        lines: [acc?.company ?? '', acc?.place_of_supply ?? ''].filter(Boolean),
        contact: acc?.terms ?? '',
        tax: acc?.registration ?? null,
      },
      billedFrom: { ...from, mark },
      lines: recurring.map(l => ({
        label: `${l.description}${l.seller ? ` · ${l.seller}` : ''}`,
        detail: `${l.quantity} × ${mark}${money(Number(l.unit_price))}${l.cost_centre ? ` · ${l.cost_centre}` : ''}`,
        amount: Number(l.amount),
      })),
      usage: oneoff.map(l => ({
        label: `${l.description}${l.seller ? ` · ${l.seller}` : ''}`,
        detail: l.requisition_id ?? l.kind,
        amount: Number(l.amount),
      })),
      credits: 0,
      paid: inv.status === 'paid' ? total : 0,
      taxRate: Number(inv.tax_rate ?? 0),
      tax, total,
      rewards: null,
      /* Never on an enterprise document, whatever is live. The template refuses
         the section; this refuses the content, so a template written for "any"
         and pointed at a business account cannot smuggle one in. */
      advert: null,
      paid_already: inv.status === 'paid',
      support, terms,
      howToPay: remit('enterprise'),
      payRef: inv.po_ref || inv.id,
      currency: inv.currency,
      currencyMark: markFor(inv.currency),
      taxLabel: labelFor(inv.market),
      ...stampFor('enterprise_invoice', inv.id, inv.market ?? null),
    }
  }

  function partnerFacts(): BillFacts | null {
    const st = (statements.data ?? [])
      .find((s: Record<string, string>) => s.partner_id) as Record<string, string> | undefined
    if (!st) return null

    const gross = Number(st.gross ?? 0)
    const commission = Number(st.commission ?? 0)
    const fees = Number(st.fees ?? 0)
    const refunds = Number(st.refunds ?? 0)
    const withholding = Number(st.withholding ?? 0)
    const net = Number(st.net ?? 0)

    return {
      reference: refOf('partner', st.partner_id),
      issued: st.period, due: st.period,
      billedTo: {
        name: st.partner_name,
        ref: st.partner_id ?? null,
        lines: [`${st.order_count} orders in ${st.period}`],
        contact: '',
        tax: null,
      },
      billedFrom: { ...from, mark },
      /* A self-billing invoice reads as a deduction sheet: gross the seller
         earned, less what the marketplace kept.
         All of it in `usage`, none of it in `subs`. A seller statement has no
         subscription side, so the seeded template does not carry that section —
         and a gross figure put there would simply never print, leaving a
         document of pure deductions whose total does not reconcile. */
      lines: [],
      usage: [
        { label: 'Gross sales', detail: `${st.order_count} orders · ${st.period}`, amount: gross },
        { label: 'Marketplace commission', detail: `${st.commission_rate ?? ''}%`, amount: -commission },
        { label: 'Platform and payment fees', detail: st.period, amount: -fees },
        { label: 'Refunds passed back', detail: st.period, amount: -refunds },
      ].filter(l => l.amount !== 0),
      credits: -withholding,
      paid: st.status === 'paid' ? net : 0,
      taxRate: 0,
      tax: 0,
      total: net,
      rewards: null,
      advert: null,
      paid_already: st.status === 'paid',
      support, terms,
      howToPay: remit('partner'),
      payRef: st.id,
      currency: st.currency,
      currencyMark: markFor(st.currency),
      taxLabel: labelFor(st.market),
      /* A self-billing statement is not a document any of these authorities
         clears — the marketplace raises it to itself. Empty is the answer, and
         the section renders nothing rather than an unearned stamp. */
      clearance: [], verifyUrl: null,
    }
  }
}

/* `loyalty_ledger.when_date` is "14 Jul 2026" and `consumer_bills.period` is
   "July 2026". Neither is a date, so they are compared as month and year
   rather than parsed into something they are not. */
function sameMonth(when: string, period: string): boolean {
  const w = new Date(when)
  const p = new Date(`01 ${period}`)
  if (isNaN(w.getTime()) || isNaN(p.getTime())) return false
  return w.getMonth() === p.getMonth() && w.getFullYear() === p.getFullYear()
}

function templateOf(
  audience: Audience, templates: readonly Template[], assignments: readonly Assignment[],
): Template | null {
  const a = assignments.find(x => x.audience === audience && x.party_id === null)
  return a ? templates.find(t => t.id === a.template_id) ?? null : null
}

function day(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/* ------------------------------------------------------------- the writes -- */

/* `currency` is not here: it is a fact about the transaction, and every table
   a document is raised from declares it `not null`. The `?? 'USD'` defaults
   that used to guard these reads could not fire, and would have mislabelled
   somebody's money if they ever had. */
export type Draft = Pick<Template,
  'name' | 'audience' | 'doc_title' | 'accent' | 'note' | 'numbering' | 'next_seq' |
  'date_format' | 'tax_label' | 'rounding' | 'language' | 'logo' |
  'show_order_lines' | 'remittance' | 'footer'>

/**
 * Create or edit a template and its section list in one call.
 *
 * The section list is reconciled rather than replaced: deleting every row and
 * re-inserting would trip `guard_invoice_template()` on the four locked
 * sections, and it would be right to — that path is indistinguishable from
 * somebody switching them off.
 */
export async function saveTemplate(
  { id, draft, ids, actor, all }: {
    id: string | null; draft: Draft; ids: readonly string[]; actor: string; all: readonly Section[]
  },
): Promise<Result & { id?: string }> {
  const check = validateTemplate(draft, ids, all)
  if (!check.ok) return check

  const isNew = !id
  const templateId = id ?? `BT-${Date.now().toString(36).toUpperCase().slice(-5)}`

  const row = {
    ...draft,
    id: templateId,
    updated_by: actor,
    updated_on: new Date().toISOString().slice(0, 10),
    ...(isNew ? { system: false, sort_order: 90 } : {}),
  }

  const { data, error } = await supabase.from('invoice_templates')
    .upsert(row).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  const secResult = await reconcileSections(templateId, ids, all)
  if (!secResult.ok) return secResult

  await writeAudit(actor, isNew ? 'bill.template.created' : 'bill.template.edited',
    draft.name, isNew ? null : templateId,
    isNew ? 'created' : 'edited',
    `${ids.length} sections · ${draft.audience} document`)

  return {
    ok: true,
    id: templateId,
    note: isNew
      ? `${draft.name} created. Assign it to an audience for anybody to be billed on it.`
      : `${draft.name} saved. It applies to documents issued from now on — bills already sent are unaffected.`,
  }
}

async function reconcileSections(
  templateId: string, ids: readonly string[], all: readonly Section[],
): Promise<Result> {
  const { data: current, error: readErr } = await supabase
    .from('invoice_template_sections').select('section_id').eq('template_id', templateId)
  if (readErr) return { ok: false, reason: friendly(readErr.message) }

  const held = new Set((current ?? []).map(r => r.section_id as string))
  const want = new Set(ids)

  const adding = [...want].filter(s => !held.has(s))
  const dropping = [...held].filter(s => !want.has(s))

  if (adding.length) {
    const order = new Map(all.map(s => [s.id, s.sort_order]))
    const { error } = await supabase.from('invoice_template_sections').insert(
      adding.map(section_id => ({ template_id: templateId, section_id, sort_order: order.get(section_id) ?? 0 })))
    if (error) return { ok: false, reason: friendly(error.message) }
  }

  for (const section_id of dropping) {
    const { data, error } = await supabase.from('invoice_template_sections')
      .delete().eq('template_id', templateId).eq('section_id', section_id).select('section_id')
    if (error) return { ok: false, reason: friendly(error.message) }
    if (!data?.length) return { ok: false, reason: REFUSED }
  }

  return { ok: true }
}

/**
 * A copy to experiment on.
 *
 * Never a system template — a duplicate is somebody's draft, and marking it
 * built-in would make it undeletable the moment they changed their mind.
 */
export async function duplicateTemplate(
  { source, ids, actor }: { source: Template; ids: readonly string[]; actor: string },
): Promise<Result & { id?: string }> {
  const id = `BT-${Date.now().toString(36).toUpperCase().slice(-5)}`
  const { data, error } = await supabase.from('invoice_templates').insert({
    ...source, id, name: `${source.name} (copy)`, system: false,
    sort_order: (source.sort_order ?? 0) + 90,
    updated_by: actor, updated_on: new Date().toISOString().slice(0, 10),
  }).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  const { error: secErr } = await supabase.from('invoice_template_sections')
    .insert(ids.map((section_id, i) => ({ template_id: id, section_id, sort_order: i + 1 })))
  if (secErr) {
    await supabase.from('invoice_templates').delete().eq('id', id)
    return { ok: false, reason: friendly(secErr.message) }
  }

  await writeAudit(actor, 'bill.template.duplicated', `${source.name} (copy)`, source.id, 'created',
    `Copied from ${source.name}`)
  return { ok: true, id, note: `${source.name} (copy) created. It is assigned to nobody until you say so.` }
}

export async function deleteTemplate(
  { template, assignments, actor }: {
    template: Template; assignments: readonly Assignment[]; actor: string
  },
): Promise<Result> {
  const check = canDelete(template, assignments)
  if (!check.ok) return check

  const { data, error } = await supabase.from('invoice_templates')
    .delete().eq('id', template.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'bill.template.deleted', template.name, template.id, 'deleted',
    'Unassigned template deleted')
  return {
    ok: true,
    note: `${template.name} deleted. Bills already issued on it are unaffected — a bill is a snapshot, not a live render.`,
  }
}

/**
 * Point an audience, or one counterparty, at a template.
 *
 * `party_id` null is the audience default; a value is the exception for that
 * counterparty alone. The database enforces both uniqueness rules and that the
 * template serves the audience, so this can afford to be thin.
 */
export async function assignTemplate(
  { audience, partyId, templateId, why, actor }: {
    audience: Audience; partyId: string | null; templateId: string; why: string; actor: string
  },
): Promise<Result> {
  const id = partyId ? `IA-${partyId.replace(/\W+/g, '')}` : `IA-${audience.slice(0, 3).toUpperCase()}`
  const { data, error } = await supabase.from('invoice_template_assignments').upsert({
    id, audience, party_id: partyId, template_id: templateId,
    why: why.trim(), updated_by: actor, updated_on: new Date().toISOString().slice(0, 10),
  }).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'bill.template.assigned', partyId ?? audience, null, templateId,
    partyId ? `Override for ${partyId}` : `Default for every ${audience}`)
  return {
    ok: true,
    note: partyId
      ? `${partyId} will be billed on this template from the next document. Nobody else changes.`
      : `Every ${audience} bill issued from now on comes out on this template.`,
  }
}

/** Take an exception away, so the counterparty falls back to the default. */
export async function removeOverride(
  { assignment, actor }: { assignment: Assignment; actor: string },
): Promise<Result> {
  if (!assignment.party_id) {
    return {
      ok: false,
      reason: 'That is the default for the audience, not an exception. Point it at another template instead — an audience with no template has no bill.',
    }
  }
  const { data, error } = await supabase.from('invoice_template_assignments')
    .delete().eq('id', assignment.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'bill.template.unassigned', assignment.party_id, assignment.template_id,
    'removed', 'Exception removed; the audience default applies again')
  return { ok: true, note: `${assignment.party_id} goes back to the ${assignment.audience} default.` }
}

/**
 * The identity documents in one market are issued under.
 *
 * Written by `id`, taken off the row being edited. It used to be hard-coded to
 * `'default'` — which was the only row, and would now mean editing the Kenyan
 * entity's support number and saving it onto the Indian company.
 */
export async function saveIssuer(
  { issuer, actor }: { issuer: Partial<Issuer>; actor: string },
): Promise<Result> {
  if (!issuer.id) {
    return { ok: false, reason: 'No issuing entity was selected, so there is nothing to save against.' }
  }
  if (!issuer.legal_name?.trim()) {
    return { ok: false, reason: 'A registered legal name is required — it is who the document is from.' }
  }
  if (!(issuer.lines ?? []).filter(l => l.trim()).length) {
    return { ok: false, reason: 'A registered address is required. A bill without one is not a document a finance team can process.' }
  }
  /* The market is what decides which customers see this entity, and moving it
     would silently reassign every bill in two countries. Changed through the
     markets screen, not through a text field on a billing identity. */
  const { market: _pinned, ...editable } = issuer
  const { data, error } = await supabase.from('invoice_issuer').update({
    ...editable,
    lines: (issuer.lines ?? []).map(l => l.trim()).filter(Boolean),
    terms: (issuer.terms ?? []).map(l => l.trim()).filter(Boolean),
    updated_by: actor, updated_on: new Date().toISOString().slice(0, 10),
  }).eq('id', issuer.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'bill.issuer.edited', issuer.legal_name, null, 'edited',
    `Billing identity for ${issuer.market ?? issuer.id} changed — it prints on every document issued there from now on`)
  return { ok: true, note: 'Saved. It prints on every document issued in that market from now on.' }
}

/* --------------------------------------------------------------- helpers -- */

const REFUSED = 'Nothing changed. Only the marketplace operator can edit bill templates.'

async function writeAudit(
  actor: string, action: string, object: string, before: string | null,
  after: string, detail: string,
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Marketplace operations', action, object,
    category: 'Settlement', severity: action.endsWith('deleted') ? 'warn' : 'info',
    outcome: 'success', before_val: before, after_val: `${after} — ${detail}`,
  })
}

/* The database refuses in the language of the database. These are the same
   refusals in the language of somebody who was trying to do something. */
function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/cannot be switched off|is not a bill/i.test(m)) return m
  if (/ships with the marketplace|still assigned/i.test(m)) return m
  if (/not written for a/i.test(m)) return m
  if (/invoice_templates_numbering_check/i.test(m)) {
    return 'The numbering pattern needs {SEQ} in it, or every document carries the same reference.'
  }
  if (/invoice_assignment_default_idx/i.test(m)) {
    return 'That audience already has a default. Change the one it has rather than adding a second.'
  }
  if (/invoice_assignment_party_idx|duplicate key/i.test(m)) {
    return 'That counterparty already has an exception. Change the one they have.'
  }
  if (/row-level security|permission denied/i.test(m)) return REFUSED
  if (/violates foreign key/i.test(m)) return 'That template or section no longer exists. Reload the screen.'
  return m
}
