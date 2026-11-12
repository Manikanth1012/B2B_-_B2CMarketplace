// 20261112200000, checked without a database. Nobody here can apply it, so
// these are the structural facts the screens and the repo rely on: the
// proposals live in their own table that the buyer cannot read, the one rpc
// that writes them, the guard that refuses any other write, the seller's read,
// the desk's notification, the seller's help, nothing of 20261105100000
// replaced, and the house rules for a migration.
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
    expect(last).toBeGreaterThan(code.indexOf('create trigger enquiry_line_proposals_guard'))
    expect(code.slice(last)).toContain('raise exception')
  })

  it('keeps the proposal off enquiry_lines, where the buyer reads every column', () => {
    expect(code).not.toMatch(/alter table enquiry_lines/)
    expect(code).not.toMatch(/add column if not exists seller_/)
    expect(code).toMatch(/create table if not exists enquiry_line_proposals \(/)
    expect(code).toContain('line_id     text primary key references enquiry_lines(id) on delete cascade')
    expect(code).toContain('unit_price  numeric(12,2) not null')
  })

  it('replaces nothing of 20261105100000', () => {
    for (const f of ['guard_enquiry_line', 'guard_enquiry', 'send_quote', 'enquiry_send', 'notify_enquiry', 'guard_quoted_line']) {
      expect(code, f).not.toContain(`create or replace function ${f}(`)
    }
    expect(code).not.toMatch(/drop policy if exists "[^"]+" on enquiry_lines/)
    expect(code).not.toMatch(/drop trigger if exists \w+ on enquiry_lines;/)
  })

  it('names its constraints so none collides with an auto-named <table>_<col>_check', () => {
    const named = [...code.matchAll(/constraint (\w+) check/g)].map(m => m[1])
    expect(named).toEqual(['enquiry_line_proposals_price_above_nought', 'enquiry_line_proposals_note_length'])
  })

  it('lets the desk and the seller read, the buyer nothing, and nobody write directly', () => {
    expect(code).toMatch(/alter table enquiry_line_proposals enable row level security/)
    expect(code).toMatch(/revoke all on enquiry_line_proposals from public, anon;/)
    expect(code).toMatch(/revoke insert, update, delete, truncate on enquiry_line_proposals from authenticated;/)
    const policies = [...code.matchAll(/create policy "([^"]+)" on enquiry_line_proposals for (\w+)[^;]*;/g)]
    expect(policies.map(p => [p[1], p[2]])).toEqual([
      ['operator_read_enquiry_line_proposals', 'select'],
      ['partner_read_enquiry_line_proposals', 'select'],
    ])
    for (const p of policies) {
      expect(code).toContain(`drop policy if exists "${p[1]}"`)
      expect(p[0]).not.toContain('enterprise')
    }
    expect(policies[1][0]).toContain('partner_id = current_partner_id()')
  })

  it('keeps its token where no API role can reach it', () => {
    expect(code).toContain('create table if not exists enquiry_seller_price_tokens')
    expect(code).toMatch(/alter table enquiry_seller_price_tokens enable row level security/)
    expect(code).toMatch(/revoke all on enquiry_seller_price_tokens from public, anon, authenticated/)
  })

  it('guards the table so a write that skipped the rpc is refused, the service role exempt', () => {
    const g = fn('guard_line_proposal')
    expect(g).toContain('if current_persona() is null then return new; end if;')
    expect(g).toContain('from enquiry_seller_price_tokens where txid = txid_current()')
    expect(g).toContain('never written on its own')
    expect(code).toContain('drop trigger if exists enquiry_line_proposals_guard on enquiry_line_proposals;')
    /* Not on delete: the cascade from a deleted enquiry has to get through. */
    expect(code).toContain('create trigger enquiry_line_proposals_guard before insert or update on enquiry_line_proposals')
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
    /* The type first, so a demo's line is not told to "send the quote yourself". */
    const type = f.indexOf("if v_e.type is distinct from 'quote' then")
    expect(type).toBeGreaterThan(0)
    expect(type).toBeLessThan(f.indexOf('is routed to you'))
    expect(f).toContain('if v_e.partner_id is not null then')
    expect(f).toContain("v_e.status is distinct from 'submitted'")
    expect(f).toContain('from enquiries where id = v_line.enquiry_id for update')
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

  it('writes the proposal only between putting its token down and taking it up', () => {
    const f = fn('propose_line_price')
    const put = f.indexOf('insert into enquiry_seller_price_tokens')
    const write = f.indexOf('insert into enquiry_line_proposals')
    const take = f.indexOf('delete from enquiry_seller_price_tokens')
    expect(put).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(put)
    expect(take).toBeGreaterThan(write)
    expect(f).toContain('on conflict (line_id) do update')
  })

  it('tells the desk through the existing notification path, and writes nothing the buyer reads', () => {
    const f = fn('propose_line_price')
    expect(f).toContain("perform enquiry_send('enquiry.seller_priced', 'operator'")
    expect(f).not.toContain('enquiry_events')
    expect(f).not.toContain('enquiry_messages')
    expect(code).toContain("('nr-o-enq-seller-priced', 'operator', 'enquiry.seller_priced'")
    expect(code).toContain("where r.id = 'nr-o-enq-seller-priced'")
  })

  it("gives the seller its own desk-quote lines and nobody else's", () => {
    const f = fn('my_desk_quote_lines')
    expect(f).toContain('security definer')
    expect(f).toContain('set search_path = public')
    expect(f).toContain('l.partner_id = current_partner_id()')
    expect(f).toContain("e.type = 'quote' and e.partner_id is null")
    expect(f).toContain('left join enquiry_line_proposals p')
    expect(f).not.toContain('quoted_unit_price')
    expect(code).toMatch(/grant execute on function my_desk_quote_lines\(\) to authenticated;/)
  })

  it("adds one prose section to the seller's enquiries help, once, and checks it is there", () => {
    expect(code).toMatch(/update kb_articles k[\s\S]*where k\.view = 'pt-enquiries'/)
    expect(code).toContain("jsonb_build_object('kind', 'prose', 'heading', 'your lines on a quote the desk answers'")
    expect(code).toContain("b ->> 'heading' = 'your lines on a quote the desk answers'")
    expect(sql).toContain('You can propose until the desk sends the quote')
    expect(code.slice(code.lastIndexOf('do $$'))).toContain("k.view = 'pt-enquiries'")
  })

  it('does not refuse a re-run because a quote with proposals was since reassigned to a seller', () => {
    const check = code.slice(code.lastIndexOf('do $$'))
    const block = check.slice(check.indexOf('from enquiry_line_proposals p'), check.indexOf('if n > 0', check.indexOf('from enquiry_line_proposals p')))
    expect(block).toContain('p.partner_id is distinct from l.partner_id')
    expect(block).not.toContain('e.partner_id is null')
  })

  it('puts no bare CASE inside an IF condition and drops no table', () => {
    expect(code).not.toMatch(/\bif\s+case\b/)
    expect(code).not.toMatch(/\belsif\s+case\b/)
    expect(code).not.toMatch(/drop table/)
  })
})
