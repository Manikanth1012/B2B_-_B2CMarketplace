/* The document a bill comes out as. No React and no Supabase, so the rules can
   be tested without a DOM or a network.

   Two kinds of rule live here and they are deliberately different in force.

   A REFUSAL is something the document cannot be. Four sections cannot come off,
   because a paper without both parties, the tax breakdown and a summary that
   reconciles is not a bill; a section written for one audience cannot be put on
   another's document, because a payment slip on a self-billing invoice asks the
   seller to pay us. Those are checked here so the screen can explain them, and
   again by `guard_invoice_template()` so the explanation cannot be skipped.

   A WARNING is something the document should not be, which is a different
   thing. An advert on an enterprise invoice is legal, buildable, and almost
   certainly a mistake — so it is said out loud and then allowed, because the
   operator knows their own contracts and this module does not. */

import { round2 } from './money'

export type Check = { ok: true; note?: string } | { ok: false; reason: string }
export type Audience = 'consumer' | 'enterprise' | 'partner'

export interface Section {
  id: string
  label: string
  note: string
  locked: boolean
  audiences: Audience[]
  /* The catalogue's own order. Only a starting position now — where a section
     actually sits on a document is `TemplateSection.sort_order`, which is per
     template, because one template's layout is not another's. */
  sort_order: number
  /* A heading and free text an operator wrote for one template. Every built-in
     section renders figures the marketplace computes; a custom one says
     something and calculates nothing, which is the whole distinction. */
  custom?: boolean
  owner_template?: string | null
  heading?: string | null
  body?: string | null
  /* Where it may sit. 'top' for the blocks that identify the document,
     'after' for the ones that refer back to the total, null for the rest. */
  anchor?: 'top' | 'after' | null
}

export interface Template {
  id: string
  name: string
  audience: Audience | 'any'
  doc_title: string
  accent: string
  note: string
  system: boolean
  numbering: string
  next_seq: number
  date_format: string
  /* No `currency`. The template used to carry one, left over from when every
     document was in dollars. It decided nothing — `BillFacts.currency` below is
     taken from the row being billed — so an operator could set a template to
     EUR and every bill under it still printed rupees. A template is a layout,
     and one layout renders a rupee bill and a dirham bill. */
  tax_label: string
  rounding: string
  language: string
  logo: boolean
  show_order_lines: boolean
  remittance: string
  footer: string
  updated_by: string | null
  updated_on: string | null
  sort_order: number
}

export interface TemplateSection {
  template_id: string
  section_id: string
  sort_order: number
}

export interface Assignment {
  id: string
  audience: Audience
  party_id: string | null
  template_id: string
  why: string
  updated_by: string | null
  updated_on: string | null
}

/* The half of a bill that is the same on every bill: who is issuing it, and
   who to ring when it is wrong. It belongs to the marketplace rather than to
   the template, which is why changing it changes every document at once. */
export interface Issuer {
  id: string
  legal_name: string
  trading_name: string
  lines: string[]
  tax_label: string
  tax_id: string
  company_no: string | null
  bank_name: string
  bank_detail: string
  support_phone: string
  support_hours: string
  support_email: string
  support_portal: string
  dispute_window: string
  dispute_note: string
  escalation: string
  terms: string[]
  updated_by: string | null
  updated_on: string | null
  /* The market this entity is registered in and issues for. One issuer per
     market, enforced by a unique index. */
  market?: string | null
}

/**
 * The entity that issues a document to a customer in a given market.
 *
 * There was one issuer row, `id = 'default'`, and every bill in every market
 * came from it — so the Kenyan customer's VAT bill was issued by an Indian
 * private limited company, quoted an Indian GSTIN against 16% Kenyan VAT, and
 * told her to pay into a rupee account in Bengaluru. The support number is what
 * somebody notices; the tax identifier is what makes the document unfileable,
 * and the bank details are what costs money if followed.
 *
 * There is no fallback to another country's entity. A market with no registered
 * issuer returns null and the caller shows no issuer at all, because a bill
 * from the wrong jurisdiction is worse than a bill with a gap in it — the first
 * looks correct.
 */
