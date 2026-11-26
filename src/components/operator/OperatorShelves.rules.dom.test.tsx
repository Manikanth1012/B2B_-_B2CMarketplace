/* The rule book can be written to: a rule is added as a draft, edited,
   activated, retired (off every shelf first) and, when nothing refers to it,
   deleted. A locked rule is never retired or deleted. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ShelfBook } from '../../lib/shelfPolicyRepo'
import type { PolicyRuleRow } from '../../lib/catalogue'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const repo = vi.hoisted(() => ({
  load: vi.fn(), create: vi.fn(), update: vi.fn(), status: vi.fn(), retire: vi.fn(), remove: vi.fn(),
}))
vi.mock('../../lib/shelfPolicyRepo', () => ({
  loadShelfBook: () => repo.load(),
  savePolicy: vi.fn(), setLevel: vi.fn(), setOpen: vi.fn(),
  createRule: (...a: unknown[]) => repo.create(...a),
  updateRule: (...a: unknown[]) => repo.update(...a),
  setRuleStatus: (...a: unknown[]) => repo.status(...a),
  retireRule: (...a: unknown[]) => repo.retire(...a),
  deleteRule: (...a: unknown[]) => repo.remove(...a),
}))

import { OperatorShelves } from './OperatorShelves'

const rule = (over: Partial<PolicyRuleRow>): PolicyRuleRow => ({
  id: 'PR-01', name: 'Price floor', descr: 'A retail price may not sit below the floor.', check_by: 'auto',
  basis: 'Commercial', owner: 'Commercial', evidence: null, blocks: true, status: 'active', locked: null,
  sort_order: 1, ...over,
})

const book = (): ShelfBook => ({
  categories: [{ id: 'devices', name: 'Devices', audience: 'B2C', blurb: '', open_to_buyers: true, sort_order: 1 } as ShelfBook['categories'][number]],
  policies: [],
  rules: [
    rule({}),
    rule({ id: 'PR-02', name: 'Sanctions screen', check_by: 'extern', locked: 'Required by law in every market.', sort_order: 2 }),
    rule({ id: 'PR-03', name: 'Battery transport', check_by: 'doc', evidence: 'UN38.3', status: 'draft', sort_order: 3 }),
  ],
  matrix: [
    { category_id: 'devices', rule_id: 'PR-01', level: 'enforce' },
    { category_id: 'devices', rule_id: 'PR-02', level: 'enforce' },
  ],
  listings: [],
  sellers: [],
})

beforeEach(() => {
  for (const f of Object.values(repo)) f.mockReset()
  repo.load.mockResolvedValue(book())
  for (const f of [repo.create, repo.update, repo.status, repo.retire, repo.remove]) f.mockResolvedValue({ ok: true })
})
afterEach(() => cleanup())

async function openRuleBook() {
  render(<OperatorShelves />)
  fireEvent.click(await screen.findByRole('button', { name: /Rule book/ }))
}

describe('the rule book', () => {
  it('adds a rule as a draft with the next id', async () => {
    await openRuleBook()
    fireEvent.click(screen.getByRole('button', { name: 'Add a rule' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Lithium batteries' } })
    fireEvent.change(within(dialog).getByLabelText(/What it requires/), { target: { value: 'Ships only with a UN38.3 test summary.' } })
    fireEvent.change(within(dialog).getByLabelText(/Owner/), { target: { value: 'Compliance' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add as a draft' }))
    await waitFor(() => expect(repo.create).toHaveBeenCalledTimes(1))
    const [id, form, sort] = repo.create.mock.calls[0] as [string, { name: string; check_by: string }, number]
    expect(id).toBe('PR-04')
    expect(form).toMatchObject({ name: 'Lithium batteries', check_by: 'manual' })
    expect(sort).toBe(4)
  })

  it('retires an applied rule through the repo, saying which shelves it leaves', async () => {
    await openRuleBook()
    fireEvent.click(screen.getByRole('button', { name: 'Retire Price floor' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/comes off Devices/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire the rule' }))
    await waitFor(() => expect(repo.retire).toHaveBeenCalledWith('PR-01'))
  })

  it('offers no retire or delete on a locked rule, and delete only on an unused draft', async () => {
    await openRuleBook()
    expect(screen.queryByRole('button', { name: 'Retire Sanctions screen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Sanctions screen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete Price floor' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Battery transport' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete for good' }))
    await waitFor(() => expect(repo.remove).toHaveBeenCalledWith('PR-03'))
  })

  it('activates a draft', async () => {
    await openRuleBook()
    fireEvent.click(screen.getByRole('button', { name: 'Activate Battery transport' }))
    await waitFor(() => expect(repo.status).toHaveBeenCalledWith('PR-03', 'active'))
  })
})
