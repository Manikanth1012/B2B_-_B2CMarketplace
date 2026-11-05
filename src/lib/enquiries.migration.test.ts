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

  it.each(['raise_quote', 'raise_demo', 'raise_sales', 'reassign_enquiry', 'send_quote'])('defines the %s RPC as security definer, granted to authenticated', (fn) => {
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
    expect(code).toContain('create trigger enterprise_requisition_lines_quoted_guard')
  })

  it('leaves catalogue-priced requisition lines alone', () => {
    const fn = code.match(/create or replace function guard_quoted_line\(\)[\s\S]*?end \$\$;/)![0]
    expect(fn).toContain('if new.quote_line_id is null then return new; end if;')
    // ...and that early return comes before any quote check
    expect(fn.indexOf('if new.quote_line_id is null then return new; end if;'))
      .toBeLessThan(fn.indexOf('from enquiry_lines l join enquiries e'))
  })

  it('numbers enquiries ENQ- from 1001 and seeds a prefix the sequence can never produce', () => {
    expect(code).toContain('create sequence if not exists enquiry_seq start with 1001')
    expect(code).toContain(`default ('enq-' || nextval('enquiry_seq'))`)
    expect(code).toContain(`delete from enquiries where id like 'enq-seed-%'`)
    expect(code).not.toMatch(/'enq-9/)
  })

  it('adds the three notification events, in-app only', () => {
    for (const e of ['enquiry.raised', 'enquiry.answered', 'enquiry.decided']) expect(code).toContain(`'${e}'`)
    const rules = code.match(/insert into notification_rules[\s\S]*?on conflict \(id\) do nothing;/)![0]
    expect(rules.match(/array\['inapp'\]/g)).toHaveLength(5)
  })

  it('gives the enterprise persona no insert policy on enquiries — raising goes through the RPCs', () => {
    const policies = [...code.matchAll(/create policy "[^"]+" on enquiries\b[^;]*;/g)].map((m) => m[0])
    expect(policies.length).toBeGreaterThan(0)
    for (const p of policies) {
      if (/for (insert|all)\b/.test(p)) expect(p, p).toContain(`current_persona() = 'operator'`)
    }
  })

  it('never grants a write on the audit trail, and revokes it', () => {
    expect(code).not.toMatch(/grant [^;]*\b(update|insert|delete)\b[^;]* on [^;]*enquiry_events/)
    expect(code).toContain('revoke insert, update, delete, truncate on enquiry_events from authenticated')
    expect(code).not.toMatch(/create policy "[^"]+" on enquiry_events for (insert|update|delete|all)/)
  })

  it('keeps the internal functions out of reach of the client', () => {
    expect(code).toMatch(/revoke all on function enquiry_send\([^)]*\) from public, anon, authenticated/)
    expect(code).toMatch(/revoke all on function enquiry_buyer\(\) from public, anon, authenticated/)
  })

  it('sets prices only through send_quote, behind a token row no client can write', () => {
    const fn = code.match(/create or replace function send_quote\([\s\S]*?end \$\$;/)![0]
    const token = 'exists (select 1 from enquiry_rpc_tokens where txid = txid_current())'
    expect(fn).toContain('insert into enquiry_rpc_tokens (txid) values (txid_current()) on conflict do nothing')
    expect(fn).toContain('delete from enquiry_rpc_tokens where txid = txid_current()')
    // The token is put down before the writes and taken up after them.
    const put = fn.indexOf('insert into enquiry_rpc_tokens')
    const take = fn.indexOf('delete from enquiry_rpc_tokens')
    expect(put).toBeLessThan(fn.indexOf('update enquiry_lines'))
    expect(take).toBeGreaterThan(fn.indexOf("update enquiries set status = 'quoted'"))
    for (const g of ['guard_enquiry_line', 'guard_enquiry', 'notify_enquiry']) {
      const body = code.match(new RegExp(`create or replace function ${g}\\(\\)[\\s\\S]*?end \\$\\$;`))![0]
      expect(body, g).toContain(token)
    }
  })

  it('keeps the token table out of reach of every API role', () => {
    expect(code).toMatch(/create table if not exists enquiry_rpc_tokens \(\s*txid bigint primary key\s*\)/)
    expect(code).toMatch(/alter table enquiry_rpc_tokens enable row level security/)
    expect(code).toContain('revoke all on enquiry_rpc_tokens from public, anon, authenticated')
    expect(code).not.toMatch(/create policy "[^"]+" on enquiry_rpc_tokens/)
    expect(code).not.toMatch(/grant [^;]* on [^;]*enquiry_rpc_tokens/)
  })

  it('no longer uses a session flag a client could set', () => {
    expect(sql).not.toContain('app.enquiry_rpc')
  })

  it('locks the demo before counting the times on offer', () => {
    const fn = code.match(/create or replace function guard_enquiry_slot\(\)[\s\S]*?end \$\$;/)![0]
    const lock = fn.indexOf('from enquiries where id = v_e.id for update')
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(fn.indexOf('select count(*) from enquiry_slots'))
  })

  it('refuses a price too large for the column with a sentence', () => {
    expect(code).toMatch(/quoted_unit_price numeric\(10,2\)/)
    const fn = code.match(/create or replace function send_quote\([\s\S]*?end \$\$;/)![0]
    expect(fn).toContain('> 99999999.99')
    expect(fn).toContain('a unit price can be at most 99,999,999.99')
  })

  it.each([
    ['en-enquiries', 'enterprise'],
    ['pt-enquiries', 'partner'],
    ['op-enquiries', 'operator'],
  ])('gives %s a help article for the %s persona, once', (view, persona) => {
    const at = code.indexOf(`where view = '${view}')`)
    expect(at, view).toBeGreaterThan(-1)
    expect(code.slice(at - 80, at)).toContain('if not exists')
    const insert = code.slice(at, code.indexOf('end if;', at))
    expect(insert).toContain(`'${view}'`)
    expect(insert).toContain(`array['${persona}']`)
    expect(insert).toContain("'published'")
  })

  it('names screens that exist', () => {
    const views = readFileSync(new URL('../types/view.ts', import.meta.url), 'utf8')
    for (const v of ['en-enquiries', 'pt-enquiries', 'op-enquiries']) expect(views).toContain(`'${v}'`)
  })

  it('lets a quote line back one live requisition at a time, not one ever', () => {
    expect(code).toContain('drop index if exists enterprise_requisition_lines_quote_line_idx')
    expect(code).not.toMatch(/create unique index[^;]*quote_line_id/)
    const fn = code.match(/create or replace function guard_quoted_line\(\)[\s\S]*?end \$\$;/)![0]
    expect(fn).toContain(`r.state not in ('declined', 'withdrawn')`)
  })

  it('never drops a table without if exists', () => {
    expect(code).not.toMatch(/drop table (?!if exists)/)
  })
})
