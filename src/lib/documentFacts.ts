/* Turning a row into a document.
 *
 * Three audiences, three source tables, one shape. The operator's template
 * preview already built these — privately, inside `billTemplateRepo`, for one
 * sample document each — and then the business console needed the same thing
 * for a real invoice and the seller console for a real statement.
 *
 * Rather than write the mapping a second and third time, it moves here as pure
 * functions over rows. Pure matters: the arithmetic on a document is the
 * arithmetic that has to reconcile, and reconciling is a thing worth testing
 * without a database.
 */
import type { BillFacts, Issuer, Template } from './billTemplate'
import { money } from './billTemplate'

export interface Party {
  name: string
  mark: string
  lines: string[]
  tax: string | null
}

/** The half of every document that is the same on every document. */
export function issuerParty(iss: Issuer | null): Party {
  return {
    name: iss?.legal_name ?? 'Aventa Telecom',
    mark: iss?.trading_name || iss?.legal_name || 'Aventa Telecom',
    lines: iss?.lines ?? [],
    tax: iss ? `${iss.tax_label} ${iss.tax_id}` : null,
  }
}

export function supportBlock(iss: Issuer | null): BillFacts['support'] {
  if (!iss || (!iss.support_phone && !iss.support_email)) return null
  return {
    phone: iss.support_phone, hours: iss.support_hours,
    email: iss.support_email, portal: iss.support_portal,
    window: iss.dispute_window,
  }
}

function day(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/* --------------------------------------------------------- the business -- */

export interface InvoiceRow {
  id: string
  account_id: string
  period: string
  issued: string | null
  due: string | null
  recurring: number
  oneoff: number
  tax_rate: number
  tax: number
  total: number
  status: string
  po_ref: string | null
}

export interface InvoiceLineRow {
  invoice_id: string
  kind: string
  description: string
  seller: string | null
  cost_centre: string | null
  requisition_id: string | null
  quantity: number
  unit_price: number
  amount: number
}

export interface AccountRow {
  id: string
  company: string
  legal_name: string | null
  registration: string | null
  place_of_supply: string | null
  terms: string | null
}

/**
 * A business invoice as a document.
 *
 * Subscriptions and one-offs are split, never overlapping: a line counted in
 * both blocks is an invoice whose summary does not reconcile, which is the one
 * thing an invoice may not be.
 */
export function invoiceFacts(
  invoice: InvoiceRow,
  lines: readonly InvoiceLineRow[],
  ctx: { issuer: Issuer | null; account: AccountRow | null; template: Template | null },
): BillFacts {
  const mine = lines.filter(l => l.invoice_id === invoice.id)
  const recurring = mine.filter(l => l.kind === 'subscription')
  const oneoff = mine.filter(l => l.kind !== 'subscription')
  const total = Number(invoice.total)
  const acc = ctx.account

  return {
    reference: invoice.id,
    issued: day(invoice.issued),
    due: day(invoice.due),
    billedTo: {
      name: acc?.legal_name ?? acc?.company ?? 'A business account',
      ref: invoice.po_ref || invoice.account_id,
      lines: [acc?.company ?? '', acc?.place_of_supply ?? ''].filter(Boolean),
      contact: acc?.terms ?? '',
      tax: acc?.registration ?? null,
    },
    billedFrom: issuerParty(ctx.issuer),
    lines: recurring.map(l => ({
      label: `${l.description}${l.seller ? ` · ${l.seller}` : ''}`,
      detail: `${l.quantity} × ${money(Number(l.unit_price))}${l.cost_centre ? ` · ${l.cost_centre}` : ''}`,
      amount: Number(l.amount),
    })),
    usage: oneoff.map(l => ({
      label: `${l.description}${l.seller ? ` · ${l.seller}` : ''}`,
      detail: l.requisition_id ?? l.kind,
      amount: Number(l.amount),
    })),
    credits: 0,
    paid: invoice.status === 'paid' ? total : 0,
    taxRate: Number(invoice.tax_rate ?? 0),
    tax: Number(invoice.tax),
    total,
    rewards: null,
    /* Never on a business document, whatever is live in the storefront. A
       procurement team did not ask to be sold to on a tax invoice. */
    advert: null,
    paid_already: invoice.status === 'paid',
    support: supportBlock(ctx.issuer),
    howToPay: ctx.template?.remittance ?? '',
    terms: ctx.issuer?.terms ?? [],
    payRef: invoice.po_ref || invoice.id,
  }
}

/* ----------------------------------------------------------- the seller -- */

export interface StatementRow {
  id: string
  partner_id: string | null
  partner_name: string
  period: string
  gross: number
  commission: number
  commission_rate: number | null
  fees: number
  withholding: number
  refunds: number
  net: number
  status: string
  order_count: number
}

/**
 * A self-billing invoice as a document.
 *
 * It reads as a deduction sheet because that is what it is: gross the seller
 * earned, less what the marketplace kept. Every figure lives in `usage` and
 * none in `subs` — a seller statement has no subscription side, the seeded
 * seller template does not carry that section, and a gross figure put there
 * would simply never print, leaving a page of pure deductions with a positive
 * total that does not add up.
 */
export function statementFacts(
  st: StatementRow,
  ctx: { issuer: Issuer | null; template: Template | null; reference?: string },
): BillFacts {
  const gross = Number(st.gross)
  const commission = Number(st.commission)
  const fees = Number(st.fees)
  const refunds = Number(st.refunds)
  const withholding = Number(st.withholding)
  const net = Number(st.net)

  return {
    reference: ctx.reference ?? st.id,
    issued: st.period,
    due: st.period,
    billedTo: {
      name: st.partner_name,
      ref: st.partner_id,
      lines: [`${st.order_count} orders in ${st.period}`],
      contact: '',
      tax: null,
    },
    billedFrom: issuerParty(ctx.issuer),
    lines: [],
    usage: [
      { label: 'Gross sales', detail: `${st.order_count} orders · ${st.period}`, amount: gross },
      { label: 'Marketplace commission', detail: st.commission_rate ? `${st.commission_rate}%` : '', amount: -commission },
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
    support: supportBlock(ctx.issuer),
    howToPay: ctx.template?.remittance ?? '',
    terms: ctx.issuer?.terms ?? [],
    payRef: st.id,
  }
}

/**
 * Whether a document adds up.
 *
 * Every rendition of every document goes through this shape, so the check
 * belongs with the shape rather than being repeated in three test files. A
 * summary that does not reconcile is the one thing a bill may not be.
 */
export function reconciles(f: BillFacts): boolean {
  const lines = [...f.lines, ...f.usage].reduce((n, l) => n + l.amount, 0)
  return Math.abs(lines + f.credits + f.tax - f.total) < 0.02
}
