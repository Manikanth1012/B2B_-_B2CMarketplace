// The bundles migration, checked without a database. Nobody here can apply
// it, and the user applies it by hand to the shared database, so these are the
// structural facts that have to hold the first time: the tables and their
// columns (named as src/lib/bundles.ts and bundleRepo.ts name them), RLS on,
// the guards attached, the RPCs granted to whom they are for — and the two
// PL/pgSQL mistakes that cost spec 6 its first apply: a bare CASE inside an IF
// condition, and a RAISE whose placeholders do not match its arguments.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261105200000_a_buyer_builds_the_bundle.sql', import.meta.url),
  'utf8',
)

/** Comments removed; string literals kept. */
function stripComments(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === "'") {
      const j = endOfString(s, i)
      out += s.slice(i, j)
      i = j
    } else if (s.startsWith('/*', i)) {
      const j = s.indexOf('*/', i + 2)
      i = j < 0 ? s.length : j + 2
      out += ' '
    } else if (s.startsWith('--', i)) {
      const j = s.indexOf('\n', i)
      i = j < 0 ? s.length : j
    } else {
      out += s[i]
      i++
    }
  }
  return out
}

/** Index just past the string literal that opens at `i` ('' is an escaped quote). */
function endOfString(s: string, i: number): number {
  let j = i + 1
  while (j < s.length) {
    if (s[j] === "'") {
      if (s[j + 1] === "'") { j += 2; continue }
      return j + 1
    }
    j++
  }
  return j
}

/** String literal contents blanked, so keywords and brackets inside messages are not code. */
function maskStrings(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === "'") {
      const j = endOfString(s, i)
      out += "'" + 'x'.repeat(Math.max(0, j - i - 2)) + "'"
      i = j
    } else {
      out += s[i]
      i++
    }
  }
  return out
}

/** Every IF / ELSIF condition: the text from the keyword to the THEN that ends it in PL/pgSQL. */
function ifConditions(code: string): string[] {
  const masked = maskStrings(code).toLowerCase()
  const out: string[] = []
  const re = /\b(if|elsif)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    const before = masked.slice(Math.max(0, m.index - 8), m.index)
    if (/\bend\s+$/.test(before)) continue                                   // end if
    const after = masked.slice(m.index + m[0].length)
    if (/^\s+(not\s+)?exists\s+[a-z_"]/.test(after)) continue                // DDL: if [not] exists <name>
    // PL/pgSQL ends the condition at the first THEN outside brackets.
    let depth = 0
    let k = m.index + m[0].length
    for (; k < masked.length; k++) {
      const ch = masked[k]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (depth === 0 && /^then\b/.test(masked.slice(k)) && /\W/.test(masked[k - 1])) break
    }
    out.push(masked.slice(m.index + m[0].length, k))
  }
  return out
}

/** True when a CASE sits in the condition outside every bracket — the bug. */
function hasBareCase(condition: string): boolean {
  let depth = 0
  for (let k = 0; k < condition.length; k++) {
    const ch = condition[k]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0 && /^case\b/.test(condition.slice(k)) && (k === 0 || /\W/.test(condition[k - 1]))) return true
  }
  return false
}

/** Every RAISE: how many placeholders its message has and how many arguments follow it. */
function raises(code: string): { text: string; placeholders: number; args: number }[] {
  const out: { text: string; placeholders: number; args: number }[] = []
  const re = /\braise\s+(exception|notice|warning|info)\s+'/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const start = m.index + m[0].length - 1
    const end = endOfString(code, start)
    const message = code.slice(start + 1, end - 1).replace(/''/g, "'")
    const placeholders = (message.replace(/%%/g, '').match(/%/g) ?? []).length
    // Arguments: comma-separated, outside brackets, up to the semicolon.
    const rest = maskStrings(code.slice(end))
    let depth = 0
    let args = 0
    let k = 0
    for (; k < rest.length; k++) {
      const ch = rest[k]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (depth === 0 && ch === ',') args++
      else if (depth === 0 && ch === ';') break
    }
    out.push({ text: code.slice(m.index, end + k), placeholders, args })
  }
  return out
}

const code = stripComments(sql)
const lower = code.toLowerCase()

const TABLES = ['bundle_templates', 'bundle_slots', 'bundle_options', 'bundle_selections', 'bundle_selection_lines']

