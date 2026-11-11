import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/* No network: the client, the price repo and the market are all stand-ins. */

/** A query builder that answers every chained call with itself and resolves to `result`. */
function query(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'contains', 'order']) q[m] = () => q
  q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad)
  return q
}

const CATEGORY = { id: 'phones', name: 'Phones', audiences: ['consumer'], sort_order: 1 }
const PRODUCT = {
  id: 'p1', name: 'Handset', category_id: 'phones', sub_category: 'Phones', status: 'live',
  audiences: ['consumer'], price: 100, currency: 'USD', stock: 'in_stock', seller: 'Aventa',
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => query({ data: table === 'categories' ? [CATEGORY] : [PRODUCT], error: null }),
  },
}))

const repo = vi.hoisted(() => ({
  loadPriceBookResult: vi.fn(),
  loadCopyBookResult: vi.fn(),
}))

vi.mock('../lib/moneyRepo', () => ({
  loadPriceBookResult: repo.loadPriceBookResult,
  loadCopyBookResult: repo.loadCopyBookResult,
  repriceAll: (products: unknown[]) => products,
}))

vi.mock('../lib/MarketContext', () => ({
  useMarket: () => ({
    market: { code: 'US', name: 'United States', currency: 'USD' },
    currency: { code: 'USD' },
    fmtIn: (n: number) => `$${n}`,
    fmt: (n: number) => `$${n}`,
  }),
}))

/* Bundles read their own tables; they are not what is under test. */
vi.mock('./bundles/BundleCard', () => ({ BundleCards: () => null }))

vi.mock('../lib/storefront', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/storefront')>()
  return { ...real, categoriesFor: (rows: unknown[]) => rows }
})

import { ProductGrid } from './ProductGrid'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const MESSAGE = "We couldn't load prices just now."

describe('ProductGrid price Retry', () => {
  it('says the prices failed rather than that nothing is on sale, and Retry reads them again', async () => {
    repo.loadCopyBookResult.mockResolvedValue({ ok: true, value: new Map() })
    repo.loadPriceBookResult
      .mockResolvedValueOnce({ ok: false, error: 'network down' })
      .mockResolvedValue({ ok: true, value: new Map() })

    const user = userEvent.setup()
    render(<ProductGrid onNavigate={() => {}} onAddToCart={() => {}} />)

    expect(await screen.findByText(MESSAGE)).toBeTruthy()
    expect(screen.queryByText('No products yet')).toBeNull()
    expect(repo.loadPriceBookResult).toHaveBeenCalledTimes(1)
    expect(repo.loadPriceBookResult).toHaveBeenCalledWith('USD')

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(repo.loadPriceBookResult).toHaveBeenCalledTimes(2)
    /* The second read worked, so the failure message goes. */
    await vi.waitFor(() => expect(screen.queryByText(MESSAGE)).toBeNull())
  })

  it('keeps offering Retry while the read keeps failing', async () => {
    repo.loadCopyBookResult.mockResolvedValue({ ok: true, value: new Map() })
    repo.loadPriceBookResult.mockResolvedValue({ ok: false, error: 'network down' })

    const user = userEvent.setup()
    render(<ProductGrid onNavigate={() => {}} onAddToCart={() => {}} />)

    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(repo.loadPriceBookResult).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(MESSAGE)).toBeTruthy()
  })
})
