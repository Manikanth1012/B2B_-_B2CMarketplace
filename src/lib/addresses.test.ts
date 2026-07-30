import { describe, it, expect } from 'vitest'
import {
  formatAddress, defaultAddress, orderedAddresses,
  validateAddress, isValid, canDelete, type Address,
} from './addresses'

const addr = (o: Partial<Address> & { id: string }): Address => ({
  label: 'Home', line1: '42 Rustom Bagh, HAL Old Airport Road', city: 'Bengaluru',
  pin: '560017', phone: '+91 98860 41127', notes: null, is_default: false, ...o,
})

describe('formatAddress', () => {
  it('reads as one line', () => {
    expect(formatAddress(addr({ id: 'AD-1' })))
      .toBe('42 Rustom Bagh, HAL Old Airport Road, Bengaluru, 560017')
  })

  it('skips a missing part rather than leaving a stray comma', () => {
    expect(formatAddress({ line1: 'Somewhere', city: '', pin: '560017' })).toBe('Somewhere, 560017')
  })
})

describe('defaultAddress', () => {
  it('picks the one marked default', () => {
    const chosen = defaultAddress([
      addr({ id: 'AD-2', label: 'Work' }),
      addr({ id: 'AD-1', is_default: true }),
    ])
    expect(chosen?.id).toBe('AD-1')
  })

  it('uses the only address when there is exactly one', () => {
    expect(defaultAddress([addr({ id: 'AD-9' })])?.id).toBe('AD-9')
  })

  /* Never "the first row". Row order is whatever the database felt like, and
     silently shipping to an arbitrary address is the worst failure here. */
  it('refuses to guess between several with no default', () => {
    expect(defaultAddress([addr({ id: 'AD-1' }), addr({ id: 'AD-2' })])).toBeNull()
  })

  it('copes with an empty book', () => {
    expect(defaultAddress([])).toBeNull()
  })
})

describe('orderedAddresses', () => {
  it('puts the default first, then sorts by label so the list is stable', () => {
    const out = orderedAddresses([
      addr({ id: 'AD-3', label: 'Warehouse' }),
      addr({ id: 'AD-2', label: 'Work' }),
      addr({ id: 'AD-1', label: 'Home', is_default: true }),
    ])
    expect(out.map(a => a.label)).toEqual(['Home', 'Warehouse', 'Work'])
  })

  it('does not mutate what it is given', () => {
    const input = [addr({ id: 'AD-2', label: 'Work' }), addr({ id: 'AD-1', is_default: true })]
    orderedAddresses(input)
    expect(input[0].id).toBe('AD-2')
  })
})

describe('validateAddress', () => {
  it('accepts a complete address', () => {
    expect(isValid({ label: 'Home', line1: '42 Rustom Bagh', city: 'Bengaluru', pin: '560017' })).toBe(true)
  })

  it('names each missing field', () => {
    const problems = validateAddress({})
    expect(problems.map(p => p.field).sort()).toEqual(['city', 'label', 'line1', 'pin'])
  })

  it('treats whitespace as missing', () => {
    expect(validateAddress({ label: '  ', line1: '  ', city: ' ', pin: ' ' })).toHaveLength(4)
  })

  /* The marketplace ships to India, the UAE and Kenya — 6, 5-6 and 5 digits. A strict
     Indian PIN pattern would reject two of the three countries it claims to serve. */
  it('accepts postcodes from every region the marketplace serves', () => {
    for (const pin of ['560017', '00100', '12345', 'M1 1AE']) {
      expect(validateAddress({ label: 'X', line1: 'X', city: 'X', pin }), pin).toHaveLength(0)
    }
  })

  it('still rejects something that is plainly not a postcode', () => {
    const problems = validateAddress({ label: 'X', line1: 'X', city: 'X', pin: 'no!' })
    expect(problems.map(p => p.field)).toEqual(['pin'])
  })

  it('does not require a phone or a note', () => {
    expect(isValid({ label: 'Home', line1: '42', city: 'Bengaluru', pin: '560017', phone: null, notes: null })).toBe(true)
  })
})

describe('canDelete', () => {
  const home = addr({ id: 'AD-1', is_default: true })
  const work = addr({ id: 'AD-2', label: 'Work' })

  it('allows removing a non-default address', () => {
    expect(canDelete(work, [home, work])).toBe(true)
  })

  /* Deleting the default while others remain leaves the book with no default and
     Checkout with no answer. */
  it('refuses to remove the default while others remain', () => {
    expect(canDelete(home, [home, work])).toBe(false)
  })

  it('allows emptying the book entirely', () => {
    expect(canDelete(home, [home])).toBe(true)
  })
})
