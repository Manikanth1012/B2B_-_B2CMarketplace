/* The customer's own bill, as the document the operator configured.
 *
 * The Bills tab used to build a bill by hand: an eighteen-percent tax line, a
 * GSTIN, a registered address and an advertisement all typed into a download
 * function. None of it came from anywhere, so none of it could be changed, and
 * two of the figures disagreed with the record the marketplace actually bills
 * under.
 *
 * That is what `invoice_templates` exists to stop. A bill is the same document
 * on the customer's screen, in the customer's download and in the operator's
 * preview, because all three are the same sections rendered from the same
 * facts. Change the template and all three change together — which is the only
 * arrangement in which a template screen is telling the truth.
 */
import { supabase } from './supabase'
import type {
  Section, Template, TemplateSection, Assignment, Issuer, BillFacts,
} from './billTemplate'
import { sectionsOn, templateFor, blocksFor, money } from './billTemplate'
import type { ConsumerBill } from '../types'

export interface BillBook {
  sections: Section[]
  templates: Template[]
  chosen: TemplateSection[]
  assignments: Assignment[]
  issuer: Issuer | null
  /* Everything below is the customer's own, read under their own session. */
  profile: Record<string, string> | null
  address: Record<string, string> | null
  member: Record<string, string> | null
  ledger: Record<string, string>[]
  advert: { title: string; subtitle: string | null; cta: string; accent: string } | null
  loadError?: string
}

/**
 * Everything a bill needs beyond the bill itself.
 *
 * One round trip for the whole tab rather than one per bill: seven bills on
 * record would otherwise be seven identical reads of the same template.
 */
export async function loadBillBook(): Promise<BillBook> {
  const [secRes, tplRes, tsRes, asgRes, issRes, profRes, addrRes, memRes, ledRes, banRes] =
    await Promise.all([
      supabase.from('invoice_sections').select('*').order('sort_order'),
      supabase.from('invoice_templates').select('*').order('sort_order'),
      supabase.from('invoice_template_sections').select('*'),
      supabase.from('invoice_template_assignments').select('*'),
      supabase.from('invoice_issuer').select('*').eq('id', 'default').maybeSingle(),
      supabase.from('consumer_profile').select('*').eq('id', 'me').maybeSingle(),
      supabase.from('consumer_addresses').select('*').eq('is_default', true).maybeSingle(),
      supabase.from('loyalty_members').select('*').eq('kind', 'consumer'),
      supabase.from('loyalty_ledger').select('*'),
      /* `public_banners`, not `operator_banners`. The second is operator-only,
         so reading it from a customer's session returned nothing and the
         advert section vanished from their own bill without a word — while
         the operator's preview, run from an operator session, showed it. The
         view is the same live banners with the commercial columns dropped,
         which is all a bill needs. */
      supabase.from('public_banners').select('*').eq('audience', 'consumer').order('sort_order'),
    ])

  const profile = (profRes.data as Record<string, string> | null) ?? null
  const member = ((memRes.data ?? []) as Record<string, string>[]).find(m =>
    (profile?.user_id && m.user_id === profile.user_id) || m.name === profile?.name) ?? null
  const banner = ((banRes.data ?? []) as Record<string, string>[])[0]

  const failed = [secRes.error, tplRes.error, asgRes.error].find(Boolean)

  return {
    sections: (secRes.data ?? []) as Section[],
    templates: (tplRes.data ?? []) as Template[],
    chosen: (tsRes.data ?? []) as TemplateSection[],
    assignments: (asgRes.data ?? []) as Assignment[],
    issuer: (issRes.data as Issuer | null) ?? null,
    profile,
    address: (addrRes.data as Record<string, string> | null) ?? null,
    member,
    ledger: (ledRes.data ?? []) as Record<string, string>[],
    advert: banner
      ? { title: banner.title, subtitle: banner.subtitle ?? null, cta: banner.cta, accent: banner.accent || '#0D47A1' }
      : null,
    ...(failed ? { loadError: failed.message } : {}),
  }
}

/** The template this customer's bills are issued on. */
export function templateForBill(book: BillBook): Template | null {
  return templateFor({ audience: 'consumer' }, book.assignments, book.templates)
}

/** The sections that template carries, in document order. */
export function sectionIds(book: BillBook, template: Template | null): string[] {
  return template ? sectionsOn(template, book.sections, book.chosen).map(s => s.id) : []
}

