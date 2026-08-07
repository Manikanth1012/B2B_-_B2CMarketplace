/**
 * Tax deducted at source.
 *
 * Withholding is taken BY THE PAYER out of the payment and handed to the
 * revenue authority against the payee's own tax account. It reduces what the
 * seller receives without reducing what the seller earned — they claim it back
 * as a credit when they file, which is why the certificate matters as much as
 * the deduction.
 *
 * The whole of the logic is one question the free-text column it replaces got
 * wrong: is the payee in the same jurisdiction as the entity paying them. A
 * double-tax treaty governs payments that cross a border, so it can only ever
 * reduce a non-resident rate; on a payment from an Indian company to an Indian
 * company it does nothing at all. Every seller's record said "Nil under treaty".
 *
 * The counterpart in the database is `withholding_on`. Same rule, two
 * evaluations, reconciled by the integration suite — a run has to compute this
 * inside the transaction that writes the statement, and a screen has to be able
 * to say what will be deducted before any run happens.
 */

export type Direction = 'partner-payout' | 'enterprise-payment'
export type Basis = 'gross' | 'commission' | 'net'

export interface Rule {
  id: string
  market: string
  applies_to: Direction
  basis: Basis
  statute: string
  label: string
  resident_rate: number
  non_resident_rate: number
  /* What a treaty certificate reduces the NON-RESIDENT rate to. Null where no
     relief exists. It never touches the resident rate. */
  treaty_rate: number | null
  threshold_amount: number | null
  threshold_period: 'year' | 'payment' | null
  effective_from: string
  effective_to: string | null
  note: string | null
  sort_order: number
}

export interface Payee {
  /* Where the payee is tax resident. Compared against the paying entity's
     market — the same comparison the whole model turns on. */
  residence: string
  treaty_on_file: boolean
}

export interface Amounts {
  gross: number
  commission: number
  net: number
}

