// The migration that holds an ordinary requisition line to the price book,
// checked without a database (the user applies it by hand). Its behaviour is
// checked against the live database by requisitionPrice.integration.test.ts,
// which skips until it is applied.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sql = read('20261111300000_a_requisition_line_carries_the_list_price.sql')

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

/** One function's source, from `create or replace function name(` to its closing `$$;`. */
function fn(src: string, name: string): string {
  const m = src.match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`))
  expect(m, name).not.toBeNull()
  return m![0]
}

const guard = fn(lower, 'guard_requisition_line_price')
const selfCheck = lower.slice(lower.lastIndexOf('do $$'))

describe('a requisition line carries the list price', () => {
  it('replaces one trigger function, security definer with a fixed search path', () => {
    expect(guard.startsWith('create or replace function guard_requisition_line_price() returns trigger\n' +
      'language plpgsql security definer set search_path = public as $$')).toBe(true)
  })

  it('attaches it before insert or an update of the price, product or requisition, re-runnably', () => {
    const drop = lower.indexOf('drop trigger if exists enterprise_requisition_lines_price_guard on enterprise_requisition_lines;')
    const create = lower.indexOf('create trigger enterprise_requisition_lines_price_guard\n' +
      '  before insert or update of unit_price, product_id, requisition_id on enterprise_requisition_lines\n' +
      '  for each row execute function guard_requisition_line_price();')
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
    expect(lower).not.toMatch(/before[^;]*delete[^;]*enterprise_requisition_lines_price_guard|enterprise_requisition_lines_price_guard[^;]*delete/)
  })

  it('fires after the line guard, so a decided requisition is refused for that first', () => {
    // Postgres fires triggers of one timing in name order.
    expect('enterprise_requisition_lines_guard' < 'enterprise_requisition_lines_price_guard').toBe(true)
  })

  it('lets everyone but the business buyer through, as the house guards do, before anything else', () => {
    const persona = guard.indexOf("if current_persona() is distinct from 'enterprise' then\n    return new;")
    expect(persona).toBeGreaterThan(-1)
    expect(persona).toBeLessThan(guard.indexOf('select'))
  })

  it('leaves quoted lines and bundle parts to their own guards', () => {
    const skip = guard.indexOf('if new.quote_line_id is not null or new.bundle_selection_id is not null then\n    return new;')
    expect(skip).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(guard.indexOf('from product_prices'))
  })

  it('on an update, only looks again when the price, product or requisition changed', () => {
    expect(guard).toContain("if tg_op = 'update'\n" +
      '     and new.unit_price is not distinct from old.unit_price\n' +
      '     and new.product_id is not distinct from old.product_id\n' +
      '     and new.requisition_id is not distinct from old.requisition_id then\n' +
      '    return new;')
  })

  it('holds the line to the price book for the requisition\'s currency, to the cent', () => {
    expect(guard).toContain('select r.id, r.currency into v_req from enterprise_requisitions r where r.id = new.requisition_id;')
    expect(guard).toContain('select round(pp.price, 2) into v_book\n    from product_prices pp\n' +
      '   where pp.product_id = new.product_id and pp.currency = v_req.currency;')
    expect(guard).toContain('if round(new.unit_price, 2) is distinct from v_book then')
    // never the was price, the floor, or the list price
    expect(guard).not.toMatch(/was_price|floor_price|list_price/)
  })

  it('falls back to the base row only where the shelf does, in the same money', () => {
    const book = guard.indexOf('from product_prices pp')
    const base = guard.indexOf('from products p\n     where p.id = new.product_id and p.currency = v_req.currency;')
    expect(base).toBeGreaterThan(book)
    expect(guard).toContain('select round(p.price, 2) into v_book')
  })

  it('refuses a line naming no listing, and one with no price in that money', () => {
    expect(guard).toContain('if new.product_id is null then')
    const msgs = raises(code).filter(r => r.level === 'exception').map(r => r.message)
    expect(msgs).toContain('% names no listing, so there is no price to hold it to. Add it from the catalogue and raise the requisition again.')
    expect(msgs).toContain('% has no price in %, so it cannot go on a requisition in %. Refresh the requisition to see what is on sale in %.')
  })

  it('tells the buyer the price changed and to refresh the requisition', () => {
    const msgs = raises(code).map(r => r.message)
    expect(msgs).toContain('The price of % has changed: it is now % %, and this requisition has it at %. Refresh the requisition to pick up the current price, then raise it again.')
  })

  it('checks itself: attached on the right events and columns, the existing guards still there', () => {
    expect(selfCheck).toContain("tgname = 'enterprise_requisition_lines_price_guard' and not tgisinternal")
    expect(selfCheck).toContain('(v_type & 23) <> 23 or (v_type & 8) <> 0')
    expect(selfCheck).toContain("array_length(string_to_array(btrim(v_cols), ' '), 1) is distinct from 3")
    for (const t of ['enterprise_requisition_lines_guard', 'enterprise_requisition_lines_quoted_guard',
      'enterprise_requisition_lines_bundle_guard', 'enterprise_requisition_lines_bundle_follow',
      'enterprise_requisition_lines_bundle_whole']) {
      expect(selfCheck).toContain(`'${t}'`)
    }
    expect(selfCheck).toContain('if v_n <> 5 then')
  })

  it('counts the pending ordinary lines it would refuse, as a notice, and changes none', () => {
    expect(selfCheck).toContain("where r.state = 'pending'\n     and l.quote_line_id is null and l.bundle_selection_id is null")
    const notices = raises(selfCheck).filter(r => r.level === 'notice')
    expect(notices).toHaveLength(1)
    expect(notices[0].message).toMatch(/^% ordinary lines on pending requisitions are not at the price book's price/)
    // no row is written anywhere in the file
    expect(maskStrings(lower)).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/)
  })

  it('drops nothing but its own trigger, and names no constraint', () => {
    expect(lower).not.toMatch(/drop (table|function|policy|index)/)
    expect([...lower.matchAll(/drop trigger if exists (\w+)/g)].map(m => m[1])).toEqual(['enterprise_requisition_lines_price_guard'])
    expect(lower).not.toMatch(/\bconstraint\b/)
  })

  it('prefixes every variable it declares', () => {
    const decls = [...lower.matchAll(/declare\n([\s\S]*?)\nbegin/g)].flatMap(m => m[1].split('\n'))
      .map(l => l.trim()).filter(Boolean)
    expect(decls.length).toBeGreaterThan(4)
    for (const d of decls) expect(d, d).toMatch(/^v_\w+\s+\w+;$/)
  })

  it('has no bare CASE inside an IF or ELSIF condition', () => {
    const conds = ifConditions(code)
    expect(conds.length).toBeGreaterThan(8)
    expect(conds.filter(hasBareCase)).toEqual([])
  })

  it('gives every RAISE as many arguments as its message has placeholders', () => {
    const all = raises(code)
    expect(all.length).toBeGreaterThan(6)
    expect(all.filter(r => r.placeholders !== r.args).map(r => r.text)).toEqual([])
  })
})
