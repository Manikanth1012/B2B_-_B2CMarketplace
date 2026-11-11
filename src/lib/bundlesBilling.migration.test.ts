// The migration that holds a business bundle to one billing model, checked
// without a database (the user applies it by hand). 20261105200000 is applied
// and stays as it is; this file replaces bundle_template_problem with the same
// signature, every old check kept in its order and words, and one more — and
// rebuilds the seeded office kit as one-off only.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sql = read('20261111100000_a_business_bundle_is_billed_one_way.sql')
const applied = read('20261105200000_a_buyer_builds_the_bundle.sql')

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

/** One function's source, from `create or replace function name(` to its closing `$$;`. */
function fn(src: string, name: string): string {
  const m = src.match(new RegExp(`create or replace function ${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`))
  expect(m, name).not.toBeNull()
  return m![0]
}

/** The sentences a function returns, in order. */
const returned = (body: string) => [...body.matchAll(/return (format\()?'([^']*)'/g)].map(m => m[2])

describe('a business bundle is billed one way', () => {
  const now = fn(lower, 'bundle_template_problem')
  const before = fn(stripComments(applied).toLowerCase(), 'bundle_template_problem')

  it('replaces bundle_template_problem with the same signature, and keeps it internal', () => {
    const head = 'create or replace function bundle_template_problem(p_template text, p_audiences text[]) returns text\n' +
      'language plpgsql stable security definer set search_path = public as $$'
    expect(before.startsWith(head)).toBe(true)
    expect(now.startsWith(head)).toBe(true)
    expect(lower).toContain('revoke all on function bundle_template_problem(text, text[]) from public, anon, authenticated;')
  })

  it('keeps every check it had, in the same order and words, then adds the billing rule', () => {
    const old = returned(before)
    const all = returned(now)
    expect(old.length).toBeGreaterThan(8)
    expect(all.slice(0, old.length)).toEqual(old)
    // the old body, line for line, up to its final return
    const oldBody = before.slice(0, before.lastIndexOf('return null;'))
      .split('\n').filter(l => l.trim() !== '' && !/^\s*v_\w+\s+\w+;$/.test(l) && !l.includes('create or replace'))
    const newBody = now.split('\n')
    expect(oldBody.length).toBeGreaterThan(50)
    let at = 0
    for (const line of oldBody) {
      const i = newBody.indexOf(line, at)
      expect(i, line).toBeGreaterThanOrEqual(at)
      at = i + 1
    }
  })

  it('applies the billing rule only to business buyers, over every option, naming the models', () => {
    expect(now).toContain("if 'enterprise' = any(p_audiences) then")
    expect(now).toContain('select count(distinct p.model) into v_n')
    expect(now).toContain('if v_n > 1 then')
    expect(now).toContain("'a bundle for business buyers is billed one way, and this one mixes ' || v_m || ' parts: ' || v_s || '.'")
    expect(now.indexOf('billed one way')).toBeGreaterThan(now.indexOf('the default configuration has no price for'))
  })

  it('rebuilds the office kit as one-off only, by its seed ids, through the publish check', () => {
    const draft = lower.indexOf("update bundle_templates set status = 'draft' where id = 'bt-seed-office' and status <> 'draft';")
    const del = lower.indexOf("delete from bundle_slots where template_id = 'bt-seed-office';")
    const live = lower.indexOf("update bundle_templates set status = 'live' where id = 'bt-seed-office';")
    expect(draft).toBeGreaterThan(-1)
    expect(del).toBeGreaterThan(draft)
    expect(live).toBeGreaterThan(del)
    expect(lower).toContain("('bs-seed-office-1', 'bt-seed-office', 'sensors and trackers', 1, 2, 5, 100, 20, 1)")
    expect(lower).toContain("('bs-seed-office-2', 'bt-seed-office', 'gateway',              1, 1, 1,   5,  1, 2)")
    expect(lower).toContain("('bo-seed-office-1-1', 'bs-seed-office-1', 'sku-5003', true,  1)")
    expect(lower).toContain("('bo-seed-office-1-2', 'bs-seed-office-1', 'sku-5005', false, 2)")
    expect(lower).toContain("('bo-seed-office-2-1', 'bs-seed-office-2', 'sku-5007', true,  1)")
    expect(lower).toContain("'draft', array['enterprise'], 8.00)")
    // no SIMs, no firewall, and the home bundle untouched
    for (const gone of ['sku-5001', 'sku-5002', 'sku-6001', 'bt-seed-home']) expect(lower).not.toContain(gone)
    // keeps the name, says what it now is
    expect(code).toContain("'Smart office starter kit'")
    expect(code).not.toMatch(/SIMs to connect/)
    // fails loudly if a listing is not on sale or not one-off
    expect(lower).toContain("or p.model <> 'oneoff'")
  })

  it('checks itself: every live business template passes, the kit is live with two parts and prices one way everywhere', () => {
    expect(lower).toContain("where t.status = 'live' and bundle_template_problem(t.id, t.audiences) is not null")
    expect(lower).toContain("group by t.id having count(distinct p.model) > 1")
    expect(lower).toContain("if n <> 2 then raise exception 'expected 2 parts in the office kit, found %', n; end if;")
    expect(lower).toContain("for c in select distinct currency from market_currencies order by 1 loop")
    expect(lower).toContain("price_bundle('bt-seed-office', bundle_default_choices('bt-seed-office'), c, 1)")
    expect(lower).toContain("its default parts are billed % ways")
  })

  it('never drops a table without "if exists", and drops nothing it does not recreate', () => {
    const drops = [...lower.matchAll(/drop table\s+(\S+)/g)].map((m) => m[1])
    for (const d of drops) expect(d).toBe('if')
    expect(lower).not.toMatch(/drop function/)
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
