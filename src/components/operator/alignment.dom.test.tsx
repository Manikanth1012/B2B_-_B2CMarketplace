import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { DateRangeFilter, FieldRow, FilterBar, FormField, PageHeader, RowActions, Table, Td, TextInput, Btn, daysBefore } from './shared'
import { KpiCard, KpiRow } from '../ui/KpiCard'
import { Dialog } from '../ui/Dialog'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const cell = (text: string) => screen.getByText(text).closest('td') as HTMLTableCellElement

describe('Td kinds (rules 1 and 3)', () => {
  it('num is right, tabular and one line; status, date and id are left and one line; text wraps', () => {
    render(
      <table><tbody><tr>
        <Td kind="num">$41,871.56</Td>
        <Td kind="status">Paid</Td>
        <Td kind="date">02 Nov 2026</Td>
        <Td kind="id">INV-2026-0779</Td>
        <Td kind="text">Northwind Traders</Td>
      </tr></tbody></table>,
    )
    const num = cell('$41,871.56')
    expect(num.style.textAlign).toBe('right')
    expect(num.className).toContain('c-td--num')
    expect(num.style.whiteSpace).toBe('nowrap')
    for (const t of ['Paid', '02 Nov 2026', 'INV-2026-0779']) {
      expect(cell(t).style.textAlign).toBe('left')
      expect(cell(t).style.whiteSpace).toBe('nowrap')
    }
    expect(cell('Northwind Traders').style.whiteSpace).toBe('normal')
  })

  it('keeps existing callers: right is nowrap unless bounded; plain is left and wraps', () => {
    render(<table><tbody><tr><Td right>12</Td><Td right style={{ maxWidth: 200 }}>Why</Td><Td>Plain</Td></tr></tbody></table>)
    expect(cell('12').style.whiteSpace).toBe('nowrap')
    expect(cell('Why').style.whiteSpace).toBe('normal')
    expect(cell('Plain').style.textAlign).toBe('left')
  })

  it('nowrap can be set or overridden explicitly', () => {
    render(<table><tbody><tr><Td nowrap>Long name</Td><Td kind="num" nowrap={false}>9</Td></tr></tbody></table>)
    expect(cell('Long name').style.whiteSpace).toBe('nowrap')
    expect(cell('9').style.whiteSpace).toBe('normal')
  })

  it('clamp wraps to two lines with the whole text as the hover title', () => {
    render(<table><tbody><tr><Td clamp>A very long account name that wraps</Td><Td clamp={3} title="Full note"><b>Rich</b></Td></tr></tbody></table>)
    const td = screen.getByText('A very long account name that wraps').closest('td')!
    expect(td.getAttribute('title')).toBe('A very long account name that wraps')
    const inner = td.querySelector('.c-td__clamp') as HTMLElement
    expect(inner.style.webkitLineClamp || inner.style.getPropertyValue('-webkit-line-clamp')).toBe('2')
    expect(screen.getByText('Rich').closest('td')!.getAttribute('title')).toBe('Full note')
  })
})

describe('Table headers (rules 2 and 4)', () => {
  it('takes alignment from cells, including kind="num"', () => {
    render(<Table headers={['Name', 'Total']}><tr><Td>A</Td><Td kind="num">1</Td></tr></Table>)
    expect(screen.getByRole('columnheader', { name: 'Total' }).style.textAlign).toBe('right')
    expect(screen.getByRole('columnheader', { name: 'Name' }).style.textAlign).toBe('left')
  })

  it('warns in development when an explicit align contradicts the cells, and still honours it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Table headers={['Name', { label: 'Status', align: 'right' }]}><tr><Td>A</Td><Td kind="status">Paid</Td></tr></Table>)
    expect(screen.getByRole('columnheader', { name: 'Status' }).style.textAlign).toBe('right')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Status" header is aligned right but its cells are left'))
  })

  it('does not warn when the explicit align agrees', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Table headers={['Name', { label: 'Amount', align: 'right' }]}><tr><Td>A</Td><Td right>1</Td></tr></Table>)
    expect(warn).not.toHaveBeenCalled()
  })

  it('an "Actions" header is visually hidden but named; a blank header is left alone', () => {
    const { container, rerender } = render(<Table headers={['Name', 'Actions']}><tr><Td>A</Td><Td>x</Td></tr></Table>)
    const th = screen.getByRole('columnheader', { name: 'Actions' })
    expect(th.className).toContain('c-th--actions')
    expect(th.querySelector('.sr-only')?.textContent).toBe('Actions')
    rerender(<Table headers={['Name', '']}><tr><Td>A</Td><Td>x</Td></tr></Table>)
    expect(container.querySelectorAll('.c-th--actions')).toHaveLength(0)
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull()
  })

  it('only a cell holding RowActions shrinks to fit: an unmigrated actions column keeps its width', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/console.css'), 'utf8')
    expect(css).toMatch(/\.c-table td:has\(> \.c-row-actions\) \{ width: 1%; \}/)
    expect(css).not.toMatch(/c-th--actions[^{]*\{[^}]*width/)
    render(<Table headers={['Name', 'Actions']}><tr><Td>A</Td><Td><div className="tb-actions"><Btn size="sm">Edit</Btn></div></Td></tr></Table>)
    const th = screen.getByRole('columnheader', { name: 'Actions' })
    expect(th.getAttribute('style')).toBeNull()
  })
})

