/**
 * The settlement cycle agreed with a partner, and what it says about dates.
 *
 * Every function here has a counterpart in the database — `settlement_window`,
 * `settlement_period`, `next_settlement_close`, `run_settlements`. That is
 * deliberate and it is not duplication for its own sake: the run has to happen
 * in one transaction with the statement it writes, so the arithmetic lives in
 * SQL; and a screen has to say "closes on the 31st, payable on the 30th" for a
 * cycle nobody has run yet, so the arithmetic also lives here.
 *
 * Two evaluations of one published rule. The integration suite checks they
 * agree on real contracts, which is the only thing that keeps them honest.
 *
 * Dates are ISO strings throughout and every computation is UTC. A settlement
 * period that shifts by a day because the operator is in Nairobi and the server
 * is not is a class of bug this build has spent several migrations removing.
 */

import { deductionsOn, totalOf, type Rule, type Deduction } from './withholding'

export type Frequency = 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'
export type Align = 'calendar' | 'anniversary'

export interface Terms {
  partner_id: string
  frequency: Frequency
  align: Align
  starts_on: string
  /* 0 means the last day, whatever length the month is. */
  closes_on_day: number
  pay_within_days: number
  hold_days: number
  hold_reason: string | null
  minimum_payout: number
  payout_currency: string
  agreed_on: string
  agreed_by: string | null
  contract_ref: string | null
  note?: string | null
}

export interface Window {
  start: string
  end: string
  closes: string
}

export const MONTHS: Record<Frequency, number> = {
  monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12,
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly',
  'half-yearly': 'Half-yearly', yearly: 'Yearly',
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const utc = (s: string) => new Date(`${s}T00:00:00Z`)
const addMonths = (d: Date, n: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()))
const addDays = (d: Date, n: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
/* Day 0 of the next month is the last day of this one, and it handles February
   in a leap year without anybody writing down which years those are. */
const monthEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))

/**
 * The period a date falls in.
 *
 * Null before the contract starts. The contract's start truncates its first
 * period rather than excluding it — a quarterly contract signed in February has
 * a two-month first quarter, and saying so beats settling January trade nobody
 * agreed terms for.
 */
export function windowFor(terms: Terms, on: string): Window | null {
  const months = MONTHS[terms.frequency]
  const starts = utc(terms.starts_on)
  /* Where the boundaries fall. Calendar snaps to the natural boundary of the
     frequency; anniversary counts from the contract's own start month. */
  const anchor = terms.align === 'calendar' ? 0 : (starts.getUTCMonth()) % months

  const d = utc(on)
  let start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  while (start.getUTCMonth() % months !== anchor) {
    start = addMonths(start, -1)
  }
  const end = addDays(addMonths(start, months), -1)
  if (end < starts) return null

  const closes = terms.closes_on_day === 0
    ? end
    : new Date(Math.min(
        end.getTime(),
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), terms.closes_on_day),
      ))

  return {
    start: iso(start < starts ? starts : start),
    end: iso(end),
    closes: iso(closes),
  }
}

/**
 * The period that closed most recently on or before a date — the question a run
 * asks. Null where the contract has not started, or where its first period has
 * not closed: a partner who signed last week is not owed a settlement.
 */
export function lastClosed(terms: Terms, on: string): Window | null {
  if (on < terms.starts_on) return null
  const w = windowFor(terms, on)
  if (!w) return null
  if (w.closes <= on) return w
  return windowFor(terms, iso(addDays(utc(w.start), -1)))
}

/** When the next run picks this partner up. */
export function nextClose(terms: Terms, on: string): string | null {
  const from = on > terms.starts_on ? on : terms.starts_on
  const w = windowFor(terms, from)
  if (!w) return null
  if (w.closes > on) return w.closes
  return windowFor(terms, iso(addDays(utc(w.end), 1)))?.closes ?? null
}

/** When the money is due, given when the period closed. */
export function dueOn(terms: Terms, closes: string): string {
  return iso(addDays(utc(closes), terms.pay_within_days))
}

/**
 * How a period is named on a statement.
 *
 * "Q2 2026" is what a quarterly seller calls it. "Apr 2026" is what a system
 * that could only do months produced, and it is the wrong name for a quarter
 * whether or not the arithmetic behind it is right.
 */
