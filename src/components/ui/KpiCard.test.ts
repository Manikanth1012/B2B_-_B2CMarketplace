import { describe, expect, it } from 'vitest'
import { groupsToKpi } from './KpiCard'

const fmt = (n: number, c: string) => `${c} ${n}`
const g = (currency: string, amount: number) => ({ currency, total: { amount } })

describe('groupsToKpi', () => {
  it('ranks by nominal amount without a converter, and returns the unit', () => {
    const r = groupsToKpi([g('USD', 90000), g('INR', 400000)], fmt)
    expect(r.value).toBe('INR 400000')
    expect(r.unit).toBe('INR')
    expect(r.breakdown).toEqual([{ label: 'USD', value: 'USD 90000' }])
  })
  it('ranks by the converter when given one', () => {
    const toBase = (a: number, c: string) => (c === 'INR' ? a / 83 : a)
    const r = groupsToKpi([g('USD', 90000), g('INR', 400000)], fmt, '—', toBase)
    expect(r.value).toBe('USD 90000')
    expect(r.unit).toBe('USD')
  })
  it('falls back to nominal for the whole card when any currency has no rate (or rates are still loading)', () => {
    const partial = (a: number, c: string) => (c === 'USD' ? a : NaN)
    const r = groupsToKpi([g('USD', 90000), g('INR', 400000), g('KES', 5)], fmt, '—', partial)
    expect(r.value).toBe('INR 400000')
    expect(r.breakdown?.map(b => b.label)).toEqual(['USD', 'KES'])
  })
  it('says dash for nothing', () => {
    expect(groupsToKpi([], fmt)).toEqual({ value: '—' })
  })
  it('loses nothing and double counts nothing', () => {
    const r = groupsToKpi([g('A', 1), g('B', 3), g('C', 2)], fmt)
    const shown = [r.value, ...(r.breakdown ?? []).map(b => b.value)].sort()
    expect(shown).toEqual(['A 1', 'B 3', 'C 2'])
  })
})
