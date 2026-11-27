import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { BundleBuilder } from './OperatorCatalogue'
import type { CatalogueSnapshot, BundleDraft } from '../../lib/catalogueRepo'

afterEach(cleanup)

const product = (id: string, name: string, price: number, floor: number) => ({
  id, name, price, floor_price: floor, list_price: price, seller: 'Seller ' + id, partner_id: 'P-' + id,
  status: 'live', category_id: 'c1',
})

const snap = {
  categories: [{ id: 'c1', name: 'Consumer' }],
  components: [],
  products: [
    product('A', 'StreamNova Standard', 7.99, 7.19),
    product('B', 'Device Protect', 6.9, 6.21),
    product('C', 'Volta Mesh Wi-Fi 6', 229, 182.8),
  ],
} as unknown as CatalogueSnapshot

function setup() {
  const onCreate = vi.fn<(d: BundleDraft) => void>()
  render(<BundleBuilder snap={snap} onClose={() => {}} onCreate={onCreate} />)
  return { onCreate, user: userEvent.setup() }
}

async function add(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(name) }))
}

describe('Compose a bundle, priced line by line', () => {
  it('starts each line at its normal price and adds the lines up into the bundle price', async () => {
    const { user } = setup()
    await add(user, 'StreamNova Standard')
    await add(user, 'Volta Mesh')
    expect((screen.getByLabelText('Price in bundle for StreamNova Standard') as HTMLInputElement).value).toBe('7.99')
    expect(screen.getByTestId('bundle-price').textContent).toBe('$236.99')
    /* No discount yet: not a bundle, so it cannot be created. */
    await user.type(screen.getByLabelText(/Bundle name/), 'Home kit')
    expect((screen.getByRole('button', { name: 'Create and publish' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lets each product be priced down to its seller floor, and creates with the per-line prices', async () => {
    const { user, onCreate } = setup()
    await add(user, 'StreamNova Standard')
    await add(user, 'Volta Mesh')
    await user.type(screen.getByLabelText(/Bundle name/), 'Home kit')
    const volta = screen.getByLabelText('Price in bundle for Volta Mesh Wi-Fi 6')
    await user.clear(volta)
    await user.type(volta, '210')
    expect(screen.getByTestId('bundle-price').textContent).toBe('$217.99')
    await user.click(screen.getByRole('button', { name: 'Create and publish' }))
    const draft = onCreate.mock.calls[0][0]
    expect(draft.price).toBe(217.99)
    expect(draft.components.map(c => [c.productId, c.unitPrice])).toEqual([['A', 7.99], ['C', 210]])
  })

  it('refuses a line below its seller floor and says which', async () => {
    const { user } = setup()
    await add(user, 'StreamNova Standard')
    await add(user, 'Device Protect')
    await user.type(screen.getByLabelText(/Bundle name/), 'Kit')
    const sn = screen.getByLabelText('Price in bundle for StreamNova Standard')
    await user.clear(sn)
    await user.type(sn, '7')
    expect(sn.getAttribute('aria-invalid')).toBe('true')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/no lower than \$7\.19/)
    expect(sn.getAttribute('aria-describedby')).toBe(alert.id)
    expect((screen.getByRole('button', { name: 'Create and publish' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('applies a percentage to every line, stopping at each floor', async () => {
    const { user } = setup()
    await add(user, 'StreamNova Standard')
    await add(user, 'Volta Mesh')
    const pct = screen.getByLabelText('Apply % off to all')
    await user.clear(pct)
    await user.type(pct, '20')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect((screen.getByLabelText('Price in bundle for StreamNova Standard') as HTMLInputElement).value).toBe('7.19')
    expect((screen.getByLabelText('Price in bundle for Volta Mesh Wi-Fi 6') as HTMLInputElement).value).toBe('183.20')
    expect(screen.getByTestId('bundle-price').textContent).toBe('$190.39')
    const line = screen.getByLabelText('Price in bundle for Volta Mesh Wi-Fi 6').closest('.bundle-line') as HTMLElement
    expect(within(line).getByText('−20%')).toBeTruthy()
  })
})