/* `loyalty_ledger.when_date` is "14 Jul 2026" and `consumer_bills.period` is
   "July 2026". Neither is a date, so they are compared as month and year. */
function sameMonth(when: string, period: string): boolean {
  const w = new Date(when)
  const p = new Date(`01 ${period}`)
  if (isNaN(w.getTime()) || isNaN(p.getTime())) return false
  return w.getMonth() === p.getMonth() && w.getFullYear() === p.getFullYear()
}

/**
 * What this bill actually says.
 *
 * Every figure is read off the bill row or the customer's own records. Nothing
 * here is a constant, which is the point: the tax rate is derived from the tax
 * charged rather than asserted to be eighteen percent, so a bill that was
 * raised at another rate does not print a lie about itself.
 */
export function factsFor(bill: ConsumerBill, book: BillBook): BillFacts {
  const template = templateForBill(book)
  const p = book.profile
  const a = book.address
  const m = book.member
  const iss = book.issuer

  const net = bill.total - bill.tax
  const paid = bill.status === 'paid' ? bill.total : 0

  /* Split by movement type, not by sign. A refund claws points back with a
     negative movement and a reversed redemption returns them with a positive
     one; taken at face value the bill would report a refund as a redemption. */
  const rows = m ? book.ledger.filter(l => l.member === m.id && sameMonth(l.when_date, bill.period)) : []
  const sum = (f: (l: Record<string, string>) => boolean) =>
    rows.filter(f).reduce((n, l) => n + Number(l.points), 0)
  const rewards = m ? {
    earned: sum(l => l.type === 'earn' || l.type === 'bonus')
      + sum(l => l.type === 'reverse' && Number(l.points) < 0),
    redeemed: -(sum(l => l.type === 'redeem') + sum(l => l.type === 'reverse' && Number(l.points) > 0)),
    balance: Number(m.balance ?? 0),
  } : null

  return {
    reference: bill.id,
    issued: bill.issued,
    due: bill.due,
    billedTo: {
      name: p?.name ?? 'Account holder',
      ref: p?.customer_id ?? null,
      lines: a ? [a.line1, `${a.city} ${a.pin}`] : [p?.city ?? ''].filter(Boolean),
      contact: [p?.email, p?.msisdn].filter(Boolean).join(' · '),
      /* A retail customer has no tax registration, and a blank line where one
         would go makes a bill look like a form. */
      tax: null,
    },
    billedFrom: {
      name: iss?.legal_name ?? 'Aventa Telecom',
      mark: iss?.trading_name || iss?.legal_name || 'Aventa Telecom',
      lines: iss?.lines ?? [],
      tax: iss ? `${iss.tax_label} ${iss.tax_id}` : null,
    },
    lines: [
      { label: 'Monthly plan charge', detail: bill.period, amount: bill.plan_charge },
      { label: 'Subscriptions and add-ons', detail: 'Billed in advance', amount: bill.subscriptions },
    ].filter(l => l.amount > 0),
    usage: bill.oneoff > 0
      ? [{ label: 'One-off charges and devices', detail: 'Billed in arrears', amount: bill.oneoff }]
      : [],
    credits: 0,
    paid,
    /* The rate the bill states, not one inferred from the amount. Inferring
       was what the old hard-coded download did in reverse — it asserted 18%
       over a bill charged at 9% — and neither number could be checked against
       the other because only one of them existed. */
    taxRate: bill.tax_rate ?? (net > 0 ? Math.round((bill.tax / net) * 1000) / 10 : 0),
    tax: bill.tax,
    total: bill.total,
    rewards,
    advert: book.advert,
    paid_already: bill.status === 'paid',
    support: iss && (iss.support_phone || iss.support_email)
      ? {
        phone: iss.support_phone, hours: iss.support_hours,
        email: iss.support_email, portal: iss.support_portal,
        window: iss.dispute_window,
      }
      : null,
    /* The template's remittance text, resolved here rather than in each
       renderer. `blocksFor` decides whether the block appears by looking at
       this field, so a renderer that fell back to the template when this was
       empty would print a block the document said it was suppressing — which
       is exactly what it did. */
    howToPay: template?.remittance ?? '',
    terms: iss?.terms ?? [],
    payRef: p?.customer_id ?? bill.id,
  }
}

/* ------------------------------------------------------------ the download -- */

