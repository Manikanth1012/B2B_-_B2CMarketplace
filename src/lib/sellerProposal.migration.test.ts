// 20261112200000, checked without a database. Nobody here can apply it, so
// these are the structural facts the screens and the repo rely on: the three
// columns, the one rpc that writes them, the guard that refuses any other
// write, the seller's read, the desk's notification, and the house rules for a
// migration (one transaction, re-runnable, a self-check at the end).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261112200000_a_seller_prices_its_part_of_a_desk_quote.sql', import.meta.url),
  'utf8',
)
const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()
const fn = (name: string) => {
  /* From the name to the end of its body: the opening `as $$`, then the next `$$;`. */
  const m = code.match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`))
  expect(m, name).not.toBeNull()
  return m![0]
}

describe("the seller's price on a desk quote, as a migration", () => {
  it('is one transaction with a self-check before the commit', () => {
    expect(code.trim().startsWith('begin;')).toBe(true)
    expect(code.trim().endsWith('commit;')).toBe(true)
    const last = code.lastIndexOf('do $$')
    expect(last).toBeGreaterThan(code.indexOf('create trigger enquiry_lines_guard'))
    expect(code.slice(last)).toContain('raise exception')
  })

  it.each([
    ['seller_unit_price', 'numeric\\(12,2\\)'],
    ['seller_note', 'text'],
    ['seller_priced_at', 'timestamptz'],
  ])('adds %s idempotently', (col, type) => {
    expect(code).toMatch(new RegExp(`alter table enquiry_lines add column if not exists ${col} ${type};`))
  })

  it('names its constraints so none collides with an auto-named <table>_<col>_check, and drops each first', () => {
    const named = [...code.matchAll(/add constraint (\w+)/g)].map(m => m[1])
    expect(named.length).toBe(3)
    for (const c of named) {
      expect(c).not.toMatch(/_check$/)
      expect(code).toContain(`drop constraint if exists ${c};`)
    }
  })

  it('keeps its token where no API role can reach it', () => {
    expect(code).toContain('create table if not exists enquiry_seller_price_tokens')
    expect(code).toMatch(/alter table enquiry_seller_price_tokens enable row level security/)
    expect(code).toMatch(/revoke all on enquiry_seller_price_tokens from public, anon, authenticated/)
  })

  it('defines propose_line_price as security definer with a search path, for signed-in callers only', () => {
    const f = fn('propose_line_price')
    expect(f).toContain('security definer')
    expect(f).toContain('set search_path = public')
    expect(code).toMatch(/revoke all on function propose_line_price\(text, numeric, text\) from public, anon;/)
    expect(code).toMatch(/grant execute on function propose_line_price\(text, numeric, text\) to authenticated;/)
  })

  it('asks who is calling on the server: a seller, of that very line, on a desk quote the desk has not answered', () => {
    const f = fn('propose_line_price')
    expect(f).toContain("current_persona() is distinct from 'partner'")
    expect(f).toContain('v_line.partner_id is distinct from v_me')
    expect(f).toContain("v_e.type is distinct from 'quote' or v_e.partner_id is not null")
    expect(f).toContain("v_e.status is distinct from 'submitted'")
  })

  it('refuses a price at or under nought, over the column, or under the floor, in sentences', () => {
    const f = fn('propose_line_price')
    expect(f).toContain('if v_price <= 0 then')
    expect(f).toContain('99999999.99')
    expect(f).toContain('enquiry_seller_floor(v_line.product_id, v_e.currency)')
    for (const m of f.matchAll(/raise exception '([^']*(?:''[^']*)*)'/g)) {
      expect(m[1].trim(), m[1]).toMatch(/[.]$/)
    }
  })

  it("reads the floor from the price book in the quote's currency", () => {
    const f = fn('enquiry_seller_floor')
    expect(f).toContain('from product_prices pp')
    expect(f).toContain('pp.currency = p_currency')
    expect(code).toMatch(/revoke all on function enquiry_seller_floor\(text, text\) from public, anon, authenticated;/)
  })

  it('writes the columns only between putting its token down and taking it up', () => {
    const f = fn('propose_line_price')
    const put = f.indexOf('insert into enquiry_seller_price_tokens')
    const write = f.indexOf('update enquiry_lines')
    const take = f.indexOf('delete from enquiry_seller_price_tokens')
    expect(put).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(put)
    expect(take).toBeGreaterThan(write)
  })

  it('tells the desk through the existing notification path', () => {
    expect(fn('propose_line_price')).toContain("perform enquiry_send('enquiry.seller_priced', 'operator'")
    expect(code).toContain("('enquiry.seller_priced'")
    expect(code).toContain("('nr-o-enq-seller-priced', 'operator', 'enquiry.seller_priced'")
    expect(code).toContain("where r.id = 'nr-o-enq-seller-priced'")
  })

  it('replaces the line guard so a direct write of the proposal is refused, the service role exempt', () => {
    const g = fn('guard_enquiry_line')
    expect(g).toContain('if v_persona is null then return new; end if;')
    expect(g).toContain('from enquiry_seller_price_tokens where txid = txid_current()')
    expect(g).toContain('never written on its own')
    /* A line is never raised with a proposal on it. */
    expect(g).toContain('new.seller_unit_price is not null or new.seller_note is not null or new.seller_priced_at is not null')
    /* And send_quote's own rule is still there. */
    expect(g).toContain('from enquiry_rpc_tokens where txid = txid_current()')
    expect(code).toContain('drop trigger if exists enquiry_lines_guard on enquiry_lines;')
    expect(code).toContain('create trigger enquiry_lines_guard before insert or update on enquiry_lines')
  })

  it("gives the seller its own desk-quote lines and nobody else's", () => {
    const f = fn('my_desk_quote_lines')
    expect(f).toContain('security definer')
    expect(f).toContain('set search_path = public')
    expect(f).toContain('l.partner_id = current_partner_id()')
    expect(f).toContain("e.type = 'quote' and e.partner_id is null")
    expect(f).not.toContain('quoted_unit_price')
    expect(code).toMatch(/grant execute on function my_desk_quote_lines\(\) to authenticated;/)
  })

  it('puts no bare CASE inside an IF condition and drops no table', () => {
    expect(code).not.toMatch(/\bif\s+case\b/)
    expect(code).not.toMatch(/\belsif\s+case\b/)
    expect(code).not.toMatch(/drop table/)
  })
})
