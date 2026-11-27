import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { Table, Td, TableRow, EmptyState } from './shared'
import { Skeleton } from '../ui/Skeleton'
import { KpiCard } from '../ui/KpiCard'
import { StatusBadge } from '../ui/StatusBadge'

afterEach(cleanup)

describe('Table sorting', () => {
  it('renders a sort button with aria-sort and fires onSort', async () => {
    const onSort = vi.fn()
    render(
      <Table headers={[{ label: 'Name', sort: { active: true, dir: 'desc', onSort } }, { label: 'Total', sort: { active: false, dir: 'asc', onSort: () => {} } }]}>
        <tr><Td>A</Td><Td right>1</Td></tr>
      </Table>,
    )
    const th = screen.getByRole('columnheader', { name: /Name/ })
    expect(th.getAttribute('aria-sort')).toBe('descending')
    expect(screen.getByRole('columnheader', { name: /Total/ }).getAttribute('aria-sort')).toBe('none')
    expect(screen.getByRole('columnheader', { name: /Total/ }).style.textAlign).toBe('right')
    await userEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(onSort).toHaveBeenCalledTimes(1)
  })

  it('leaves plain headers as text with no aria-sort', () => {
    render(<Table headers={['Name']}><tr><Td>A</Td></tr></Table>)
    expect(screen.getByRole('columnheader', { name: 'Name' }).hasAttribute('aria-sort')).toBe(false)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('marks a selected row', () => {
    render(<Table headers={['Name']}><TableRow selected><Td>A</Td></TableRow></Table>)
    expect(screen.getByRole('row', { selected: true })).toBeTruthy()
  })
})

describe('v2 pieces', () => {
  it('status badge keeps its words and hides the dot', () => {
    const { container } = render(<StatusBadge tone="danger">Overdue</StatusBadge>)
    expect(screen.getByText('Overdue')).toBeTruthy()
    expect(container.querySelector('.status-badge__dot')?.getAttribute('aria-hidden')).toBe('true')
  })
  it('KPI sparkline needs two points; risk variant is a class', () => {
    const { container, rerender } = render(<KpiCard label="Overdue" value="3" variant="risk" series={[1]} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('.kpi-card--risk')).toBeTruthy()
    rerender(<KpiCard label="Overdue" value="3" series={[1, 3, 2]} />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
  it('skeleton is hidden from assistive tech', () => {
    const { container } = render(<Skeleton lines={3} />)
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelectorAll('.skeleton').length).toBe(3)
  })
  it('empty state shows title, message and action', () => {
    render(<EmptyState title="No orders" message="Orders appear here." action={<button>Add</button>} />)
    expect(screen.getByText('No orders')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })
})