describe('RowActions', () => {
  it('draws up to two actions as small buttons, right-aligned', async () => {
    const view = vi.fn()
    const { container } = render(<RowActions actions={[{ label: 'View', onClick: view }, false, { label: 'Edit', onClick: () => {} }]} />)
    expect(container.querySelector('.c-row-actions')).toBeTruthy()
    const btns = screen.getAllByRole('button')
    expect(btns.map(b => b.textContent)).toEqual(['View', 'Edit'])
    expect(btns[0].className).toContain('c-btn--sm')
    await userEvent.click(btns[0])
    expect(view).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull()
  })

  it('puts the rest in a keyboard-operable More menu named for the row', async () => {
    const voidIt = vi.fn()
    const pdf = vi.fn()
    render(<RowActions label="INV-1" actions={[
      { label: 'View', onClick: () => {} }, { label: 'Edit', onClick: () => {} },
      { label: 'Download PDF', onClick: pdf }, { label: 'Void', variant: 'danger', onClick: voidIt },
    ]} />)
    const more = screen.getByRole('button', { name: 'More actions for INV-1' })
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    expect(more.getAttribute('aria-expanded')).toBe('false')

    more.focus()
    await userEvent.keyboard('{ArrowDown}')
    const menu = screen.getByRole('menu', { name: 'More actions for INV-1' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map(i => i.textContent)).toEqual(['Download PDF', 'Void'])
    expect(document.activeElement).toBe(items[0])
    expect(items[1].className).toContain('ui-menu__item--danger')

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[0])
    await userEvent.keyboard('{End}{Enter}')
    expect(voidIt).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more)

    await userEvent.click(more)
    expect(screen.getByRole('menu')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more)

    await userEvent.click(more)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download PDF' }))
    expect(pdf).toHaveBeenCalledTimes(1)
  })

  it('Tab out of the menu returns focus to the button rather than off the page or round a dialog', async () => {
    render(
      <Dialog open onClose={() => {}} title="Row">
        <button type="button">First</button>
        <RowActions label="R" actions={[{ label: 'A', onClick: () => {} }, { label: 'B', onClick: () => {} }, { label: 'C', onClick: () => {} }]} />
        <button type="button">After</button>
      </Dialog>,
    )
    const more = screen.getByRole('button', { name: 'More actions for R' })
    await userEvent.click(more)
    expect(document.activeElement?.textContent).toBe('C')
    await userEvent.tab()
    expect(screen.queryByRole('menu')).toBeNull()
    expect([more, screen.getByRole('button', { name: 'After' })]).toContain(document.activeElement)
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.textContent).not.toBe('First')
  })

  it('keys pressed on its buttons do not reach the row', () => {
    const rowKey = vi.fn()
    render(<table><tbody><tr onKeyDown={rowKey}><td><RowActions actions={[{ label: 'A', onClick: () => {} }, { label: 'B', onClick: () => {} }, { label: 'C', onClick: () => {} }]} /></td></tr></tbody></table>)
    fireEvent.keyDown(screen.getByRole('button', { name: 'A' }), { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'ArrowDown' })
    expect(rowKey).not.toHaveBeenCalled()
  })

  it('closes on a press outside', async () => {
    render(<div><span>outside</span><RowActions actions={[{ label: 'A', onClick: () => {} }, { label: 'B', onClick: () => {} }, { label: 'C', onClick: () => {} }]} /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('FilterBar', () => {
  it('renders a labelled search, the filters, actions and a live summary', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <FilterBar search={{ value: '', onChange, placeholder: 'Search jobs', ariaLabel: 'Search jobs' }}
        actions={<Btn>Export</Btn>} summary="14 nights, 140 runs">
        <select aria-label="Status"><option>All</option></select>
      </FilterBar>,
    )
    expect(screen.getByRole('group', { name: 'Filters' })).toBeTruthy()
    const search = screen.getByRole('searchbox', { name: 'Search jobs' })
    await userEvent.type(search, 'x')
    expect(onChange).toHaveBeenCalledWith('x')
    expect(container.querySelector('.c-filterbar__filters select')).toBeTruthy()
    expect(container.querySelector('.c-filterbar__actions')?.textContent).toBe('Export')
    expect(screen.getByText('14 nights, 140 runs').getAttribute('aria-live')).toBe('polite')
  })

  it('omits the parts it is not given', () => {
    const { container } = render(<FilterBar><span>f</span></FilterBar>)
    expect(container.querySelector('.c-filterbar__search')).toBeNull()
    expect(container.querySelector('.c-filterbar__actions')).toBeNull()
    expect(container.querySelector('.c-filterbar__summary')).toBeNull()
  })
})

describe('DateRangeFilter', () => {
  it('edits from and to, and quick picks set a range ending today', async () => {
    const onChange = vi.fn()
    render(<DateRangeFilter from="2026-11-14" to="2026-11-27" today="2026-11-27" onChange={onChange} quickLabel={n => `${n} nights`} />)
    expect(screen.getByRole('group', { name: 'Date range' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } })
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-11-01', to: '2026-11-27' })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-20' } })
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-11-14', to: '2026-11-20' })

    expect(screen.getByRole('button', { name: '14 nights' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '7 nights' }).getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(screen.getByRole('button', { name: '7 nights' }))
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-11-21', to: '2026-11-27' })
    await userEvent.click(screen.getByRole('button', { name: '30 nights' }))
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-29', to: '2026-11-27' })
  })

  it('daysBefore crosses month and year ends', () => {
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28')
    expect(daysBefore('2027-01-03', 5)).toBe('2026-12-29')
  })
})

