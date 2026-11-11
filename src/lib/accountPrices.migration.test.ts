// The migration that gives a business account prices of its own, checked
// without a database (the user applies it by hand). Its behaviour is checked
// against the live database by accountPrices.integration.test.ts, which skips
// until it is applied.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sql = read('20261112100000_an_account_buys_at_its_own_price.sql')

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

/** True when a CASE sits in the condition outside every bracket. */
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
function raises(code: string): { text: string; level: string; message: string; placeholders: number; args: number }[] {
  const out: { text: string; level: string; message: string; placeholders: number; args: number }[] = []
  const re = /\braise\s+(exception|notice|warning|info)\s+'/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const start = m.index + m[0].length - 1
    const end = endOfString(code, start)
    const message = code.slice(start + 1, end - 1).replace(/''/g, "'")
    const placeholders = (message.replace(/%%/g, '').match(/%/g) ?? []).length
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
    out.push({ text: code.slice(m.index, end + k), level: m[1].toLowerCase(), message, placeholders, args })
  }
  return out
}

const code = stripComments(sql)
const lower = code.toLowerCase()
const masked = maskStrings(lower)

/** One function's source, from `create or replace function name(` to its closing `$$;`. */
function fn(name: string): string {
  const m = lower.match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`))
  expect(m, name).not.toBeNull()
  return m![0]
}

const FUNCTIONS = ['account_may_set_policy', 'guard_account_price', 'set_account_price', 'end_account_price',
  'promote_quote_line', 'seller_account_prices', 'guard_buying_rules', 'guard_account_preference',
  'guard_requisition_line_price', 'guard_requisition_line_contract', 'guard_requisition_off_contract']
const TABLES = ['account_prices', 'enterprise_buying_rules', 'account_preferences']
const TAKEN = ['SKU-2001', 'SKU-2004', 'SKU-4003', 'SKU-4008', 'SKU-5003', 'SKU-5004', 'SKU-5005',
  'SKU-5007', 'SKU-5008', 'SKU-6001', 'SKU-6002', 'SKU-7001', 'SKU-7004', 'SKU-7009']

const dos = [...lower.matchAll(/\ndo \$\$[\s\S]*?\nend \$\$;/g)].map(m => ({ text: m[0], at: m.index! }))
const selfCheck = dos[dos.length - 1].text

describe('an account buys at its own price — the migration', () => {
  it('is one transaction, and checks what it stands on before it changes anything', () => {
    expect(code.trimStart().startsWith('begin;')).toBe(true)
    expect(code.trimEnd().endsWith('commit;')).toBe(true)
    const first = dos[0]
    expect(first.at).toBeLessThan(lower.indexOf('create '))
    expect(first.text).toContain('20261111200000_a_requisition_is_ordered_line_by_line.sql')
    expect(first.text).toContain('20261111300000_a_requisition_line_carries_the_list_price.sql')
    expect(first.text).toContain("p.proname = 'place_requisition_order'")
    expect(first.text).toContain("tgname = 'enterprise_requisition_lines_price_guard'")
  })

  it('creates its three tables if they are not there, with RLS on, and drops no table', () => {
    for (const t of TABLES) {
      expect(lower, t).toContain(`create table if not exists ${t} (`)
      expect(lower, t).toMatch(new RegExp(`alter table ${t}\\s+enable row level security;`))
    }
    expect(lower).not.toMatch(/drop table/)
    expect(lower).toContain('create sequence if not exists account_price_seq')
  })

  it('names every constraint once, and never with a name Postgres would give a column check', () => {
    const named = [...masked.matchAll(/\bconstraint (\w+)/g)].map(m => m[1])
    expect(named.length).toBeGreaterThan(8)
    // `drop constraint if exists x` and `add constraint x` name the same one
    const declared = [...masked.matchAll(/(?:add constraint|^\s+constraint) (\w+)/gm)].map(m => m[1])
    expect(new Set(declared).size).toBe(declared.length)
    const cols: Record<string, string[]> = {}
    for (const t of TABLES) {
      const body = masked.match(new RegExp(`create table if not exists ${t} \\(([\\s\\S]*?)\\n\\);`))![1]
      cols[t] = [...body.matchAll(/^\s+(\w+)\s+(?!check\b)\w+/gm)].map(m => m[1]).filter(c => c !== 'constraint')
    }
    cols.enterprise_requisition_lines = ['account_price_id', 'off_contract', 'off_contract_rule', 'off_contract_reason',
      'unit_price', 'product_id', 'requisition_id', 'quantity', 'name']
    for (const n of named) {
      for (const [t, cs] of Object.entries(cols)) {
        for (const c of cs) expect(n, `${n} collides with ${t}.${c}`).not.toBe(`${t}_${c}_check`)
      }
    }
    expect(masked).toContain('drop constraint if exists enterprise_requisition_lines_off_contract_shape;')
    expect(masked).toContain('drop constraint if exists enterprise_requisition_lines_off_contract_why;')
  })

  it('writes every function with create or replace, as its owner, with a fixed search path', () => {
    for (const f of FUNCTIONS) {
      const src = fn(f)
      expect(src, f).toMatch(/security definer set search_path = public as \$\$/)
    }
  })

  it('keeps every check the price guard had, and holds an account price between floor and published', () => {
    const g = fn('guard_requisition_line_price')
    expect(g).toContain("if current_persona() is distinct from 'enterprise' then\n    return new;")
    expect(g).toContain('if new.quote_line_id is not null or new.bundle_selection_id is not null then')
    expect(g).toContain("if tg_op = 'update'\n" +
      '     and new.unit_price is not distinct from old.unit_price\n' +
      '     and new.product_id is not distinct from old.product_id\n' +
      '     and new.requisition_id is not distinct from old.requisition_id then\n' +
      '    return new;')
    expect(g).toContain('if new.product_id is null then')
    expect(g).toContain('from products p\n     where p.id = new.product_id and p.currency = v_req.currency;')
    expect(g).toContain('from account_prices ap')
    expect(g).toMatch(/least\(v_book, greatest\(round\(v_ap\.unit_price, 2\), coalesce\(v_floor, 0\)\)\)/)
    const msgs = raises(code).map(r => r.message)
    expect(msgs).toContain('% names no listing, so there is no price to hold it to. Add it from the catalogue and raise the requisition again.')
    expect(msgs).toContain('% has no price in %, so it cannot go on a requisition in %. Remove it from the requisition to raise the rest.')
    expect(msgs).toContain('The price of % has changed: it is now % %, and this requisition has it at %. Remove it from the requisition and add it again from the catalogue to take the current price.')
    expect(msgs.some(m => /^The price of % has changed: your account's price is now/.test(m) &&
      /add it again from the catalogue/.test(m))).toBe(true)
    expect(g).toMatch(/has changed[\s\S]*add it again from the catalogue/)
  })

  it('makes every trigger again after dropping it, on the events it judges', () => {
    const creates = [...lower.matchAll(/create trigger (\w+)\s+([\s\S]*?) on (\w+)\s+for each row/g)]
    expect(creates.length).toBe(6)
    for (const m of creates) {
      const drop = lower.indexOf(`drop trigger if exists ${m[1]} on ${m[3]};`)
      expect(drop, m[1]).toBeGreaterThan(-1)
      expect(drop, m[1]).toBeLessThan(m.index!)
    }
    const on = (name: string) => creates.find(m => m[1] === name)![2].replace(/\s+/g, ' ').trim()
    expect(on('enterprise_requisition_lines_price_guard')).toBe('before insert or update of unit_price, product_id, requisition_id')
    expect(on('enterprise_requisition_lines_z_contract_guard')).toBe('before insert or update')
    expect(on('z_guard_requisition_off_contract')).toBe('before update of need')
    // the contract guard sorts after every other line guard
    for (const t of ['enterprise_requisition_lines_guard', 'enterprise_requisition_lines_quoted_guard',
      'enterprise_requisition_lines_bundle_guard', 'enterprise_requisition_lines_price_guard']) {
      expect(t < 'enterprise_requisition_lines_z_contract_guard').toBe(true)
    }
  })

  it('has no bare CASE in an IF condition, no exclusion constraint, no extension', () => {
    const conds = ifConditions(code)
    expect(conds.length).toBeGreaterThan(40)
    expect(conds.filter(hasBareCase)).toEqual([])
    expect(lower).not.toMatch(/exclude using/)
    expect(lower).not.toMatch(/create extension/)
  })

  it('names its policies, drops each first, and keeps the anonymous visitor out', () => {
    const made = [...lower.matchAll(/create policy "(\w+)" on (\w+)/g)]
    expect(made.length).toBe(11)
    for (const m of made) {
      const drop = lower.indexOf(`drop policy if exists "${m[1]}" on ${m[2]};`)
      expect(drop, m[1]).toBeGreaterThan(-1)
      expect(drop, m[1]).toBeLessThan(m.index!)
    }
    expect(lower).toContain('revoke all on account_prices, enterprise_buying_rules, account_preferences from anon;')
    for (const f of ['set_account_price', 'end_account_price', 'promote_quote_line', 'seller_account_prices']) {
      expect(lower, f).toMatch(new RegExp(`revoke all on function ${f}\\([^)]*\\) from public, anon;`))
      expect(lower, f).toMatch(new RegExp(`grant execute on function ${f}\\([^)]*\\) to authenticated;`))
    }
  })

  it('writes CR-008 down as it now is, and the help as the screens will need it', () => {
    const cr = lower.match(/update channel_rule[\s\S]*?;/)![0]
    expect(cr).toContain("decision       = 'sold here'")
    expect(cr).toMatch(/reason\s+= '[^;]*published/)
    expect(cr).toContain("where id = 'cr-008' and decision = 'not operated here'")
    expect(lower).toContain("if not exists (select 1 from kb_articles where view = 'op-pricebooks') then")
    expect(lower).toContain("if not exists (select 1 from kb_articles where view = 'en-pricebook') then")
    const agreement = lower.match(/update kb_articles k[\s\S]*?where k\.view = 'en-agreement'[^;]*;/)![0]
    const contracts = lower.match(/update kb_articles k[\s\S]*?where k\.view = 'op-contracts'[^;]*;/)![0]
    expect(agreement).toContain('published for your market')
    expect(contracts).toContain('published for its market')
    // blocks are {kind, heading, text} objects since 20260809900000, and z_guard_kb_body refuses arrays
    for (const u of [agreement, contracts]) {
      expect(u).toContain("jsonb_typeof(e) = 'object' and e ->> 'heading' = ")
      expect(u).toContain("jsonb_build_object('kind', 'prose', 'heading', ")
      expect(u).not.toMatch(/jsonb_typeof\(e\) = 'array'|e ->> 0|jsonb_build_array\(/)
    }
    expect(agreement).toContain("'it does not set prices'")
    expect(agreement).toContain("like '%no rate card forms part of this agreement%'")
    expect(contracts).toContain("'what an agreement settles, and what it does not'")
    expect(contracts).toContain("like '%no rate card hanging off any of this%'")
    for (const u of [agreement, contracts]) {
      const replacement = u.match(/\bthen ([\s\S]*?)\belse e end/)![1]
      expect(replacement).not.toMatch(/rate card/)
    }
  })

  it('checks at the end that neither agreement article still says there is no rate card', () => {
    expect(selfCheck).toContain("and (body::text ilike '%rate card%' or body::text ilike '%it does not set prices%');")
    expect(raises(selfCheck).map(r => r.message)).toContain('agreement help still says prices are never negotiated: %')
  })

  it('vouches for the seed band and the seeded rule only on the run that wrote the seed', () => {
    expect(lower).toContain("perform set_config('aventa.account_price_seeded', 'yes', true);")
    expect(selfCheck).toContain("current_setting('aventa.account_price_seeded', true)")
    expect(selfCheck).toContain('if v_n <> 1 and v_seeded then')
    expect(selfCheck).toContain("if v_rule is distinct from 'allow' and v_seeded then")
  })

  it('holds the off-contract shape against a null rule', () => {
    expect(lower).toContain("(off_contract and off_contract_rule is not null and off_contract_rule in ('allow', 'reason', 'approval'))")
  })

  it('lets the foreign key let go of a quote line only when nothing else changed', () => {
    const g = fn('guard_account_price')
    const shortcut = g.slice(g.indexOf('if new.quote_line_id is null and old.quote_line_id is not null'), g.indexOf('return new;'))
    for (const c of ['account_id', 'product_id', 'currency', 'unit_price', 'starts_on', 'ends_on', 'source',
      'quote_ref', 'note', 'set_by', 'set_at', 'ended_by', 'ended_at', 'end_reason']) {
      expect(shortcut, c).toContain(`new.${c} is not distinct from old.${c}`)
    }
  })

  it('only ever brings an end forward, and clears stale stamps when the service role moves one later', () => {
    const g = fn('guard_account_price')
    expect(g).toContain('if old.ends_on is not null and (new.ends_on is null or new.ends_on > old.ends_on) then')
    expect(raises(code).map(r => r.message)).toContain(
      "An account price's end is only brought forward. To keep the account on this figure for longer, set a new price from %.")
    expect(g).toMatch(/elsif old\.ends_on is not null and \(new\.ends_on is null or new\.ends_on > old\.ends_on\) then\s+[\s\S]*?new\.ended_by := null;\s+new\.ended_at := null;\s+new\.end_reason := null;/)
  })

  it('refuses a price of nothing in a sentence, before anything is written', () => {
    const promote = fn('promote_quote_line')
    expect(promote.indexOf('if v_q.quoted_unit_price <= 0 then')).toBeGreaterThan(-1)
    expect(promote.indexOf('if v_q.quoted_unit_price <= 0 then')).toBeLessThan(promote.indexOf('return set_account_price('))
    const set = fn('set_account_price')
    expect(set.indexOf('if p_unit_price is null or round(p_unit_price, 2) <= 0 then')).toBeLessThan(set.indexOf('insert into account_prices'))
    expect(set.indexOf('if p_unit_price is null or round(p_unit_price, 2) <= 0 then')).toBeGreaterThan(-1)
  })

  it('seeds by id, re-runnably, and never on a listing another test buys', () => {
    expect(code).toContain("'AP-SEED-2007-1'")
    expect(code).toContain("'PREF-SEED-2007-P'")
    expect(code).toContain("'PREF-SEED-2007-S'")
    expect(lower).toMatch(/values \('ap-seed-2007-1'[\s\S]*?on conflict \(id\) do nothing;/)
    expect((lower.match(/on conflict do nothing;/g) ?? []).length).toBe(2)
    expect(lower).toContain('on conflict (account_id) do nothing;')
    const list = code.match(/p\.id not in \(([^)]*)\)/)![1]
    expect([...list.matchAll(/'([^']+)'/g)].map(m => m[1])).toEqual(TAKEN)
  })

  it('checks itself at the end: what it stands on, and the events each guard fires on', () => {
    expect(selfCheck).toContain("p.proname = 'place_requisition_order'")
    expect(selfCheck).toContain("like '%v_by_line%'")
    expect(selfCheck).toContain("tgname = 'enterprise_requisition_lines_price_guard'")
    expect(selfCheck).toContain("tgname = 'enterprise_requisition_lines_z_contract_guard'")
    expect(selfCheck).toContain("tgname = 'z_guard_requisition_off_contract'")
    expect((selfCheck.match(/tgtype/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(selfCheck).toContain('(v_type & 23) <> 23 or (v_type & 8) <> 0')
    expect(selfCheck).toContain('(v_type & 19) <> 19 or (v_type & 12) <> 0')
    expect(selfCheck).toContain('if v_n <> 7 then')
    for (const f of FUNCTIONS) expect(selfCheck, f).toContain(`'${f}'`)
  })

  it('prefixes every variable it declares', () => {
    const decls = [...masked.matchAll(/\ndeclare\b([\s\S]*?)\nbegin\b/g)]
      .flatMap(m => m[1].split(/[;\n]/)).map(l => l.trim()).filter(Boolean)
    expect(decls.length).toBeGreaterThan(20)
    for (const d of decls) expect(d, d).toMatch(/^[vn]_\w+\s+[\w.]+/)
  })

  it('gives every RAISE as many arguments as its message has placeholders', () => {
    const all = raises(code)
    expect(all.length).toBeGreaterThan(30)
    expect(all.filter(r => r.placeholders !== r.args).map(r => r.text)).toEqual([])
  })
})
