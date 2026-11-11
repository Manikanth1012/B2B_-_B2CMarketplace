import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const put = vi.fn()
vi.mock('../../lib/bundleBasketRepo', () => ({
  putBundleInCart: (...a: unknown[]) => put(...a),
  loadBundleInfo: vi.fn(),
}))
vi.mock('../../lib/bundleRepo', () => ({ configureBundle: vi.fn() }))
vi.mock('../../lib/enquiryRepo', () => ({ loadQuotedProducts: vi.fn() }))
vi.mock('../../lib/RequisitionContext', () => ({ addBundleToRequisition: vi.fn() }))

const changed = vi.fn()
vi.mock('./events', () => ({ bundlesChanged: () => changed() }))

import { basketSink } from './sinks'

/* The basket must reload whenever its rows changed — above all when a replace
   put the new bundle in and could not take the old one out, or checkout would
   order from a list missing a bundle that is really there. */
describe('basketSink', () => {
  beforeEach(() => { put.mockReset(); changed.mockReset() })
  afterEach(() => vi.clearAllMocks())

  it('reloads after a clean add', async () => {
    put.mockResolvedValue({ ok: true })
    expect(await basketSink('BS-2', 'BS-1')).toEqual({ ok: true })
    expect(put).toHaveBeenCalledWith('BS-2', 'BS-1')
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('reloads, and says so, when the new bundle went in but the old one stayed', async () => {
    const error = 'Both bundles are now in your basket: the new one went in, but the old one could not be taken out (x). Remove the old one before you check out.'
    put.mockResolvedValue({ ok: false, changed: true, error })
    expect(await basketSink('BS-2', 'BS-1')).toEqual({ ok: false, error })
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('does not reload when nothing was written', async () => {
    put.mockResolvedValue({ ok: false, changed: false, error: 'That bundle is already in your basket.' })
    expect(await basketSink('BS-2')).toEqual({ ok: false, error: 'That bundle is already in your basket.' })
    expect(changed).not.toHaveBeenCalled()
  })
})
