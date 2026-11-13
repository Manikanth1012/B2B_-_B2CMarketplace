import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/* No network: the market is a stand-in and the bundle sinks, which reach the
   repos, are not what is under test. */
vi.mock('../lib/MarketContext', () => ({
  useMarket: () => ({
    market: { code: 'US', name: 'United States', currency: 'USD', tax_label: 'Tax', tax_rate: 0 },
    currency: { code: 'USD' },
    fmt: (n: number) => `$${n}`,
    fmtIn: (n: number) => `$${n}`,
  }),
}))
vi.mock('./bundles/sinks', () => ({ basketSink: {}, rebundle: vi.fn() }))

import { CartDrawer } from './CartDrawer'
import { Dialog } from './ui/Dialog'

const realGetClientRects = HTMLElement.prototype.getClientRects
beforeAll(() => {
  HTMLElement.prototype.getClientRects = function () {
    return [{ width: 1, height: 1 }] as unknown as DOMRectList
  }
})
afterAll(() => { HTMLElement.prototype.getClientRects = realGetClientRects })
afterEach(cleanup)

/** The drawer open first, then a dialog over it — as "Edit bundle" does. */
function DrawerWithDialog({ onCloseDrawer }: { onCloseDrawer: () => void }) {
  const [dialog, setDialog] = useState(false)
  return (
    <>
      <CartDrawer open items={[]} onClose={onCloseDrawer} onUpdateQuantity={() => {}}
        onRemove={() => {}} onCheckout={() => {}} onSetSaved={() => {}} />
      <button type="button" onClick={() => setDialog(true)}>Edit bundle</button>
      <Dialog open={dialog} onClose={() => setDialog(false)} title="Edit your bundle">
        <button type="button">Save</button>
      </Dialog>
    </>
  )
}

describe('CartDrawer under a dialog', () => {
  it('Escape closes only the dialog; the next Escape closes the drawer', async () => {
    const onCloseDrawer = vi.fn()
    const user = userEvent.setup()
    render(<DrawerWithDialog onCloseDrawer={onCloseDrawer} />)

    await user.click(screen.getByRole('button', { name: 'Edit bundle' }))
    expect(screen.getByRole('dialog', { name: 'Edit your bundle' })).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Edit your bundle' })).toBeNull()
    expect(onCloseDrawer).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onCloseDrawer).toHaveBeenCalledTimes(1)
  })
})

describe('CartDrawer with a stock flag', () => {
  const item = (over: Record<string, unknown>) => ({
    id: 'C-1', product_id: 'SKU-1', quantity: 3, created_at: '2026-11-01T00:00:00Z', saved: false,
    product: { id: 'SKU-1', name: 'Router', seller: 'Acme', price: 10, stock: 'low', status: 'live' },
    ...over,
  }) as never

  it('shows the note with Accept and Remove, and holds Checkout with a sentence', async () => {
    const accept = vi.fn().mockResolvedValue({ ok: true })
    const remove = vi.fn()
    const user = userEvent.setup()
    render(<CartDrawer open items={[item({ stock_note: 'Only 3 left — we reduced this from 5', was_quantity: 5 })]}
      onClose={() => {}} onUpdateQuantity={() => {}} onRemove={remove} onCheckout={() => {}} onSetSaved={() => {}}
      onAcceptFlag={accept} />)
    expect(screen.getByText(/Only 3 left — we reduced this from 5/)).toBeTruthy()
    expect(screen.getByText('1 line changed because stock ran out. Accept or remove it before you place this order.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Checkout' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Accept the change to Router' }))
    expect(accept).toHaveBeenCalledWith('C-1')
    await user.click(screen.getByRole('button', { name: 'Remove Router from your cart' }))
    expect(remove).toHaveBeenCalledWith('C-1')
  })

  it('a line no longer available offers only Remove', () => {
    render(<CartDrawer open items={[item({ stock_note: 'No longer available' })]}
      onClose={() => {}} onUpdateQuantity={() => {}} onRemove={() => {}} onCheckout={() => {}} onSetSaved={() => {}}
      onAcceptFlag={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove Router from your cart' })).toBeTruthy()
  })
})