export function issuerFor(
  market: string | null | undefined, issuers: readonly Issuer[],
): Issuer | null {
  if (!market) return null
  return issuers.find(i => i.market === market) ?? null
}

/**
 * What the tax on a document is called where it is raised.
 *
 * GST in India, VAT in the UAE and Kenya. `invoice_templates.tax_label` names
 * it too, and cannot: one template renders documents in all three markets, so
 * the best it can manage is a hedge — the seeded seller template says
 * "GST / VAT" and the enterprise one "VAT / GST", which print on the document
 * exactly as written. A Kenyan invoice reading "VAT / GST at 16%" is a document
 * telling its reader the issuer is not sure which country they are in.
 *
 * The consumer bill already worked this out and read the market directly.
 * The seller statement and the enterprise invoice did not, so they are the two
 * documents still carrying the hedge — this is the same rule, in one place, for
 * all three.
 *
 * The template's label survives only as the fallback for a market that is not
 * on file, and 'Tax' behind that: an unnamed tax line is worse than a
 * generically named one.
 */
export function taxLabelFor(
  market: string | null | undefined,
  markets: readonly { code: string; tax_label: string }[],
  template?: { tax_label?: string | null } | null,
): string {
  return markets.find(m => m.code === market)?.tax_label
    || template?.tax_label
    || 'Tax'
}

/** Issuers in market order, for the operator's picker. */
export function issuersByMarket(
  issuers: readonly Issuer[], order: readonly { code: string; sort_order: number }[],
): Issuer[] {
  const rank = (code: string | null | undefined) =>
    order.find(m => m.code === code)?.sort_order ?? 999
  return [...issuers].sort((a, b) => rank(a.market) - rank(b.market))
}

/* ------------------------------------------------------------ what is on -- */

/**
 * The sections on this template, in the order this template prints them.
 *
 * `chosen` has carried a per-template `sort_order` since the table existed and
 * this sorted by the catalogue's global one instead — so every template on the
 * marketplace printed its blocks in one fixed order, and the column meant to
 * vary them was read by nothing and written by nothing.
 *
 * Falls back to the catalogue position where a template row has none, which is
 * what a section added before any of this looks like.
 */
export function sectionsOn(
  template: Template, all: readonly Section[], chosen: readonly TemplateSection[],
): Section[] {
  const at = new Map(
    chosen.filter(c => c.template_id === template.id).map(c => [c.section_id, c.sort_order]))
  return all
    .filter(s => at.has(s.id))
    .sort((a, b) => (at.get(a.id) ?? a.sort_order) - (at.get(b.id) ?? b.sort_order))
}

/* ---------------------------------------------------------------- ordering -- */

/**
 * Whether a section list is one a document can be printed from.
 *
 * The order is not free, and the reasons are on the sections themselves.
 * "Summary and total" says of itself that it *reconciles every block above it*
 * — put it above the charges and the document makes a false statement about
 * its own arithmetic. The masthead is the masthead because it is first. The
 * fiscal stamp stamps the total it follows.
 *
 * The database evaluates the same rule in `guard_section_order`. This one is so
 * the screen can grey out an arrow rather than accept a move and then relay a
 * trigger's exception.
 */
export function orderProblem(ids: readonly string[], all: readonly Section[]): string | null {
  const by = new Map(all.map(s => [s.id, s]))
  const anchorAt = (i: number) => by.get(ids[i])?.anchor ?? null

  const lastTop = ids.reduce((n, _, i) => (anchorAt(i) === 'top' ? i : n), -1)
  const firstFree = ids.findIndex((_, i) => anchorAt(i) !== 'top')
  if (lastTop >= 0 && firstFree >= 0 && lastTop > firstFree) {
    return `${by.get(ids[lastTop])?.label} opens the document and cannot sit below ${by.get(ids[firstFree])?.label}.`
  }

  const summary = ids.indexOf('summary')
  if (summary >= 0) {
    const early = ids.findIndex((id, i) => by.get(id)?.anchor === 'after' && i < summary)
    if (early >= 0) {
      return `${by.get(ids[early])?.label} refers back to the total, so it cannot sit above Summary and total.`
    }
  }
  return null
}