describe('FormField compact and FieldRow (rule 6)', () => {
  it('compact drops the bottom margin class; the label still points at the input', () => {
    const { container } = render(<FormField compact label="Search"><TextInput /></FormField>)
    expect(container.querySelector('.c-field')?.className).toContain('c-field--compact')
    expect(screen.getByLabelText('Search')).toBeTruthy()
  })

  it('FieldRow holds fields and buttons in one row', () => {
    const { container } = render(
      <FieldRow><FormField label="Search"><TextInput /></FormField><Btn size="sm">Go</Btn></FieldRow>,
    )
    const row = container.querySelector('.c-field-row')!
    expect(row.querySelector(':scope > .c-field')).toBeTruthy()
    expect(row.querySelector(':scope > .c-btn')).toBeTruthy()
  })
})

describe('PageHeader (rule 8)', () => {
  it('renders the title as a heading, the description and the actions', () => {
    const { container } = render(<PageHeader title="Scheduled jobs" description="What ran overnight." actions={<Btn>Run now</Btn>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Scheduled jobs' })).toBeTruthy()
    expect(screen.getByText('What ran overnight.')).toBeTruthy()
    expect(container.querySelector('.c-page-head__actions')?.textContent).toBe('Run now')
  })
  it('can sit under another h1', () => {
    render(<PageHeader level={2} title="Inner" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Inner' })).toBeTruthy()
  })
})

describe('KpiCard breakdown and KpiRow (rule 9)', () => {
  it('lists other currencies code-left, amount-right, under one headline', () => {
    const { container } = render(
      <KpiCard label="Owed and committed" value="$412,880" breakdown={[{ label: 'EUR', value: '€86,140' }, { label: 'GBP', value: '£12,400' }]} status="3 accounts over limit" context="Across 38 accounts" />,
    )
    expect(container.querySelector('.kpi-card__value')?.textContent).toBe('$412,880')
    const rows = container.querySelectorAll('.kpi-card__breakdown-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('dt')?.textContent).toBe('EUR')
    expect(rows[0].querySelector('dd')?.textContent).toBe('€86,140')
    expect(container.querySelector('.kpi-card__status')?.textContent).toBe('3 accounts over limit')
    expect(container.querySelector('.kpi-card__foot .kpi-card__context')?.textContent).toBe('Across 38 accounts')
  })
  it('existing callers render as before (no breakdown, no foot without context)', () => {
    const { container } = render(<KpiCard label="Tier" value="Gold" />)
    expect(container.querySelector('.kpi-card__breakdown')).toBeNull()
    expect(container.querySelector('.kpi-card__foot')).toBeNull()
  })
  it('KpiRow wraps the cards in one grid', () => {
    const { container } = render(<KpiRow label="Headline figures"><KpiCard label="A" value="1" /><KpiCard label="B" value="2" /></KpiRow>)
    expect(screen.getByRole('group', { name: 'Headline figures' })).toBeTruthy()
    expect(container.querySelectorAll('.kpi-row > .kpi-card')).toHaveLength(2)
  })
})
