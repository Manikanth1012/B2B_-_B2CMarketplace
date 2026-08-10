/**
 * Who we are exposed to, and what we hold against it.
 *
 * Two risks running in opposite directions, which is why one instrument never
 * covered them.
 *
 * A BUSINESS ACCOUNT OWES US. They buy on terms, so between the order and the
 * payment the marketplace has lent them the goods. The instrument is a limit.
 *
 * A SELLER IS OWED BY US. Nobody extends credit to a seller — the exposure is
 * that their refunds, chargebacks and debit notes exceed their sales in a period
 * and the marketplace is out of pocket. The instrument is security: a deposit
 * and a rolling reserve.
 *
 * Retail is neither. A shopper pays at checkout, so there is nothing to assess
 * and nothing to hold; that is recorded as a boundary in `channel_rule`, not
 * left as a gap.
 *
 * Three ideas run through this.
 *
 * EXPOSURE IS OWED PLUS COMMITTED. An approved requisition that has not reached
 * an invoice is money at risk. A limit checked against invoices alone is checked
 * after the decision that mattered.
 *
 * OVER THE LIMIT IS A STATE, NOT AN ERROR. It happens to real accounts and the
 * control working is what it looks like. What must never happen is it being
 * quiet — so every function that reports a position reports that one first.
 *
 * AND A LIMIT IS NEVER COMPARED ACROSS CURRENCIES. Each account's limit is in
 * its own money. "Total exposure" across a book trading in four currencies is a
 * quantity of nothing.
 */

import { byCurrency, money } from './money'
import type { Money } from './money'

export type CreditSide = 'buyer' | 'seller'
export type CreditBand = 'low' | 'medium' | 'high' | 'refused'

export interface Assessment {
  id: string
  account_id: string | null
  partner_id: string | null
  side: CreditSide
  reviewed_on: string
  reviewed_by: string
  evidence: string
  band: CreditBand
  rationale: string
  currency: string
  limit_granted: number | null
  deposit_required: number | null
  reserve_pct: number | null
  next_review: string
  superseded_by: string | null
}

/** A buyer's position, as the database view reports it. */
export interface Position {
  account_id: string
  company: string
  currency: string
  credit_limit: number
  deposit_held: number
  owed: number
  committed: number
  exposure: number
  headroom: number
  over_limit: boolean
  band: CreditBand | null
  next_review: string | null
}

export interface Security {
  partner_id: string
  deposit_held: number
  deposit_kind: string
  deposit_ref: string | null
  deposit_taken_on: string | null
  reserve_pct: number
  reserve_held: number
  currency: string
  why: string
  reviewed_on: string | null
}

/* ---------------------------------------------------------------- the words -- */

export const BAND_LABEL: Record<CreditBand, string> = {
  low: 'Low risk',
  medium: 'Watch',
  high: 'High risk',
  refused: 'Refused',
}

export const BAND_TONE: Record<CreditBand, string> = {
  low: 'healthy',
  medium: 'pending',
  high: 'degraded',
  refused: 'rejected',
}

/**
 * How long until the band is looked at again, in months.
 *
 * The same table as `credit_review_months` in the database, which is what
 * actually stamps the date. This exists so the screen can say when the next
 * review will be before the row comes back, and the integration test reconciles
 * the two — a cadence evaluated in two places is a cadence until somebody edits
 * one of them.
 */
export function reviewMonths(band: CreditBand): number {
  return band === 'refused' || band === 'high' ? 3 : band === 'medium' ? 6 : 12
}

/** What the band means for what happens next, rather than what it is called. */
export const BAND_MEANING: Record<CreditBand, string> = {
  low: 'Buys on terms without a hold. Reviewed annually.',
  medium: 'Buys on terms and is watched. A large order will be close to the limit. Reviewed every six months.',
  high: 'Held at the limit and reviewed quarterly. Security may be required.',
  refused: 'No credit. Everything is paid before it ships. Reviewed quarterly.',
}

/* ----------------------------------------------------------------- a buyer -- */