/**
 * The list with one section moved a place, or null where the move is one the
 * document could not be printed from.
 *
 * Null rather than a clamped list: an arrow that silently does nothing is
 * indistinguishable from a broken one, so the caller disables it instead.
 */
export function moved(
  ids: readonly string[], id: string, dir: -1 | 1, all: readonly Section[],
): string[] | null {
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return null
  const next = [...ids]
  ;[next[i], next[j]] = [next[j], next[i]]
  return orderProblem(next, all) ? null : next
}

export function has(ids: readonly string[], id: string): boolean {
  return ids.includes(id)
}

/** Whether a section can go on a template written for this audience at all. */
export function offeredTo(section: Section, audience: Template['audience']): boolean {
  if (audience === 'any') return true
  return section.audiences.includes(audience)
}

/* --------------------------------------------------------- the refusals -- */

/**
 * Whether a section can be taken off.
 *
 * The four locked ones are the difference between a bill and a letter about
 * money, and the refusal names which one rather than saying "required" — an
 * operator who has just been stopped wants to know what they were stopped from
 * doing.
 */
export function canRemove(section: Section): Check {
  if (section.locked) {
    return {
      ok: false,
      reason: `${section.label} cannot be switched off. A document without both parties, the tax breakdown and a summary that reconciles is not a bill.`,
    }
  }
  return { ok: true }
}

export function canAdd(section: Section, audience: Template['audience']): Check {
  if (!offeredTo(section, audience)) {
    return {
      ok: false,
      reason: `${section.label} is not written for a ${audience} document. ${whyNot(section.id, audience)}`,
    }
  }
  return { ok: true }
}

function whyNot(sectionId: string, audience: Template['audience']): string {
  if (sectionId === 'slip' && audience === 'partner') {
    return 'A payment slip asks the reader to pay us, and on a self-billing invoice we pay them.'
  }
  if (sectionId === 'paylink' && audience === 'partner') {
    return 'The marketplace settles a seller on its own cycle; there is nothing for them to pay.'
  }
  if (sectionId === 'advert') {
    return 'A procurement team did not ask to be sold to on a tax document.'
  }
  if (sectionId === 'rewards' && audience === 'partner') {
    return 'Reward points are earned by buyers. A seller funds them.'
  }
  return 'It has no meaning on that document.'
}

/* --------------------------------------------------------- the warnings -- */

export interface Warning { level: 'warn' | 'info'; text: string }

/**
 * What is odd about this template, said out loud and then allowed.
 *
 * Each of these is a document somebody could genuinely want and probably does
 * not. The operator knows their own contracts and jurisdictions; this module
 * knows what usually goes wrong. So it says so and gets out of the way.
 */
export function warningsFor(
  { ids, audience, showOrderLines }: {
    ids: readonly string[]
    audience: Template['audience']
    showOrderLines: boolean
  },
): Warning[] {
  const out: Warning[] = []

  if (has(ids, 'advert') && audience !== 'consumer') {
    out.push({
      level: 'warn',
      text: 'An advertisement on an enterprise or seller document is unusual. A procurement team did not ask to be sold to on an invoice, and some contracts forbid it outright.',
    })
  }
  if (has(ids, 'slip') && audience === 'partner') {
    out.push({
      level: 'warn',
      text: 'A payment slip on a self-billing invoice is backwards — the marketplace pays the seller, not the reverse.',
    })
  }
  if (has(ids, 'slip') && !has(ids, 'howtopay')) {
    out.push({
      level: 'warn',
      text: 'A payment slip without payment instructions leaves the reader holding a reference and nowhere to send it.',
    })
  }
  if (has(ids, 'paylink') && !has(ids, 'hero')) {
    out.push({
      level: 'info',
      text: 'A payment link with no amount-due panel asks somebody to pay a figure they have to add up themselves.',
    })
  }
  if (!has(ids, 'support')) {
    out.push({
      level: 'warn',
      text: 'No support block. A bill is where people look when something is wrong with a bill, so leaving it off sends them to a search engine.',
    })
  }
  if (!has(ids, 'howtopay') && !has(ids, 'paylink') && audience !== 'partner') {
    out.push({
      level: 'warn',
      text: 'Neither payment instructions nor a payment link. The reader is told what they owe and not how to settle it.',
    })
  }
  if (!showOrderLines && (has(ids, 'subs') || has(ids, 'usage'))) {
    out.push({
      level: 'info',
      text: 'Line detail is suppressed, so the charge sections print a totals line rather than the items behind it.',
    })
  }
  if (has(ids, 'rewards') && audience === 'partner') {
    out.push({
      level: 'info',
      text: 'Reward points on a seller document show what the seller funded rather than what they earned.',
    })
  }

  return out
}

