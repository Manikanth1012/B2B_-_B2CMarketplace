// 20261113300000, checked without a database: a seller's renewal of a bundle
// part follows the 12-months-then-published rule, the seller's book shows that
// price, and accepting a stock flag says whether it changed anything.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = new URL('../../supabase/migrations/', import.meta.url)
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()

const code = strip(read('20261113300000_loose_ends_iii.sql'))
const before = {
  renewals: strip(read('20260810240000_a_renewal_run_for_subscriptions_the_marketplace_does_not_own.sql')),
  baskets: strip(read('20261113200000_a_basket_is_kept_and_watched.sql')),
}

/** The text of one `create or replace function` statement in `src`. */
function fn(src: string, name: string): string {
  const at = src.indexOf(`create or replace function public.${name}(`)
  expect(at, `${name} is not defined here`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(at)
  const open = rest.indexOf('$$')
  const close = rest.indexOf('$$', open + 2)
  return rest.slice(0, close + 2)
}
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('loose ends III, as a migration', () => {
  it('is one transaction that checks itself last', () => {
    expect(code.trim().startsWith('begin;')).toBe(true)
    expect(code.trim().endsWith('commit;')).toBe(true)
    expect(code.match(/^begin;$/gm)?.length).toBe(1)
    expect(code.match(/^commit;$/gm)?.length).toBe(1)
    const last = code.slice(code.lastIndexOf('do $$'))
    expect(last).toContain('subscription_renewal_price(v_sub, current_date + 30)')
    /* The self-check only reads: nothing to roll back. */
    expect(last).not.toMatch(/\b(insert|update|delete)\s/)
  })

  it('charges a seller-reported cycle at the renewal price unless the seller names one, and moves the price with it', () => {
    const body = fn(code, 'report_renewal')
    expect(body).toContain('amount := round(coalesce(p_amount, public.subscription_renewal_price(s, p_period_start)), 2);')
    expect(squash(body)).toContain('price = case when p_amount is null then amount else price end')
  })

  it('changes nothing else in report_renewal', () => {
    const was = squash(fn(before.renewals, 'report_renewal'))
      .replace('amount := round(coalesce(p_amount, s.price), 2);', 'AMOUNT')
      .replace('set next_renewal = (p_period_start + make_interval(months => months))::date where', 'SET where')
    const now = squash(fn(code, 'report_renewal'))
      .replace('amount := round(coalesce(p_amount, public.subscription_renewal_price(s, p_period_start)), 2);', 'AMOUNT')
      .replace('set next_renewal = (p_period_start + make_interval(months => months))::date, price = case when p_amount is null then amount else price end where', 'SET where')
    expect(now).toBe(was)
  })

  it("shows the seller the price the due cycle is charged at, and nothing else changes in the book", () => {
    const now = squash(fn(code, 'vendor_renewal_book'))
    expect(now).toContain('public.subscription_renewal_price(s, s.next_renewal), s.currency')
    const was = squash(fn(before.renewals, 'vendor_renewal_book'))
    expect(now.replace('public.subscription_renewal_price(s, s.next_renewal)', 's.price')).toBe(was)
  })

  it('says whether accepting a flag changed anything, and changes nothing else', () => {
    const now = squash(fn(code, 'accept_basket_flag'))
    expect(now).toContain("'changed', false, 'note', 'this line had no stock note to accept.'")
    expect(now).toContain("'accepted', true, 'changed', true); end $$")
    const was = squash(fn(before.baskets, 'accept_basket_flag'))
    expect(now
      .replace(", 'changed', false, 'note', 'this line had no stock note to accept.'", '')
      .replace(", 'changed', true", '')).toBe(was)
  })

  it('keeps who may call each function', () => {
    expect(code).toContain('grant execute on function public.report_renewal(text, date, text, numeric) to authenticated;')
    expect(code).toContain('grant execute on function public.vendor_renewal_book(text, date) to authenticated;')
    expect(code).toContain('revoke all on function public.accept_basket_flag(text, text) from public, anon;')
    expect(code).toContain('grant execute on function public.accept_basket_flag(text, text) to authenticated;')
  })
})