/**
 * How much of the limit is used, as a fraction.
 *
 * Can exceed 1. Capping it would hide the only case anybody needs to see, which
 * is the whole reason this is reported rather than a bar that stops at full.
 */
export function utilisation(p: Pick<Position, 'exposure' | 'credit_limit'>): number {
  if (p.credit_limit <= 0) return p.exposure > 0 ? Infinity : 0
  return Math.round((p.exposure / p.credit_limit) * 1000) / 1000
}

export function isOver(p: Pick<Position, 'exposure' | 'credit_limit'>): boolean {
  return p.exposure > p.credit_limit
}

/** How close to the edge, in words a credit controller would use. */
export type Pressure = 'clear' | 'near' | 'at' | 'over'

export function pressure(p: Pick<Position, 'exposure' | 'credit_limit'>): Pressure {
  const u = utilisation(p)
  if (u > 1) return 'over'
  if (u >= 1) return 'at'
  if (u >= 0.8) return 'near'
  return 'clear'
}

export const PRESSURE_TONE: Record<Pressure, string> = {
  clear: 'healthy', near: 'pending', at: 'degraded', over: 'rejected',
}

/**
 * Whether an order of this size would breach the limit.
 *
 * The same arithmetic as `guard_requisition_credit`, evaluated in the browser so
 * an approver is told before they approve rather than after. The database
 * decides — this exists so the screen can say what the database is about to do.
 */
export function wouldBreach(
  p: Pick<Position, 'exposure' | 'credit_limit' | 'currency'>, amount: number,
): { breach: false } | { breach: true; over: number } {
  if (p.credit_limit <= 0) return { breach: false }
  const after = p.exposure + amount
  if (after <= p.credit_limit) return { breach: false }
  return { breach: true, over: Math.round((after - p.credit_limit) * 100) / 100 }
}

/**
 * How a figure is written, passed in rather than chosen here.
 *
 * This module knows what to say and not how the reader writes money — that is
 * the market's business and there is one formatter for it. Defaulting to a
 * plain "1449746.18 INR" is what these sentences did on their first pass, next
 * to a column that said ₹14,49,746.18, on the same row.
 */
export type Fmt = (amount: number, currency: string) => string

const plain: Fmt = (n, c) => `${n.toFixed(2)} ${c}`

/** One sentence for a position, leading with the thing that matters. */
export function positionLine(p: Position, fmt: Fmt = plain): string {
  if (p.credit_limit <= 0) return `${p.company} buys on terms against no limit at all.`
  if (isOver(p)) {
    return `${p.company} is over its limit by ${fmt(Math.abs(p.headroom), p.currency)}. `
      + 'The next requisition is held.'
  }
  const u = utilisation(p)
  if (u >= 0.8) {
    return `${p.company} has ${fmt(p.headroom, p.currency)} left of `
      + `${fmt(p.credit_limit, p.currency)} — a large order would take it past the limit.`
  }
  return `${p.company} has ${fmt(p.headroom, p.currency)} left of ${fmt(p.credit_limit, p.currency)}.`
}

/* ---------------------------------------------------------------- a seller -- */

/** What a reserve rate takes out of a period's gross. */
export function reserveOn(gross: number, pct: number): number {
  return Math.round(gross * (pct / 100) * 100) / 100
}

/**
 * What we could actually lose on a seller, against what we hold.
 *
 * The exposure is what is owed to them minus what we are holding — because
 * money we owe them is money we can withhold. The gap is what a bad month would
 * cost us and is the figure the whole seller side exists to shrink.
 */
export function sellerCover(
  s: Pick<Security, 'deposit_held' | 'reserve_held' | 'currency'>, unpaid: number,
): { held: number; unpaid: number; uncovered: number; covered: boolean; currency: string } {
  const held = Math.round((s.deposit_held + s.reserve_held) * 100) / 100
  return {
    held, unpaid,
    /* Only the shortfall counts. Holding more than we owe is not extra safety —
       it is their money sitting with us for no reason. */
    uncovered: Math.max(0, Math.round((unpaid - held) * 100) / 100),
    covered: held >= unpaid,
    currency: s.currency,
  }
}