/** Whether this is a document somebody could actually be sent. */
export function validateTemplate(
  draft: { name: string; doc_title: string; numbering: string; audience: Template['audience'] },
  ids: readonly string[],
  all: readonly Section[],
): Check {
  if (!draft.name.trim()) {
    return { ok: false, reason: 'A template needs a name — it is what the assignment screen refers to.' }
  }
  if (!draft.doc_title.trim()) {
    return { ok: false, reason: 'A document needs a title. "Tax invoice" carries a legal meaning in some places, so choose it deliberately.' }
  }
  if (!draft.numbering.includes('{SEQ}')) {
    return {
      ok: false,
      reason: 'The numbering pattern needs {SEQ} in it. Without a sequence every document carries the same reference, which is the one thing a reference may not do.',
    }
  }

  const missing = all.filter(s => s.locked && !ids.includes(s.id))
  if (missing.length) {
    return { ok: false, reason: `${missing.map(s => s.label).join(' and ')} cannot be switched off.` }
  }

  const wrong = all.filter(s => ids.includes(s.id) && !offeredTo(s, draft.audience))
  if (wrong.length) {
    return canAdd(wrong[0], draft.audience) as Check
  }

  const warnings = warningsFor({ ids, audience: draft.audience, showOrderLines: true })
  const serious = warnings.filter(w => w.level === 'warn')
  return {
    ok: true,
    note: serious.length
      ? `${ids.length} sections. ${serious.length} thing${serious.length === 1 ? '' : 's'} worth a second look before this goes out.`
      : `${ids.length} sections. A complete document for this audience.`,
  }
}

/* --------------------------------------------------------- the numbering -- */

/**
 * The reference this template would put on its next document.
 *
 * `{SEQ}` is the running number, `{YYYY}` the year, `{PARTNER}` the
 * counterparty — which is why a seller pattern can carry one and a consumer
 * pattern cannot sensibly.
 */
export function nextReference(
  t: Pick<Template, 'numbering' | 'next_seq'>,
  { year, party }: { year?: number; party?: string } = {},
): string {
  return t.numbering
    .replace(/\{YYYY\}/g, String(year ?? new Date().getFullYear()))
    .replace(/\{YY\}/g, String(year ?? new Date().getFullYear()).slice(-2))
    .replace(/\{PARTNER\}/g, party ? party.replace(/^\D+/, '') : '0000')
    .replace(/\{SEQ\}/g, String(t.next_seq))
}

/**
 * The reference shape, for when there is no counterparty to put in it.
 *
 * An audience default serves every seller, so `{PARTNER}` has no value — and
 * substituting a placeholder produces `SB-2026-0000-1042`, which reads as a
 * real reference and is not one. The token is left standing instead, so the
 * line reads as the pattern it is.
 */
export function referencePattern(
  t: Pick<Template, 'numbering' | 'next_seq'>, year?: number,
): string {
  return t.numbering
    .replace(/\{YYYY\}/g, String(year ?? new Date().getFullYear()))
    .replace(/\{YY\}/g, String(year ?? new Date().getFullYear()).slice(-2))
    .replace(/\{SEQ\}/g, String(t.next_seq))
}

