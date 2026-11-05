import { describe, it, expect } from 'vitest'
import { settle } from './loaded'

describe('settle', () => {
  it('turns a read error into a failed result carrying the message', () => {
    expect(settle<number[]>(null, { message: 'boom' }, [])).toEqual({ ok: false, error: 'boom' })
  })
  it('an error wins even when data came back too', () => {
    expect(settle([1], { message: 'partial' }, [])).toEqual({ ok: false, error: 'partial' })
  })
  it('null data with no error is a successful empty read', () => {
    const empty: number[] = []
    expect(settle<number[]>(null, null, empty)).toEqual({ ok: true, value: empty })
  })
  it('data with no error passes through', () => {
    expect(settle([1, 2], null, [])).toEqual({ ok: true, value: [1, 2] })
  })
})
