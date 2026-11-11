// The migration that orders an ordinary requisition line by line, checked
// without a database. Nobody here can apply it; the user applies it by hand to
// the shared database, so these are the facts that have to hold the first time:
// the function keeps its signature, return type, security and grant; its body
// is the 20261105200000 one with only the branch condition changed (so a
// requisition with a header product is ordered exactly as before); the new
// condition is there; and none of the PL/pgSQL mistakes that cost earlier
// applies — a bare CASE inside an IF condition, a RAISE whose placeholders do
// not match its arguments.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(
  new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8',
).replace(/\r\n/g, '\n')

const sql = read('20261111200000_a_requisition_is_ordered_line_by_line.sql')
const before = read('20261105200000_a_buyer_builds_the_bundle.sql')

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

/** Every IF / ELSIF condition: the text from the keyword to the THEN that ends it. */
function ifConditions(code: string): string[] {
  const masked = maskStrings(code).toLowerCase()
  const out: string[] = []
  const re = /\b(if|elsif)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(masked))) {
    const prior = masked.slice(Math.max(0, m.index - 8), m.index)
    if (/\bend\s+$/.test(prior)) continue                                   // end if
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
function raises(code: string): { text: string; placeholders: number; args: number }[] {
  const out: { text: string; placeholders: number; args: number }[] = []
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
    for (let k = 0; k < rest.length; k++) {
      const ch = rest[k]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (depth === 0 && ch === ',') args++
      else if (depth === 0 && ch === ';') break
    }
    out.push({ text: code.slice(m.index, end), placeholders, args })
  }
  return out
}

/** The place_requisition_order definition in a file, from `create or replace` to its closing `$$;`. */
function placeFn(text: string): string {
  const m = text.match(/create or replace function public\.place_requisition_order\(p_req_id text\)[\s\S]*?\$\$[\s\S]*?\$\$;/)
  expect(m).not.toBeNull()
  return m![0]
}

const code = stripComments(sql)
const lower = code.toLowerCase()
const now = placeFn(sql)
const was = placeFn(before)

const OLD_FLAG = `  v_bundle := exists (select 1 from enterprise_requisition_lines l
                       where l.requisition_id = req.id and l.bundle_selection_id is not null);
`
const NEW_FLAG = `  /* Line by line when a bundle is on it (20261105200000), or when the header
     names no product and the lines say what is being bought. */
  v_by_line := exists (select 1 from enterprise_requisition_lines l
                        where l.requisition_id = req.id and l.bundle_selection_id is not null)
               or (req.product_id is null
                   and exists (select 1 from enterprise_requisition_lines l
                                where l.requisition_id = req.id));
`

describe('the checks this file uses on itself', () => {
  it('find a bare CASE in an IF condition and pass a bracketed one', () => {
    expect(ifConditions("begin if x = case y when 1 then 'a' end then null; end if; end").some(hasBareCase)).toBe(true)
    expect(ifConditions("begin if x = (case y when 1 then 'a' end) then null; end if; end").some(hasBareCase)).toBe(false)
  })
  it('count RAISE placeholders and arguments', () => {
    const [r] = raises("raise exception 'a % b %% c % (d)', f(x, y), 'p, q';")
    expect(r.placeholders).toBe(2)
    expect(r.args).toBe(2)
  })
})

describe('20261111200000: an ordinary requisition is ordered line by line', () => {
  it('replaces the function with the same signature, return type, security and search path, and grants it', () => {
    expect(now).toMatch(/^create or replace function public\.place_requisition_order\(p_req_id text\)\nreturns text language plpgsql security definer\nset search_path to 'public', 'extensions' as \$\$/)
    expect(lower).toContain('grant execute on function public.place_requisition_order(text) to authenticated;')
    // one definition, and nothing else created, altered or dropped
    expect(lower.match(/create or replace function/g)).toHaveLength(1)
    expect(lower).not.toMatch(/\b(drop|alter|create table|create trigger)\b/)
  })

  it('is the 20261105200000 body with only the branch condition changed', () => {
    expect(was).toContain(OLD_FLAG)
    expect(now).toContain(NEW_FLAG)
    const expected = was
      .replace(OLD_FLAG, NEW_FLAG)
      .replace(/v_bundle\b/g, 'v_by_line')
    expect(now).toBe(expected)
    expect(now).not.toContain('v_bundle')
  })

  it('keeps every check and the single-line path a requisition with a header product takes', () => {
    expect(now).toContain("if req.state <> 'approved' then")
    expect(now).toContain('coalesce(req.credit_hold, false)')
    expect(now).toContain('if not v_by_line and req.product_id is null then')
    expect(now).toContain('does not say what it is buying, so no order line can be written for it.')
    expect(now).toContain('select order_ref into extant from orders where requisition_id = req.id limit 1;')
    expect(now).toContain('select * into prod from products where id = req.product_id;')
    expect(now).toMatch(/values \(gen_random_uuid\(\), oid, prod\.id, prod\.name,\s+round\(req\.amount \/ greatest\(req\.quantity, 1\), 2\), req\.quantity, 'pending', 'placed'\);/)
  })

  it('checks the lines before ordering them, and orders each at its own price', () => {
    expect(now).toContain('that name no listing')
    expect(now).toContain('if v_sum is distinct from req.amount then')
    expect(now).toContain('but its lines add up to')
    expect(now).toContain('select case when count(distinct p.seller) = 1 then min(p.seller) end into v_seller')
    expect(now).toMatch(/l\.unit_price, l\.quantity, 'pending', 'placed',\s+l\.bundle_selection_id/)
  })

  it('ends with a self-check that reads back what was installed', () => {
    const tail = lower.slice(lower.lastIndexOf('do $$'))
    expect(tail).toContain('pg_get_functiondef')
    for (const s of ['credit_hold', 'does not say what it is buying', 'oid, prod.id, prod.name',
      'from orders where requisition_id = req.id',
      'req.product_id is null%and exists (select 1 from enterprise_requisition_lines l']) {
      expect(tail, s).toContain(s)
    }
  })

  it('has no bare CASE inside an IF or ELSIF condition', () => {
    const conds = ifConditions(code)
    expect(conds.length).toBeGreaterThan(10)
    expect(conds.filter(hasBareCase)).toEqual([])
  })

  it('gives every RAISE as many arguments as its message has placeholders', () => {
    const all = raises(code)
    expect(all.length).toBeGreaterThan(8)
    expect(all.filter((r) => r.placeholders !== r.args).map((r) => r.text)).toEqual([])
  })
})