export function securityLine(s: Security, fmt: Fmt = plain): string {
  if (s.deposit_held === 0 && s.reserve_pct === 0) {
    return 'Nothing held. Nothing in their record justifies it.'
  }
  const bits: string[] = []
  if (s.deposit_held > 0) bits.push(`${fmt(s.deposit_held, s.currency)} on ${s.deposit_kind}`)
  if (s.reserve_pct > 0) {
    bits.push(s.reserve_held > 0
      ? `${s.reserve_pct}% rolling reserve, ${fmt(s.reserve_held, s.currency)} held`
      : `${s.reserve_pct}% rolling reserve, nothing accrued yet`)
  }
  return bits.join(' and ') + '.'
}

/* ------------------------------------------------------------- the reviews -- */

/** Days until the next review, negative once it is overdue. */
export function reviewIn(a: Pick<Assessment, 'next_review'>, today: string): number {
  const due = Date.parse(`${a.next_review}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  return Math.round((due - now) / 86400000)
}

export function reviewOverdue(a: Pick<Assessment, 'next_review'>, today: string): boolean {
  return reviewIn(a, today) < 0
}

/**
 * When this review is due, from its band and the day it was made.
 *
 * Month arithmetic rather than a day count, because "quarterly" means the same
 * date three months on and not 91 days later — a quarter that lands on the 5th
 * one time and the 3rd the next reads like a mistake to whoever is chasing it.
 *
 * The day is clamped to the end of the target month, which is what Postgres's
 * `make_interval` does and what `Date.setUTCMonth` does not: a review made on
 * 30 November is due on 28 February, and JavaScript on its own would roll that
 * to 2 March. Two evaluations of one rule disagreeing by two days is small
 * enough to survive every test that does not go looking for it, which is the
 * only reason it is worth this much comment.
 */
export function dueFrom(band: CreditBand, reviewedOn: string): string {
  const [y, m, d] = reviewedOn.split('-').map(Number)
  const months = (m - 1) + reviewMonths(band)
  const year = y + Math.floor(months / 12)
  const month = months % 12
  /* Day 0 of the next month is the last day of this one. */
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10)
}

/** Whether a review's date is the one its band asks for. */
export function onCadence(a: Pick<Assessment, 'band' | 'reviewed_on' | 'next_review'>): boolean {
  return a.next_review === dueFrom(a.band, a.reviewed_on)
}

/**
 * What to look at, worst first.
 *
 * Over the limit beats an overdue review beats everything else, because one is
 * money already out and the other is a decision nobody has revisited.
 */
export function reviewQueue(
  positions: readonly Position[], assessments: readonly Assessment[], today: string,
): Position[] {
  const live = new Map(assessments.filter(a => a.account_id && !a.superseded_by)
    .map(a => [a.account_id!, a]))
  const rank = (p: Position): number => {
    if (isOver(p)) return 0
    const a = live.get(p.account_id)
    if (a && reviewOverdue(a, today)) return 1
    if (pressure(p) === 'near' || pressure(p) === 'at') return 2
    return 3
  }
  return [...positions].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    return utilisation(b) - utilisation(a)
  })
}

/* -------------------------------------------------------------- the rollup -- */

export interface Book {
  /* Never one figure. Four currencies trade here. */
  exposed: { currency: string; total: Money; count: number }[]
  secured: { currency: string; total: Money; count: number }[]
  accounts: number
  over: number
  nearLimit: number
  unreviewed: number
  noLimit: number
}

export function creditBook(
  positions: readonly Position[], assessments: readonly Assessment[], today: string,
): Book {
  const live = assessments.filter(a => !a.superseded_by)
  return {
    exposed: byCurrency(positions.map(p => money(p.exposure, p.currency))),
    secured: byCurrency(positions.filter(p => p.deposit_held > 0)
      .map(p => money(p.deposit_held, p.currency))),
    accounts: positions.length,
    /* Only against a limit somebody set. An account with no limit is over one of
       zero by arithmetic, but it is a different and worse problem — it is
       counted in `noLimit`, and letting it appear in both makes the over-limit
       figure mean two things at once. */
    over: positions.filter(p => p.credit_limit > 0 && isOver(p)).length,
    nearLimit: positions.filter(p => pressure(p) === 'near' || pressure(p) === 'at').length,
    unreviewed: live.filter(a => reviewOverdue(a, today)).length,
    noLimit: positions.filter(p => p.credit_limit <= 0).length,
  }
}

/* --------------------------------------------------------------- the checks -- */

/**
 * Where the credit file disagrees with itself.
 *
 * The first two are the ones that produced this module: an account trading on
 * terms against no limit, and a limit nobody assessed. The third is the one my
 * own first pass failed — an account over its limit whose review calls it low
 * risk, which is how a red figure stays quiet.
 */
export function creditProblems(
  positions: readonly Position[], assessments: readonly Assessment[],
  security: readonly Security[], today: string, fmt: Fmt = plain,
): string[] {
  const out: string[] = []
  const byAccount = new Map(assessments.filter(a => a.account_id && !a.superseded_by)
    .map(a => [a.account_id!, a]))

  for (const p of positions) {
    if (p.credit_limit <= 0) {
      out.push(`${p.company} buys on terms against no limit at all.`)
      continue
    }
    const a = byAccount.get(p.account_id)
    if (!a) {
      out.push(`${p.company} has a limit of ${fmt(p.credit_limit, p.currency)} with no assessment behind it.`)
      continue
    }
    if (a.limit_granted !== null && Math.abs(a.limit_granted - p.credit_limit) > 0.01) {
      out.push(`${p.company} is held to ${fmt(p.credit_limit, p.currency)} and was granted `
        + `${fmt(a.limit_granted, a.currency)}.`)
    }
    if (a.currency !== p.currency) {
      out.push(`${p.company} was assessed in ${a.currency} and trades in ${p.currency}.`)
    }
    if (isOver(p) && (a.band === 'low' || a.band === 'medium')) {
      out.push(`${p.company} is over its limit and its review calls it ${BAND_LABEL[a.band].toLowerCase()}.`)
    }
    if (reviewOverdue(a, today)) {
      out.push(`${p.company} was due a review on ${a.next_review}.`)
    }
    /* A band that does not change when the next look happens is a label. This
       was true of every account until `20260808540000`. */
    if (!onCadence(a)) {
      out.push(`${p.company} is banded ${BAND_LABEL[a.band].toLowerCase()} and is next `
        + `reviewed on ${a.next_review}, not ${dueFrom(a.band, a.reviewed_on)}.`)
    }
  }

  for (const s of security) {
    if (s.deposit_held > 0 && s.deposit_kind === 'none') {
      out.push(`${s.partner_id} holds a deposit of ${fmt(s.deposit_held, s.currency)} recorded as no instrument.`)
    }
    if (s.reserve_held > 0 && s.reserve_pct === 0) {
      out.push(`${s.partner_id} has a reserve held against a rate of zero.`)
    }
    /* The other direction, which is the one that was true of seven sellers for
       as long as the reserve was a sentence nobody withheld. Checking only for
       money held with no policy behind it meant the check could never fire on
       the failure that had actually happened.

       Not immediately, though. A rate set last week has had no settlement to
       apply on, and calling that a disagreement would make the check cry wolf
       every time somebody sets a rate. Retention happens when a period closes,
       so the rate is given a cycle to take effect — past that, nothing held
       means nothing is applying it. */
    const daysOn = s.reviewed_on ? daysBetween(s.reviewed_on, today) : 0
    if (s.reserve_pct > 0 && s.reserve_held === 0 && daysOn > 35) {
      out.push(`${s.partner_id} is on a ${s.reserve_pct}% rolling reserve set on ${s.reviewed_on} `
        + 'and nothing has been retained under it since. A settlement has closed in that time, so the rate is not being applied.')
    }
  }

  return out
}

/* Whole days between two ISO dates, UTC. Written here rather than reached for
   because this module is otherwise free of date arithmetic and a Date built
   from a bare date string is UTC midnight either way. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}
