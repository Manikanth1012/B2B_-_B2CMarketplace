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
