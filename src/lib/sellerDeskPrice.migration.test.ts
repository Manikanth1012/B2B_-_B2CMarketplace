// 20261112300000, checked without a database: a seller reads line rows only of
// enquiries routed to it, so it no longer reads the desk's quoted price on its
// lines of a desk quote (it reads those lines through my_desk_quote_lines).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261112300000_a_seller_does_not_read_the_desks_price.sql', import.meta.url),
  'utf8',
)
const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()

describe("a seller does not read the desk's price, as a migration", () => {
  it('is one transaction that checks what it needs first and checks itself last', () => {
    expect(code.trim().startsWith('begin;')).toBe(true)
    expect(code.trim().endsWith('commit;')).toBe(true)
    expect(code.indexOf("to_regprocedure('public.my_desk_quote_lines()')")).toBeLessThan(code.indexOf('create policy'))
    const last = code.lastIndexOf('do $$')
    expect(last).toBeGreaterThan(code.indexOf('create policy'))
    expect(code.slice(last)).toContain('raise exception')
  })

  it('replaces only the seller read policy on enquiry_lines, idempotently', () => {
    expect(code).toContain('drop policy if exists "partner_read_enquiry_lines" on enquiry_lines;')
    expect(code.match(/create policy/g)).toHaveLength(1)
    expect(code).toMatch(/create policy "partner_read_enquiry_lines" on enquiry_lines for select to authenticated\s+using \(current_persona\(\) = 'partner' and enquiry_routed_to_me\(enquiry_id\)\);/)
    expect(code).not.toMatch(/create or replace function|alter table|drop function|drop table/)
  })

  it('no longer lets a seller in through the desk quote', () => {
    const policy = code.slice(code.indexOf('create policy'), code.indexOf(';', code.indexOf('create policy')))
    expect(policy).not.toContain('enquiry_is_desk_quote')
  })
})