export function periodLabel(frequency: Frequency, start: string): string {
  const d = utc(start)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (frequency) {
    case 'quarterly': return `Q${Math.floor(m / 3) + 1} ${y}`
    case 'half-yearly': return `H${m < 6 ? 1 : 2} ${y}`
    case 'yearly': return String(y)
    default:
      return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]} ${y}`
  }
}

/* ------------------------------------------------------------ the money ---- */

export interface Sale {
  net: number
  occurred_on: string
}

/**
 * What is earned in the period but not yet payable.
 *
 * A device sold on the 29th of a month closing on the 31st is still inside its
 * returns window. Settling it means paying the money and clawing it back, so it
 * is held and carried into the next period instead.
 *
 * The window is counted back from the CLOSE, not from today — which is what
 * makes a figure shown mid-period a projection of what will be held rather than
 * a statement about now. Callers label it accordingly.
 */
export function heldBack(sales: readonly Sale[], terms: Terms, closes: string): number {
  if (terms.hold_days <= 0) return 0
  const cutoff = iso(addDays(utc(closes), -terms.hold_days))
  return round2(sales.filter(s => s.occurred_on > cutoff).reduce((n, s) => n + s.net, 0))
}

export interface Reserve {
  /* The rate on file, as a percentage. */
  rate: number
  /* What that rate comes to against this period's gross, before any ceiling. */
  due: number
  /* What the period could actually give, which is what is retained. */
  withheld: number
  /* Tranches that reached maturity and go back on this statement. */
  released: number
}

export interface Outcome {
  /* Everything the period earned, before anything is held or carried. */
  earned: number
  /* Taken by the payer and handed to the revenue authority. It reduces what
     lands without reducing what was earned, which is why it sits beside
     `earned` rather than inside it. */
  withheld: number
  held: number
  carriedIn: number
  /* Retained against refunds that land after the returns window, and whatever
     matured and came back. Both sit beside `held` rather than inside it: a
     holdback carries to the next period, a reserve waits for a date. */
  reserveWithheld: number
  reserveReleased: number
  /* What actually goes out. */
  payable: number
  carriedOut: number
  /* Set when the minimum stopped a payment that would otherwise have been
     made — the difference between "you earned nothing" and "you earned $4 and
     it costs more than that to send". */
  belowMinimum: boolean
  why: string | null
}

/**
 * What a seller's rolling reserve does on one settlement.
 *
 * A percentage of GROSS, not of the payout. The exposure a reserve covers is a
 * refund or a chargeback, and both are against the sale price — the buyer gets
 * back what they paid, not what the seller kept. Taking the percentage off the
 * margin would size the cover against the wrong number and under-hold exactly
 * the sellers whose commission is highest.
 *
 * Bounded by what the period can give, for the same reason a wholesale charge
 * is: you cannot hold money that is not there. A thin month holds what it has
 * and does not borrow from the next one.
 *
 * `reserve_on` in the database is the same function. The integration suite
 * checks they agree on every seller on file.
 */
export function reserveOn(
  { gross, room, rate, matured }: {
    gross: number; room: number; rate: number; matured: number
  },
): Reserve {
  const due = round2(Math.max(0, rate) / 100 * Math.max(0, gross))
  return {
    rate: Math.max(0, rate),
    due,
    withheld: Math.min(due, Math.max(round2(room), 0)),
    released: round2(Math.max(0, matured)),
  }
}

/**
 * What a period actually pays.
 *
 * The order matters, and it is the order `run_settlements_core` uses: deduct
 * tax at source, then hold, then add what the last period could not pay, then
 * test the minimum against the total.
 *
 * Withholding comes off before anything is held because it has already gone to
 * the revenue authority. Holding money that is no longer in the marketplace's
 * hands would carry a figure it does not have, and the next period would pay
 * out against it.
 *
 * Testing the minimum before the carry-in would strand a partner forever —
 * three periods of $90 against a $250 minimum would each carry and never
 * combine.
 */
export function settle(
  { earned, withheld = 0, held, carriedIn, reserve, terms }: {
    earned: number; withheld?: number; held: number; carriedIn: number
    /* Omitted where the seller has no rate on file, which is most of them. */
    reserve?: Reserve
    terms: Terms
  },
): Outcome {
  const afterTax = round2(earned - withheld)
  const beforeReserve = round2(afterTax - held + carriedIn)

  /* Retained after tax and after the holdback, and returned in the same
     movement — then the minimum is tested, because the minimum is a question
     about what reaches the bank and testing it against a figure about to be
     reduced would pay out sums already decided against. */
  const rw = reserve?.withheld ?? 0
  const rr = reserve?.released ?? 0
  const base = round2(beforeReserve + rr - rw)

  const common = {
    earned: round2(earned), withheld: round2(withheld), held, carriedIn,
    reserveWithheld: round2(rw), reserveReleased: round2(rr),
  }

  if (base > 0 && base < terms.minimum_payout) {
    return {
      ...common,
      payable: 0,
      carriedOut: round2(held + base),
      belowMinimum: true,
      why: `Carried forward — ${base.toFixed(2)} is below the ${terms.minimum_payout.toFixed(2)} ${terms.payout_currency} minimum payout${terms.contract_ref ? ` agreed in ${terms.contract_ref}` : ''}.`,
    }
  }

  return {
    ...common,
    payable: base > 0 ? base : 0,
    carriedOut: held,
    belowMinimum: false,
    why: reasonFor({ held, reserve, terms }),
  }
}

/* Why the payable is not simply what was earned. Both reasons where both
   apply — naming only one of them leaves the seller short by the other and
   reading a statement that does not add up. */
function reasonFor(
  { held, reserve, terms }: { held: number; reserve?: Reserve; terms: Terms },
): string | null {
  const bits: string[] = []
  if (held > 0) {
    bits.push(`${held.toFixed(2)} held back — ${terms.hold_reason ?? `inside the ${terms.hold_days}-day hold`}`)
  }
  if ((reserve?.withheld ?? 0) > 0) {
    bits.push(`${reserve!.withheld.toFixed(2)} retained as the ${reserve!.rate}% rolling reserve`
      + (reserve!.withheld < reserve!.due
        ? `, which is all this period could cover of ${reserve!.due.toFixed(2)}`
        : ''))
  }
  if ((reserve?.released ?? 0) > 0) {
    bits.push(`${reserve!.released.toFixed(2)} of earlier reserve matured and is returned`)
  }
  return bits.length ? `${bits.join('; ')}.` : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/* ------------------------------------------------ the period still running -- */

/** What the accruing view gives a screen mid-period. */
export interface Accruing {
  gross: number
  commission: number
  fees: number
  refunds: number
  /* The sum of the line nets, BEFORE tax at source. Not the same thing as
     `settlement_statements.net`, which the run writes after the deduction —
     passing a settled statement in here would take the tax off twice. */
  net: number
  held_back: number
  carried_in: number
  /* The paying entity's market, and where the payee is tax resident. The two
     are compared, and that comparison is the whole of the withholding model —
     a treaty only ever reduces a rate that crosses a border. */
  market: string
  tax_residence: string
  treaty_on_file: boolean
  closed_on: string
  /* The rolling reserve: the rate on file, what has already matured and comes
     back on the next statement, and the running total held. Optional because a
     row read before the reserve was real does not carry them. */
  reserve_pct?: number
  reserve_matured?: number
  reserve_held?: number
}

/**
 * What a seller would actually be paid if this period closed today.
 *
 * The card that shows this used to compute `net - held_back` and call it
 * payable. That is not what a run produces, and the gap is not small: tax at
 * source takes 1.1% of gross off an Indian seller before anything is held, and
 * a carry-in from a period that fell under the minimum can be the whole reason
 * this one clears it.
 *
 * The rates are read on the day the period CLOSES, not today. A rate that
 * changes next week is not the rate this period was earned under, and it is
 * the closing date the eventual statement will be computed on.
 *
 * The deductions come back listed rather than totalled because a seller
 * reconciles them against separate returns — one figure covering 194-O and
 * s.52 CGST is a figure they cannot split, and therefore cannot claim.
 */
export function projectPayout(
  { accruing, terms, rules }: {
    accruing: Accruing; terms: Terms; rules: readonly Rule[]
  },
): Outcome & { deductions: Deduction[]; reserve: Reserve } {
  const deductions = deductionsOn({
    rules,
    market: accruing.market,
    direction: 'partner-payout',
    payee: { residence: accruing.tax_residence, treaty_on_file: accruing.treaty_on_file },
    amounts: {
      gross: accruing.gross,
      commission: accruing.commission,
      /* Not `accruing.net`. The 'net' basis in the rules means the supply after
         everything the marketplace charged, which is what the run computes
         inline; keeping the two in step matters more than the shorter
         expression. */
      net: round2(accruing.gross - accruing.commission - accruing.fees - accruing.refunds),
    },
    on: accruing.closed_on,
  })

  /* The reserve is measured against what the period would otherwise pay, so it
     is computed on that figure rather than on `net` — the same order the run
     applies it in. */
  const room = round2(accruing.net - totalOf(deductions) - accruing.held_back + accruing.carried_in)
  const reserve = reserveOn({
    gross: accruing.gross,
    room,
    rate: accruing.reserve_pct ?? 0,
    matured: accruing.reserve_matured ?? 0,
  })

  return {
    ...settle({
      earned: accruing.net,
      withheld: totalOf(deductions),
      held: accruing.held_back,
      carriedIn: accruing.carried_in,
      reserve,
      terms,
    }),
    deductions,
    reserve,
  }
}

/* ------------------------------------------------------------- in words ---- */

/** The cycle, as a sentence a partner desk can read out. */
export function cycleLine(terms: Terms): string {
  const when = terms.closes_on_day === 0
    ? 'on the last day of the period'
    : `on the ${ordinal(terms.closes_on_day)} of the closing month`
  const align = terms.frequency === 'monthly'
    ? ''
    : terms.align === 'anniversary'
      ? ', counted from the month the contract started'
      : ', on the calendar boundary'
  return `${FREQUENCY_LABEL[terms.frequency]}${align}, closing ${when}, payable within ${terms.pay_within_days} days.`
}

/** What is held back and why, or null where nothing is. */
export function holdLine(terms: Terms): string | null {
  if (terms.hold_days <= 0) return null
  return `${terms.hold_days} days held back${terms.hold_reason ? ` — ${terms.hold_reason}` : ''}`
}

/** What a partner is told about the minimum, or null where there is none. */
export function minimumLine(terms: Terms): string | null {
  if (terms.minimum_payout <= 0) return null
  return `Below ${terms.minimum_payout.toFixed(2)} ${terms.payout_currency} the balance carries into the next period.`
}

/**
 * Terms nobody could act on or defend. Kept out of the validation that refuses
 * a save, because none of these makes the cycle unusable — they make it
 * indefensible, which is a thing to warn about rather than block.
 */
export function termsWarnings(terms: Terms): string[] {
  const out: string[] = []
  if (!terms.contract_ref) {
    out.push('No contract reference. A cycle nobody can point at a document for is one that gets changed by whoever asks loudest.')
  }
  if (!terms.agreed_by) {
    out.push('Nobody is recorded as having agreed it.')
  }
  /* A quarter is 90 days. Holding 90 of them back is holding the whole period. */
  const span = MONTHS[terms.frequency] * 30
  if (terms.hold_days > span / 2) {
    out.push(`A ${terms.hold_days}-day hold on a ${FREQUENCY_LABEL[terms.frequency].toLowerCase()} cycle holds back most of the period. The seller is trading on money they will not see for two cycles.`)
  }
  if (terms.frequency === 'yearly' && terms.pay_within_days > 60) {
    out.push('Yearly, and then another two months to pay. That is fourteen months from the first sale to the money.')
  }
  return out
}

/** Why these terms cannot be saved, or null when they can. */
export function termsProblem(terms: Partial<Terms>): string | null {
  if (!terms.frequency) return 'Choose how often this partner is settled.'
  if (!terms.payout_currency) return 'A payout needs a currency to be paid in.'
  if (!terms.starts_on) return 'Say which date the cycle counts from.'
  if (terms.closes_on_day != null && (terms.closes_on_day < 0 || terms.closes_on_day > 28)) {
    return 'A closing day is between the 1st and the 28th, or 0 for the last day of the period. Past the 28th and it would not exist in February.'
  }
  if (terms.pay_within_days != null && terms.pay_within_days < 0) {
    return 'Payment terms cannot be negative — that would make the money due before the period closed.'
  }
  /* The database says this too. It is here so the operator is told while they
     are typing rather than when they press save. */
  if ((terms.hold_days ?? 0) > 0 && !terms.hold_reason?.trim()) {
    return 'A hold has to say what it is for. "14 days" on its own is money a partner cannot account for.'
  }
  if ((terms.minimum_payout ?? 0) < 0) return 'A minimum payout cannot be negative.'
  return null
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}
