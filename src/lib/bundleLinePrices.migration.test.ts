// 20261127300000, checked without a database: a bundle line carries its price.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261127300000_a_bundle_line_carries_its_price.sql', import.meta.url),
  'utf8',
)

describe('20261127300000_a_bundle_line_carries_its_price', () => {
  it('runs in one transaction', () => {
    expect(sql).toMatch(/^begin;/m)
    expect(sql.trimEnd()).toMatch(/commit;$/)
  })
  it('adds a nullable, positive unit_price, idempotently', () => {
    expect(sql).toMatch(/add column if not exists unit_price numeric\(12,2\);/)
    expect(sql).toMatch(/check \(unit_price is null or unit_price > 0\)/)
  })
  it('holds each line between its seller floor and its normal price', () => {
    expect(sql).toMatch(/new\.unit_price < v_floor/)
    expect(sql).toMatch(/new\.unit_price > v_price/)
    expect(sql).toMatch(/before insert or update of unit_price, component_id on public\.product_components/)
  })
  it('checks once per statement that fully priced bundles add up to their price', () => {
    expect(sql).toMatch(/after insert on public\.product_components\s+referencing new table as changed\s+for each statement/)
    expect(sql).toMatch(/after update on public\.product_components\s+referencing new table as changed\s+for each statement/)
    expect(sql).toMatch(/having bool_and\(c\.unit_price is not null\)/)
  })
  it('gives no existing bundle a price, and dry-runs its guards in rolled-back blocks', () => {
    /* Every write to product_components sits inside the self-check, after `do $$`. */
    const selfCheck = sql.indexOf('do $$')
    const writes = [...sql.matchAll(/update public\.product_components/g)].map(m => m.index!)
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every(i => i > selfCheck)).toBe(true)
    expect(sql).toMatch(/errcode = 'ZZ999'/)
    expect(sql).toMatch(/the dry runs left a price behind/)
  })
})