/** Whether a pattern will produce distinguishable references. */
export function validateNumbering(pattern: string): Check {
  if (!pattern.trim()) return { ok: false, reason: 'A numbering pattern is required.' }
  if (!pattern.includes('{SEQ}')) {
    return { ok: false, reason: 'Include {SEQ} — without it every document carries the same reference.' }
  }
  const unknown = (pattern.match(/\{[A-Z]+\}/g) ?? [])
    .filter(t => !['{SEQ}', '{YYYY}', '{YY}', '{PARTNER}'].includes(t))
  if (unknown.length) {
    return { ok: false, reason: `${unknown.join(', ')} is not something this pattern understands. Use {SEQ}, {YYYY}, {YY} or {PARTNER}.` }
  }
  return { ok: true }
}

/* --------------------------------------------------------- the assignment -- */

/**
 * Which template a counterparty's bill comes out on.
 *
 * The override wins over the audience default. That ordering is the whole
 * point of having both: one seller in a jurisdiction that prescribes a format
 * must not change the document every other seller gets.
 */
export function templateFor(
  { audience, partyId }: { audience: Audience; partyId?: string | null },
  assignments: readonly Assignment[],
  templates: readonly Template[],
): Template | null {
  const exact = partyId
    ? assignments.find(a => a.audience === audience && a.party_id === partyId)
    : undefined
  const fallback = assignments.find(a => a.audience === audience && a.party_id === null)
  const chosen = exact ?? fallback
  return chosen ? templates.find(t => t.id === chosen.template_id) ?? null : null
}

/** Who is currently sent a document on this template. */
export function usedBy(templateId: string, assignments: readonly Assignment[]): string[] {
  return assignments
    .filter(a => a.template_id === templateId)
    .map(a => a.party_id ?? `every ${a.audience}`)
}

export function canDelete(t: Template, assignments: readonly Assignment[]): Check {
  if (t.system) {
    return {
      ok: false,
      reason: `${t.name} ships with the marketplace. It can be edited but not deleted — an audience with no template has no bill.`,
    }
  }
  const used = usedBy(t.id, assignments)
  if (used.length) {
    return { ok: false, reason: `${t.name} is still assigned to ${used.join(', ')}. Point them at another template first.` }
  }
  return {
    ok: true,
    note: 'It is assigned to nobody, so no bill changes. Documents already issued on it are unaffected — a bill is a snapshot, not a live render.',
  }
}

/* ------------------------------------------------------------ the preview -- */

/* What a rendered bill needs to know, independent of where the figures came
   from. The preview and a real issued document take the same shape, so the
   operator is looking at the thing rather than at an impression of it. */
export interface BillFacts {
  reference: string
  issued: string
  due: string
  /* `ref` is the counterparty's account or seller id. It goes in the parties
     block, it is what a payment slip asks them to quote, and it is what
     `{PARTNER}` in a numbering pattern resolves to. */
  billedTo: { name: string; ref: string | null; lines: string[]; contact: string; tax: string | null }
  /* `name` is the registered entity for the parties block; `mark` is the
     trading name for the masthead. A bill prints both, in different places. */
  billedFrom: { name: string; mark: string; lines: string[]; tax: string | null }
  lines: { label: string; detail: string; amount: number }[]
  usage: { label: string; detail: string; amount: number }[]
  credits: number
  paid: number
  taxRate: number
  tax: number
  total: number
  rewards: { earned: number; balance: number; redeemed: number } | null
  advert: { title: string; subtitle: string | null; cta: string; accent: string } | null
  paid_already: boolean
  /* Null when the issuing entity has published no way to be reached. The
     section then renders nothing rather than an empty heading, and `suppressed`
     says why — an operator who ticked "Support" wants to know it came out
     blank. */
  support: { phone: string; hours: string; email: string; portal: string; window: string } | null
  howToPay: string
  terms: string[]
  /* What the counterparty quotes back at us. On the slip and in the payment
     instructions, so the two cannot disagree. */
  payRef: string
  /* The currency the document is denominated in, and the mark to print in
     front of each figure.
     
     On the bill rather than on the template, because the template is a layout
     the operator designed and the currency is a fact about the transaction.
     One template renders a rupee bill and a dirham bill; the row decides which.
     A bill of bare numbers is a bill whose amounts mean nothing — the reader
     has to know 757.28 is dirhams and not rupees to know what they owe. */
  currency: string
  currencyMark: string
  /* GST in India, VAT in the UAE and Kenya. The template used to name the tax,
     which made every bill say GST wherever it was raised. */
  taxLabel: string
  /* What the tax authority gave back for this document, already reduced to the
     labels its own jurisdiction uses — an IRN in India, a control unit number
     in Kenya, nothing in the Emirates. Empty is the ordinary answer in two of
     the three markets, and the section renders nothing rather than an empty
     heading when it is.

     Reduced here rather than in the renderer so the PDF and the on-screen
     document cannot print different stamps for one document. */
  clearance: { label: string; value: string; mono?: boolean }[]
  /* Where a reader checks the stamp themselves. Kenya publishes an iTax URL;
     India returns a signed QR and no link. Null in both other cases. */
  verifyUrl: string | null
}

