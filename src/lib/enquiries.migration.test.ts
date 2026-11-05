// The enquiries migration, checked without a database. Nobody here can apply
// it, so these are the structural facts the screens and the repo rely on:
// the tables exist, the guards and RPCs are defined, RLS is on, the
// requisition gains its link, and nothing drops a table it cannot be sure of.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261105100000_a_business_can_ask_before_it_buys.sql', import.meta.url),
  'utf8',
)
// Comments say things like "drop table" in prose; the checks read the code.
const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()

const TABLES = ['enquiries', 'enquiry_lines', 'enquiry_slots', 'enquiry_messages', 'enquiry_events']

describe('the enquiries migration', () => {
  it.each(TABLES)('creates %s idempotently', (t) => {
    expect(code).toMatch(new RegExp(`create table if not exists ${t} \\(`))
  })

  it.each(TABLES)('enables row level security on %s', (t) => {
    expect(code).toMatch(new RegExp(`alter table ${t}\\s+enable row level security`))
  })

  it.each(['raise_quote', 'raise_demo', 'raise_sales', 'reassign_enquiry'])('defines the %s RPC as security definer, granted to authenticated', (fn) => {
    const def = code.match(new RegExp(`create or replace function ${fn}\\([\\s\\S]*?\\$\\$`))
    expect(def, fn).not.toBeNull()
    expect(def![0]).toContain('security definer')
    expect(def![0]).toContain('set search_path = public')
    expect(code).toMatch(new RegExp(`grant execute on function ${fn}\\([^)]*\\) to authenticated`))
  })

  it.each(['guard_enquiry', 'guard_quoted_line', 'notify_enquiry', 'guard_enquiry_line', 'guard_enquiry_slot', 'guard_enquiry_message'])('defines %s', (fn) => {
    expect(code).toContain(`create or replace function ${fn}()`)
  })

  it('attaches every trigger after dropping it if it exists', () => {
    const created = [...code.matchAll(/create trigger (\w+)/g)].map((m) => m[1])
    expect(created.length).toBeGreaterThanOrEqual(10)
    for (const t of created) expect(code, t).toMatch(new RegExp(`drop trigger if exists ${t} on`))
  })

  it('drops every policy if it exists before creating it', () => {
    const created = [...code.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1])
    expect(created.length).toBeGreaterThan(0)
    for (const p of created) expect(code, p).toContain(`drop policy if exists "${p}"`)
  })

  it('links a requisition line to the quote line it was priced from', () => {
    expect(code).toMatch(/alter table enterprise_requisition_lines\s+add column if not exists quote_line_id text references enquiry_lines\(id\)/)
    expect(code).toMatch(/create unique index if not exists \w+\s+on enterprise_requisition_lines\(quote_line_id\) where quote_line_id is not null/)
    expect(code).toContain('create trigger enterprise_requisition_lines_quoted_guard')
  })

  it('leaves catalogue-priced requisition lines alone', () => {
    const fn = code.match(/create or replace function guard_quoted_line\(\)[\s\S]*?end \$\$;/)![0]
    expect(fn).toContain('if new.quote_line_id is null then return new; end if;')
  })

  it('numbers enquiries ENQ- from 1001 and seeds ENQ-9 ids by delete-then-insert', () => {
    expect(code).toContain('create sequence if not exists enquiry_seq start with 1001')
    expect(code).toContain(`default ('enq-' || nextval('enquiry_seq'))`)
    expect(code).toContain(`delete from enquiries where id like 'enq-9%'`)
  })

  it('adds the three notification events, in-app only', () => {
    for (const e of ['enquiry.raised', 'enquiry.answered', 'enquiry.decided']) expect(code).toContain(`'${e}'`)
    const rules = code.match(/insert into notification_rules[\s\S]*?on conflict \(id\) do nothing;/)![0]
    expect(rules.match(/array\['inapp'\]/g)).toHaveLength(5)
  })

  it('never drops a table without if exists', () => {
    expect(code).not.toMatch(/drop table (?!if exists)/)
  })
})