export interface Deduction {
  rule_id: string
  statute: string
  label: string
  basis: Basis
  rate: number
  amount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The rules in force in a market, in a direction, on a date. */
export function rulesFor(
  rules: readonly Rule[], market: string, direction: Direction, on: string,
): Rule[] {
  return rules
    .filter(r => r.market === market && r.applies_to === direction)
    .filter(r => r.effective_from <= on && (!r.effective_to || r.effective_to >= on))
    .sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * The rate that applies, which is decided by residence and only then adjusted
 * by a treaty.
 */
export function rateFor(rule: Rule, market: string, payee: Payee): number {
  if (payee.residence === market) return rule.resident_rate
  if (payee.treaty_on_file && rule.treaty_rate != null) return rule.treaty_rate
  return rule.non_resident_rate
}

/** What the percentage is of. Getting this wrong is a twenty-fold error on a
    ten-per-cent commission, not a rounding one. */
export function baseFor(rule: Rule, a: Amounts): number {
  return rule.basis === 'gross' ? a.gross
    : rule.basis === 'commission' ? a.commission
    : a.net
}

/**
 * Every deduction on one payment.
 *
 * India deducts under two statutes at once — 194-O on the gross sale and s.52
 * CGST on the net supply — so this returns a list rather than a figure. A
 * single total is a number a seller cannot split between the two returns it
 * lands in, and therefore cannot claim.
 */
export function deductionsOn(
  { rules, market, direction, payee, amounts, on }: {
    rules: readonly Rule[]
    market: string
    direction: Direction
    payee: Payee
    amounts: Amounts
    on: string
  },
): Deduction[] {
  return rulesFor(rules, market, direction, on).flatMap(rule => {
    const rate = rateFor(rule, market, payee)
    const amount = round2(baseFor(rule, amounts) * rate / 100)
    /* A nil rate is a real answer — the UAE imposes none — but it is not a line
       on a statement. It is stated on the rule, not on the payment. */
    if (amount <= 0) return []
    return [{
      rule_id: rule.id, statute: rule.statute, label: rule.label,
      basis: rule.basis, rate, amount,
    }]
  })
}

export function totalOf(deductions: readonly Deduction[]): number {
  return round2(deductions.reduce((n, d) => n + d.amount, 0))
}

/** The effective rate against gross, for a screen that wants one figure.
    Derived from the deductions so it cannot disagree with them. */
export function effectiveRate(deductions: readonly Deduction[], gross: number): number {
  if (gross <= 0) return 0
  return Math.round(totalOf(deductions) / gross * 100 * 1000) / 1000
}

/**
 * Why this payee is deducted from at this rate, in a sentence.
 *
 * The thing the free-text column was reaching for and could not express: the
 * position depends on where the payee is, and a treaty is only part of the
 * answer when the payment crosses a border.
 */
export function positionLine(rules: readonly Rule[], market: string, payee: Payee, on: string): string {
  const live = rulesFor(rules, market, 'partner-payout', on)
  if (live.length === 0) {
    return `No withholding position is configured for ${market}. Nothing is deducted, and nobody has decided that.`
  }
  const resident = payee.residence === market
  const charged = live.filter(r => rateFor(r, market, payee) > 0)

  if (charged.length === 0) {
    return resident
      ? `Nothing is deducted. ${live[0].statute} imposes a nil rate on domestic payments.`
      : `Nothing is deducted. ${live[0].statute} imposes a nil rate.`
  }

  const where = resident
    ? `Resident in ${market}, so the domestic rate applies and no treaty is engaged.`
    : payee.treaty_on_file && charged.some(r => r.treaty_rate != null)
      ? `Resident in ${payee.residence} rather than ${market}, with a treaty certificate on file — the non-resident rate is reduced but not removed.`
      : `Resident in ${payee.residence} rather than ${market}, and no treaty certificate is on file.`

  const under = charged
    .map(r => `${r.statute} at ${rateFor(r, market, payee)}% of ${r.basis}`)
    .join('; ')

  return `${where} Deducted under ${under}.`
}

/**
 * A payee record that cannot be relied on. Separate from the arithmetic
 * because none of these stops a deduction being computed — they make it
 * indefensible if the authority asks.
 */
export function payeeWarnings(
  payee: Payee & { tax_id?: string | null; treaty_expires?: string | null },
  market: string,
  on: string,
): string[] {
  const out: string[] = []
  if (!payee.tax_id) {
    out.push('No tax identifier on file. Most regimes deduct at a higher rate — often double — where the payee cannot be identified.')
  }
  if (payee.residence !== market && !payee.treaty_on_file) {
    out.push(`Paid from ${market} to a payee in ${payee.residence} with no treaty certificate. The full non-resident rate applies until one is provided.`)
  }
  if (payee.treaty_on_file && payee.treaty_expires && payee.treaty_expires < on) {
    out.push(`The treaty certificate expired on ${payee.treaty_expires}. Relief claimed against an expired certificate is relief the authority will reverse.`)
  }
  if (payee.treaty_on_file && payee.residence === market) {
    /* The exact error this whole module replaces. */
    out.push('A treaty certificate is on file for a domestic payee. A treaty governs payments that cross a border and does nothing here — the record is probably wrong.')
  }
  return out
}

/* --------------------------------------------------------- the certificate -- */

export type CertificateStatus = 'accruing' | 'filed' | 'issued'

export interface Certificate {
  id: string
  partner_id: string
  market: string
  rule_id: string
  /* Joined from the rule by `my_tax_deducted`, so the seller reads a statute
     and a basis rather than an internal id. Optional because a certificate row
     read straight from the table has neither. */
  statute?: string
  label?: string
  basis?: Basis
  form: string
  certificate_no: string | null
  period_start: string
  period_end: string
  amount: number
  currency: string
  status: CertificateStatus
  filed_on: string | null
  issued_on: string | null
}

export const CERTIFICATE_STATE: Record<CertificateStatus, string> = {
  accruing: 'Still accruing',
  filed: 'Filed with the authority',
  issued: 'Certificate issued',
}

/**
 * What to tell a seller about one certificate.
 *
 * The useful distinction is whether they can claim it yet. Accruing means the
 * quarter is still running; filed means the return has gone in and the number
 * is coming; issued means they can put it on their own return today.
 */
export function certificateLine(c: Certificate): string {
  switch (c.status) {
    case 'accruing':
      return `The quarter is still running. Your ${c.form} is issued after it closes on ${c.period_end}.`
    case 'filed':
      return `Filed with the authority${c.filed_on ? ` on ${c.filed_on}` : ''}. The ${c.form} follows once they process the return.`
    case 'issued':
      return `${c.form} ${c.certificate_no} — quote it on your own return to claim this back.`
  }
}

/** Certificates a seller can act on now, newest first. */
export function claimable(certs: readonly Certificate[]): Certificate[] {
  return certs
    .filter(c => c.status === 'issued')
    .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))
}

/** Everything deducted in a window, by statute. What a seller reconciles. */
export function byStatute(certs: readonly Certificate[]): { statute: string; amount: number; count: number }[] {
  const map = new Map<string, { statute: string; amount: number; count: number }>()
  for (const c of certs) {
    const key = c.statute ?? c.rule_id
    const at = map.get(key) ?? { statute: key, amount: 0, count: 0 }
    at.amount = round2(at.amount + c.amount)
    at.count += 1
    map.set(key, at)
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount)
}