/**
 * Which blocks actually render, given the sections chosen and the bill itself.
 *
 * Not the same question as which sections are ticked. A payment link on a bill
 * that is already settled is an invitation to pay twice; a reward block on a
 * customer with no points is an empty box. The template says what may appear
 * and the document says what does.
 */
export function blocksFor(ids: readonly string[], facts: BillFacts): string[] {
  return ids.filter(id => {
    if (id === 'paylink' && facts.paid_already) return false
    if (id === 'slip' && facts.paid_already) return false
    if (id === 'rewards' && !facts.rewards) return false
    if (id === 'advert' && !facts.advert) return false
    if (id === 'credits' && facts.credits === 0 && facts.paid === 0) return true  // shown at nil on purpose
    if (id === 'payments' && facts.paid === 0) return false
    if (id === 'support' && !facts.support) return false
    if (id === 'terms' && !facts.terms.length) return false
    if (id === 'howtopay' && !facts.howToPay.trim()) return false
    /* Two of the three markets clear nothing, so a locked section with nothing
       to print is the ordinary case rather than a fault. Dropping it here
       means `suppressed` explains the blank instead of the document carrying
       an empty heading. */
    if (id === 'fiscal' && facts.clearance.length === 0) return false
    return true
  })
}

/** Why a ticked section is not on this particular document. */
export function suppressed(ids: readonly string[], facts: BillFacts): { id: string; why: string }[] {
  const showing = new Set(blocksFor(ids, facts))
  const reasons: Record<string, string> = {
    paylink: 'this bill is already paid, and a payment link on a settled bill invites paying twice',
    slip: 'this bill is already paid',
    rewards: 'this customer is not on a rewards programme',
    advert: 'no banner is live for this audience right now',
    payments: 'nothing was paid during this period',
    support: 'the issuing entity has published no support contact — set one under Billing identity',
    terms: 'no terms have been written for the issuing entity',
    howtopay: 'this template carries no remittance instructions',
    fiscal: 'this document was raised in a market that requires no fiscal clearance, or has not been cleared yet',
  }
  return ids
    .filter(id => !showing.has(id))
    .map(id => ({ id, why: reasons[id] ?? 'it has nothing to show on this bill' }))
}

/**
 * An amount as it is printed on a document.
 *
 * The sign goes outside the currency symbol, because "$-1,893.44" is not how
 * anybody writes money, and a value that rounds to nothing prints as zero
 * rather than as minus zero — "-$0.00" on a bill reads as a defect, which it
 * would be.
 */
/**
 * A figure on a document, without a currency mark.
 *
 * It used to prefix a dollar sign, which was invisible while every document was
 * in dollars and produced "AED$757.28" the moment one was not. The mark belongs
 * to the bill — `BillFacts.currencyMark` — and is put in front by whoever is
 * drawing the line, because only they know whether there is room for it.
 */
export function money(n: number): string {
  const rounded = round2(n)
  const abs = Math.abs(rounded).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${rounded < 0 ? '-' : ''}${abs}`
}
