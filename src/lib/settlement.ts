/* What a seller is actually paid, and in what.
   No React and no Supabase, so the rules can be tested without a network.

   A settlement has two legs and they are not the same currency:

     computed in   the marketplace's reporting currency. Commission is a
                   percentage of a figure the marketplace books, and it books in
                   one currency so a take rate means something across three
                   markets.
     paid in       whatever the seller's bank account receives. Kestrel Devices
                   banks with HDFC in Bengaluru; it is paid in rupees however
                   the statement was computed.

   The conversion between them is dated and frozen. A statement reprinted next
   year has to come out the same as the one the seller was paid against, and
   recomputing at today's rate is the single most common way currency handling
   goes wrong. */

import { rateOn, roundMinor , round2} from './money'
import type { Rate, Currency } from './money'

export interface Payout {
  currency: string
  net: number
  /* 1 where nothing was converted, rather than null — every statement then
     reads the same way instead of half of them being a case to notice. */
  rate: number
  asOf: string
}

export type PayoutResult =
  | { ok: true; payout: Payout }
  | { ok: false; reason: string }

/**
 * The last day of a period written as "Feb 2026".
 *
 * A settlement is converted at the fix in force when the period closed, not at
 * the fix in force when somebody opens the screen. Returns null on anything it
 * cannot read, because guessing a date here would silently pick a rate.
 */
export function periodEnd(period: string): string | null {
  const m = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(period.trim())
  if (!m) return null
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const i = months.indexOf(m[1].toLowerCase())
  if (i < 0) return null
  const year = Number(m[2])
  /* Day 0 of the next month is the last day of this one, and it handles
     February in a leap year without anybody writing down which years those are. */
  const d = new Date(Date.UTC(year, i + 1, 0))
  return d.toISOString().slice(0, 10)
}

/**
 * The payout leg of a statement.
 *
 * Refuses rather than guessing when there is no rate on file at or before the
 * period end — a settlement converted at a rate that did not exist yet is a
 * figure nobody can reconcile, and it is better to show the operator why than
 * to produce one.
 */
export function payoutFor(
  { net, from, to, period, rates, currencies = [] }: {
    net: number
    from: string
    to: string
    period: string
    rates: readonly Rate[]
    currencies?: readonly Currency[]
  },
): PayoutResult {
  const end = periodEnd(period)
  if (!end) {
    return { ok: false, reason: `"${period}" is not a period this can date. Write it as "Aug 2026".` }
  }
  if (from === to) {
    return { ok: true, payout: { currency: to, net: round2(net), rate: 1, asOf: end } }
  }
  const r = rateOn(rates, from, to, end)
  if (!r) {
    return {
      ok: false,
      reason: `There is no ${from}→${to} rate on file at or before ${end}, so this cannot be settled into that account yet.`,
    }
  }
  const minor = currencies.find(c => c.code === to)?.minor_units
  const converted = net * r.rate
  return {
    ok: true,
    payout: {
      currency: to,
      net: minor === undefined ? round2(converted) : roundMinor(converted, minor),
      rate: r.rate,
      asOf: r.as_of,
    },
  }
}

/**
 * Does a statement still reproduce its own conversion?
 *
 * The check that catches a rate edited without the amount, or an amount edited
 * without the rate — the two halves of the same drift, and neither is visible
 * on the screen because both look like ordinary numbers.
 */
export function payoutAgrees(
  statement: { net: number; payout_net: number; fx_rate: number },
  tolerance = 0.01,
): boolean {
  return Math.abs(Number(statement.payout_net) - round2(Number(statement.net) * Number(statement.fx_rate))) <= tolerance
}

/** Whether a statement's own arithmetic holds, before any currency is involved. */
export function statementAddsUp(
  s: { gross: number; commission: number; fees: number; withholding: number; refunds: number; net: number },
  tolerance = 0.01,
): boolean {
  const expected = Number(s.gross) - Number(s.commission) - Number(s.fees)
    - Number(s.withholding) - Number(s.refunds)
  return Math.abs(Number(s.net) - expected) <= tolerance
}