/**
 * The same document, as a file.
 *
 * Driven by `blocksFor` exactly as the on-screen rendition is, so the two
 * cannot drift: a section switched off by the operator disappears from both,
 * and a block suppressed because this bill is already settled is absent from
 * both. Anything else and "View" and "Download" are two different documents
 * with one name.
 */
export function asText(
  facts: BillFacts, template: Template, ids: readonly string[], sections: readonly Section[],
): string {
  const showing = new Set(blocksFor(ids, facts))
  const order = sections.filter(s => showing.has(s.id)).map(s => s.id)
  const out: string[] = []
  const rule = '-'.repeat(52)
  const row = (label: string, amount: number) =>
    `${label.padEnd(38, '.')} ${money(amount).padStart(13)}`

  for (const id of order) {
    switch (id) {
      case 'masthead':
        out.push(facts.billedFrom.mark, template.doc_title, '='.repeat(52), '')
        break

      case 'parties':
        out.push(
          `Reference: ${facts.reference}`,
          `Issued: ${facts.issued}`,
          `Due: ${facts.due}`,
          `Currency: ${template.currency}`,
          `Status: ${facts.paid_already ? 'paid' : 'open'}`,
          '',
          'BILLED TO',
          facts.billedTo.name,
          ...(facts.billedTo.ref ? [`Account ${facts.billedTo.ref}`] : []),
          ...facts.billedTo.lines.filter(Boolean),
          ...(facts.billedTo.contact ? [facts.billedTo.contact] : []),
          '',
          'BILL FROM',
          facts.billedFrom.name,
          ...facts.billedFrom.lines,
          ...(facts.billedFrom.tax ? [facts.billedFrom.tax] : []),
          '')
        break

      case 'hero':
        out.push(rule, row(facts.paid_already ? 'Amount paid' : 'Amount due', facts.total),
          `by ${facts.due}`, rule, '')
        break

      case 'subs':
        if (!template.show_order_lines) { out.push(row('Charges for the period', facts.total - facts.tax)) ; break }
        for (const l of facts.lines) out.push(row(`${l.label} — ${l.detail}`, l.amount))
        break

      case 'usage':
        if (!template.show_order_lines) break
        for (const l of facts.usage) out.push(row(`${l.label} — ${l.detail}`, l.amount))
        break

      case 'credits':
        out.push(row('Credits and adjustments', facts.credits))
        break

      case 'rewards':
        if (!facts.rewards) break
        out.push('', 'REWARD POINTS',
          `Earned this period: ${facts.rewards.earned.toLocaleString()}`,
          `Redeemed this period: ${facts.rewards.redeemed.toLocaleString()}`,
          `Balance carried forward: ${facts.rewards.balance.toLocaleString()}`, '')
        break

      case 'tax':
        out.push(row(`${template.tax_label}${facts.taxRate ? ` at ${facts.taxRate}%` : ''}`, facts.tax))
        break

      case 'summary':
        out.push(rule, row('Net', facts.total - facts.tax), row('Total due', facts.total), rule, '')
        break

      case 'payments':
        out.push(row('Paid this period', -facts.paid))
        break

      case 'howtopay':
        out.push('HOW TO PAY', template.remittance,
          `Quote ${facts.payRef}.`, '')
        break

      case 'paylink':
        out.push('PAY ONLINE', `aventa.com/pay/${facts.reference}`, '')
        break

      case 'support':
        if (!facts.support) break
        out.push('QUESTIONS ABOUT THIS BILL',
          [facts.support.phone, facts.support.hours].filter(Boolean).join(' · '),
          [facts.support.email, facts.support.portal].filter(Boolean).join(' · '),
          `Queries must be raised within ${facts.support.window}.`, '')
        break

      case 'advert':
        if (!facts.advert) break
        out.push(facts.advert.title,
          ...(facts.advert.subtitle ? [facts.advert.subtitle] : []),
          `${facts.advert.cta} →`, '')
        break

      case 'terms':
        if (!facts.terms.length) break
        out.push('TERMS', ...facts.terms.map((t, i) => `${i + 1}. ${t}`), '')
        break

      case 'slip':
        out.push('- '.repeat(26), 'PAYMENT SLIP',
          `Reference ${facts.payRef}`, row('Amount', facts.total), '')
        break
    }
  }

  if (template.footer) out.push(rule, template.footer)
  return out.join('\n')
}

/** What the file is called. */
export function fileNameFor(bill: ConsumerBill): string {
  return `${bill.id}.txt`
}