/** The column list of one `create table if not exists` statement. */
function columnsOf(table: string): string[] {
  const m = lower.match(new RegExp(`create table if not exists ${table} \\(([\\s\\S]*?)\\n\\);`))
  expect(m, table).not.toBeNull()
  return m![1].split('\n')
    .map((l) => l.trim().match(/^([a-z_]+)\s+(text|integer|numeric|boolean|jsonb|uuid|timestamptz)/))
    .filter((x): x is RegExpMatchArray => x !== null)
    .map((x) => x[1])
}

/** One function's source, from `create or replace function name(` to its closing `$$;`. */
function fn(name: string): string {
  const m = lower.match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`))
  expect(m, name).not.toBeNull()
  return m![0]
}

describe('the checks this file uses on itself', () => {
  it('find a bare CASE in an IF condition and pass a bracketed one', () => {
    const bad = ifConditions("begin if x is distinct from case y when 1 then 'a' end then null; end if; end")
    expect(bad.some(hasBareCase)).toBe(true)
    const good = ifConditions("begin if x is distinct from (case y when 1 then 'a' end) then null; end if; end")
    expect(good.some(hasBareCase)).toBe(false)
  })

  it('skip DDL "if exists" and END IF, and keep PL/pgSQL "if exists (...)"', () => {
    const conds = ifConditions('drop trigger if exists t on x; begin if exists (select 1) then null; end if; end')
    expect(conds).toHaveLength(1)
    expect(conds[0]).toContain('exists (select 1)')
  })

  it('count RAISE placeholders and arguments, ignoring %% and commas in brackets or strings', () => {
    const [r] = raises("raise exception 'a % b %% c % (d)', f(x, y), 'p, q';")
    expect(r.placeholders).toBe(2)
    expect(r.args).toBe(2)
  })
})

describe('the bundles migration', () => {
  it.each(TABLES)('creates %s idempotently', (t) => {
    expect(lower).toMatch(new RegExp(`create table if not exists ${t} \\(`))
  })

  it.each(TABLES)('enables row level security on %s', (t) => {
    expect(lower).toMatch(new RegExp(`alter table ${t}\\s+enable row level security`))
  })

  it('names the columns the way the TypeScript shapes do', () => {
    expect(columnsOf('bundle_templates')).toEqual(expect.arrayContaining(
      ['id', 'name', 'description', 'image', 'status', 'audiences', 'discount_pct']))
    expect(columnsOf('bundle_slots')).toEqual(expect.arrayContaining(
      ['id', 'template_id', 'label', 'min_pick', 'max_pick', 'qty_min', 'qty_max', 'qty_default', 'sort_order']))
    expect(columnsOf('bundle_options')).toEqual(expect.arrayContaining(
      ['id', 'slot_id', 'product_id', 'is_default', 'sort_order']))
    expect(columnsOf('bundle_selections')).toEqual(expect.arrayContaining(
      ['id', 'template_id', 'account_id', 'user_id', 'currency', 'quantity', 'total', 'parts_total',
       'priced_at', 'valid_until', 'choices']))
    expect(columnsOf('bundle_selection_lines')).toEqual(expect.arrayContaining(
      ['id', 'selection_id', 'product_id', 'name', 'partner_id', 'seller', 'quantity',
       'list_unit_price', 'unit_price', 'floor_unit_price', 'sort_order']))
  })

  it('keeps the spec\'s checks on the rows', () => {
    expect(lower).toContain("check (status in ('draft', 'live', 'paused'))")
    expect(lower).toMatch(/cardinality\(audiences\) >= 1\s+and audiences <@ array\['consumer', 'enterprise'\]/)
    expect(lower).toContain('check (discount_pct > 0 and discount_pct < 100)')
    expect(lower).toContain('check ((account_id is null) <> (user_id is null))')
    expect(lower).toContain('check (max_pick >= greatest(1, min_pick))')
    expect(lower).toContain('check (qty_default between qty_min and qty_max)')
    expect(lower).toContain('unique (slot_id, product_id)')
    // the published cap lives in another table, so a trigger checks it
    expect(fn('guard_bundle_template')).toContain('new.discount_pct > v_rule.max_discount')
  })

  it('never drops a table without "if exists"', () => {
    const drops = [...lower.matchAll(/drop table\s+(\S+)/g)].map((m) => m[1])
    for (const d of drops) expect(d).toBe('if')
  })

  it('has no bare CASE inside an IF or ELSIF condition', () => {
    const conds = ifConditions(code)
    expect(conds.length).toBeGreaterThan(50)
    const bad = conds.filter(hasBareCase)
    expect(bad).toEqual([])
  })

  it('gives every RAISE as many arguments as its message has placeholders', () => {
    const all = raises(code)
    expect(all.length).toBeGreaterThan(40)
    const bad = all.filter((r) => r.placeholders !== r.args).map((r) => r.text)
    expect(bad).toEqual([])
  })

  it('checks a value is a JSON array before asking its length', () => {
    const body = fn('price_bundle')
    expect(body.indexOf("jsonb_typeof(v_picks) is distinct from 'array'"))
      .toBeLessThan(body.indexOf('jsonb_array_length(v_picks)'))
    expect(body).toContain("jsonb_typeof(p_choices) is distinct from 'object'")
  })

  it('prices with the arithmetic priceBundle uses', () => {
    const body = fn('price_bundle')
    expect(body).toContain('v_floor      := coalesce(v_product.floor, 0)')
    expect(body).toContain('v_disc       := round(v_list * (1 - v_t.discount_pct / 100), 2)')
    expect(body).toContain('v_unit       := round(greatest(v_disc, v_floor), 2)')
    expect(body).toContain('v_line_total := round(v_unit * v_line_qty, 2)')
    expect(body).toContain('v_total := v_total + v_line_total')
    expect(body).toContain('v_parts := v_parts + round(v_list * v_line_qty, 2)')
    expect(body).toContain("'saving',       v_parts - v_total")
    // pure: no writes
    expect(body).not.toMatch(/\b(insert into|update \w+ set|delete from)\b/)
    expect(body).toContain('language plpgsql stable')
  })

  it('refuses what validateChoices refuses, in the same order and words', () => {
    const body = fn('price_bundle')
    const order = [
      'there is no such slot in this bundle',
      'pick at least % %',
      'pick at most % %',
      'is not an option there',
      'pick each % product only once',
      'choose % to % of each %',
    ].map((s) => body.indexOf(s))
    for (const i of order) expect(i).toBeGreaterThan(-1)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('builds the default configuration as defaultChoices does', () => {
    const body = fn('bundle_default_choices')
    expect(body).toContain('o2.is_default')
    expect(body).toContain('o.rn <= s.max_pick and s.min_pick >= 1')
    expect(body).toContain("coalesce(d.picks, '[]'::jsonb)")
    expect(body).toContain("'quantity', s.qty_default")
  })

  it('defines configure_bundle as security definer, owned by the caller, held seven days', () => {
    const body = fn('configure_bundle')
    expect(body).toContain('security definer set search_path = public')
    expect(body).toContain('current_persona()')
    expect(body).toContain('current_account_id()')
    expect(body).toContain('from consumer_profile p where p.user_id = v_uid')
    expect(body).toContain('from enterprise_accounts a where a.id = v_account')
    expect(body).toContain("v_now + interval '7 days'")
    expect(body).toContain('price_bundle(p_template, p_choices, p_currency, p_quantity)')
  })

  it('grants the RPCs to signed-in buyers and not to anon', () => {
    for (const sig of ['price_bundle(text, jsonb, text, integer)', 'configure_bundle(text, jsonb, text, integer)']) {
      expect(lower).toContain(`revoke all on function ${sig} from public, anon;`)
      expect(lower).toContain(`grant execute on function ${sig} to authenticated;`)
    }
    expect(lower).toContain('revoke all on function bundle_part_unavailable(text, text) from public, anon, authenticated;')
    expect(lower).toContain('revoke all on function bundle_template_problem(text, text[]) from public, anon, authenticated;')
  })

  it('lets nobody write a selection but configure_bundle', () => {
    expect(lower).toContain('revoke insert, update, delete, truncate on bundle_selections, bundle_selection_lines from authenticated;')
    expect(lower).toContain('revoke all on bundle_selections, bundle_selection_lines from anon;')
    const policies = [...lower.matchAll(/create policy "[^"]+" on (bundle_selections|bundle_selection_lines) for (\w+)/g)]
    expect(policies.length).toBeGreaterThan(0)
    for (const p of policies) expect(p[2]).toBe('select')
  })

  it('lets only the operator author templates', () => {
    for (const t of ['bundle_templates', 'bundle_slots', 'bundle_options']) {
      const writes = [...lower.matchAll(new RegExp(`create policy "[^"]+" on ${t} for (all|insert|update|delete) to authenticated\\s+using \\((.*?)\\) with check`, 'g'))]
      expect(writes.length, t).toBe(1)
      expect(writes[0][2]).toBe("current_persona() = 'operator'")
    }
  })

  it('drops every policy if it exists before creating it', () => {
    const created = [...lower.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1])
    expect(created.length).toBeGreaterThan(0)
    for (const p of created) expect(lower, p).toContain(`drop policy if exists "${p}"`)
  })

  it('attaches every trigger after dropping it if it exists', () => {
    const created = [...lower.matchAll(/create (?:constraint )?trigger (\w+)/g)].map((m) => m[1])
    expect(created).toEqual(expect.arrayContaining([
      'bundle_templates_guard', 'bundle_slots_guard', 'bundle_options_guard',
      'cart_items_bundle_guard', 'cart_items_bundle_follow', 'cart_items_bundle_whole',
      'enterprise_requisition_lines_bundle_guard', 'enterprise_requisition_lines_bundle_follow',
      'enterprise_requisition_lines_bundle_whole', 'order_items_bundle_guard', 'order_items_bundle_whole',
    ]))
    for (const t of created) expect(lower, t).toMatch(new RegExp(`drop trigger if exists ${t} on`))
  })

  it.each(['cart_items', 'enterprise_requisition_lines', 'order_items'])('adds bundle_selection_id to %s', (t) => {
    expect(lower).toMatch(new RegExp(`alter table ${t}\\s+add column if not exists bundle_selection_id text references bundle_selections\\(id\\)`))
  })

  it.each(['guard_bundle_cart_line', 'guard_bundle_requisition_line', 'guard_bundle_order_line'])(
    '%s leaves ordinary lines alone, before any bundle check', (name) => {
      const body = fn(name)
      const early = body.indexOf('if new.bundle_selection_id is null then return new; end if;')
      expect(early).toBeGreaterThan(-1)
      expect(early).toBeLessThan(body.indexOf('from bundle_selections where'))
    })

  it('holds requisition and order lines to the selection price, and checks the seven days', () => {
    expect(fn('guard_bundle_requisition_line')).toContain('new.unit_price is distinct from v_l.unit_price')
    expect(fn('guard_bundle_order_line')).toContain('new.price is distinct from v_l.unit_price')
    for (const name of ['guard_bundle_cart_line', 'guard_bundle_requisition_line', 'guard_bundle_order_line']) {
      expect(fn(name)).toContain('v_s.valid_until < now()')
      expect(fn(name)).toContain('bundle_part_unavailable(v_s.id, v_s.currency)')
    }
  })

  it('checks bundles go in whole when the transaction commits', () => {
    for (const t of ['cart_items_bundle_whole', 'enterprise_requisition_lines_bundle_whole', 'order_items_bundle_whole']) {
      expect(lower).toMatch(new RegExp(`create constraint trigger ${t} after insert on \\w+\\s+deferrable initially deferred`))
    }
  })

  it('makes every SECURITY DEFINER function set its search path', () => {
    const defs = [...lower.matchAll(/create or replace function (\w+)\([\s\S]*?\$\$/g)]
    expect(defs.length).toBeGreaterThan(10)
    for (const d of defs) {
      if (d[0].includes('security definer')) expect(d[0], d[1]).toContain('set search_path = public')
    }
  })

  it('seeds two templates by a non-numeric prefix, through the publish check, and checks them', () => {
    expect(lower).toContain("delete from bundle_slots where template_id like 'bt-seed-%'")
    expect(lower).toContain("('bt-seed-office', 'smart office starter kit'")
    expect(lower).toContain("('bt-seed-home', 'home security bundle'")
    expect(lower).toContain("update bundle_templates set status = 'live' where id in ('bt-seed-office', 'bt-seed-home')")
    // fails loudly if the listings are not on sale
    expect(lower).toContain('the bundle seed is built from listings on sale today')
    // and the self-check prices each one in every market currency
    expect(lower).toContain('price_bundle(t, bundle_default_choices(t), c, 1)')
  })

  it('adds the help section by heading, so a second run replaces it', () => {
    expect(lower).toContain("where a.view = 'op-catalogue'")
    expect(lower).toContain("x.b ->> 'heading' is distinct from 'configurable bundles'")
  })
})
