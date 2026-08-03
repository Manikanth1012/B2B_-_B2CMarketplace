/* Operator dashboard arithmetic, pure. */

import type { Category } from '../types'

export interface MonthRow {
  /* The reporting currency the aggregate is expressed in. Optional on the type
     because the pure module does the arithmetic and never the formatting — the
     screen that prints these reads it and says which currency it is in. */
  currency?: string
  id: string
  month: string
  month_start: string
  gross: number
  commission: number
  orders: number
  /* Carried forward as a monthly total rather than computed from orders still held
     at line level. The panel says which is which; a chart that mixes them silently
     claims a precision it does not have. */
  aggregated: boolean
  sort_order: number
}

export interface VerticalRow {
  /* As `MonthRow`: a reporting figure, in the currency the table names. */
  currency?: string
  category_id: string
  orders: number
  gross: number
  commission: number
  sort_order: number
}

export interface MonthlyStats {
  months: number
  gross: number
  orders: number
  average: number
  best: MonthRow | null
  aggregated: number
  lineLevel: number
}

export function monthlyStats(rows: readonly MonthRow[]): MonthlyStats {
  const months = rows.length
  const gross = rows.reduce((s, m) => s + Number(m.gross), 0)
  const orders = rows.reduce((s, m) => s + m.orders, 0)
  const best = rows.length === 0
    ? null
    : rows.reduce((a, b) => (Number(b.gross) > Number(a.gross) ? b : a))

  return {
    months,
    gross,
    orders,
    average: months === 0 ? 0 : gross / months,
    best,
    aggregated: rows.filter(m => m.aggregated).length,
    lineLevel: rows.filter(m => !m.aggregated).length,
  }
}

/**
 * The 90-day figures the headline cards show are the line-level months. Stated as a
 * function so the claim on the panel — "the last three months sum exactly to the
 * 90-day figure" — is checkable rather than decorative.
 */
export function lineLevelTotals(rows: readonly MonthRow[]): { gross: number; commission: number; orders: number } {
  const live = rows.filter(m => !m.aggregated)
  return {
    gross: live.reduce((s, m) => s + Number(m.gross), 0),
    commission: live.reduce((s, m) => s + Number(m.commission), 0),
    orders: live.reduce((s, m) => s + m.orders, 0),
  }
}

export interface Column { label: string; value: number }

/** The three series the split feeds, in the categories' own order so a colour always
    belongs to the same marketplace across all three charts. */
export function verticalSplit(
  rows: readonly VerticalRow[],
  categories: readonly Category[],
): { orders: Column[]; gross: Column[]; commission: Column[] } {
  const ordered = [...categories].sort((a, b) => a.sort_order - b.sort_order)
  const pick = (id: string) => rows.find(r => r.category_id === id)

  const label = (c: Category) => c.name.split(' ')[0]
  return {
    orders: ordered.filter(c => pick(c.id)).map(c => ({ label: label(c), value: pick(c.id)!.orders })),
    gross: ordered.filter(c => pick(c.id)).map(c => ({ label: label(c), value: Number(pick(c.id)!.gross) })),
    commission: ordered.filter(c => pick(c.id)).map(c => ({ label: label(c), value: Number(pick(c.id)!.commission) })),
  }
}

/**
 * Why both charts are on screen. Consumer and digital content carry the order count;
 * IoT, security and devices carry the value. Computed rather than written down, so it
 * cannot drift away from the data it describes — and it says nothing at all if the
 * data stops supporting it.
 */
export function inversionInsight(
  rows: readonly VerticalRow[],
  categories: readonly Category[],
): string {
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0)
  const totalGross = rows.reduce((s, r) => s + Number(r.gross), 0)
  if (totalOrders === 0 || totalGross === 0) return ''

  const volume = ['consumer', 'content']
  const value = ['iot', 'security', 'device']
  const sum = (ids: string[], key: 'orders' | 'gross') =>
    rows.filter(r => ids.includes(r.category_id)).reduce((s, r) => s + Number(r[key]), 0)

  const volOrders = Math.round((sum(volume, 'orders') / totalOrders) * 100)
  const volGross = Math.round((sum(volume, 'gross') / totalGross) * 100)
  const valOrders = Math.round((sum(value, 'orders') / totalOrders) * 100)
  const valGross = Math.round((sum(value, 'gross') / totalGross) * 100)

  /* If they no longer invert, do not assert that they do. */
  if (volOrders <= volGross) return ''

  const name = (id: string) => categories.find(c => c.id === id)?.name ?? id
  return `The two charts invert. ${name('consumer')} and ${name('content')} generate ${volOrders}% of orders ` +
    `but ${volGross}% of gross value; ${name('iot')}, ${name('security')} and ${name('device')} are the reverse ` +
    `at ${valOrders}% of orders and ${valGross}% of value. That shapes everything downstream — support load ` +
    `follows order count, settlement risk follows gross value.`
}
