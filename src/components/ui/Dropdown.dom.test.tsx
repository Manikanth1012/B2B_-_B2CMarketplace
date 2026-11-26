import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dropdown, parseOptions } from './Dropdown'
import { FormField, Select } from '../operator/shared'

afterEach(cleanup)

const FRUIT = ['Apple', 'Banana', 'Cherry']

function Controlled({ onChange = () => {}, initial = 'b', disabled, extra }: {
  onChange?: (v: string, e: unknown) => void; initial?: string; disabled?: boolean; extra?: boolean
}) {
  const [v, setV] = useState(initial)
  return (
    <>
      <label htmlFor="fruit">Fruit</label>
      <Dropdown id="fruit" name="fruit" value={v} disabled={disabled}
        onChange={e => { setV(e.target.value); onChange(e.target.value, e) }}>
        <option value="a">Apple</option>
        <option value="b">Banana</option>
        <option value="x" disabled>Blackberry (sold out)</option>
        <option value="c">Cherry</option>
        {extra && <option value="d">Date</option>}
      </Dropdown>
      <button type="button">After</button>
    </>
  )
}

const combo = () => screen.getByRole('combobox', { name: 'Fruit' })
const listbox = () => screen.getByRole('listbox')

describe('Dropdown', () => {
  it('is a combobox named by its label, showing the selected option, closed at first', () => {
    render(<Controlled />)
    const c = combo()
    expect(c.textContent).toContain('Banana')
    expect(c.getAttribute('aria-haspopup')).toBe('listbox')
    expect(c.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('mouse: click opens, clicking an option calls onChange with target.value and closes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.click(combo())
    expect(combo().getAttribute('aria-expanded')).toBe('true')
    expect(combo().getAttribute('aria-controls')).toBe(listbox().id)
    const opts = within(listbox()).getAllByRole('option')
    expect(opts.map(o => o.textContent)).toEqual(['Apple', 'Banana', 'Blackberry (sold out)', 'Cherry'])
    expect(opts[1].getAttribute('aria-selected')).toBe('true')
    expect(opts[2].getAttribute('aria-disabled')).toBe('true')
    await user.click(screen.getByRole('option', { name: 'Cherry' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const [value, e] = onChange.mock.calls[0] as [string, { target: { value: string; name: string; id: string }; currentTarget: { value: string } }]
    expect(value).toBe('c')
    expect(e.target).toEqual({ value: 'c', name: 'fruit', id: 'fruit' })
    expect(e.currentTarget.value).toBe('c')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(combo().textContent).toContain('Cherry')
    expect(document.activeElement).toBe(combo())
  })

  it('does not call onChange when the same value is chosen again, nor for a disabled option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await user.click(combo())
    await user.click(screen.getByRole('option', { name: 'Banana' }))
    expect(onChange).not.toHaveBeenCalled()
    await user.click(combo())
    await user.click(screen.getByRole('option', { name: /Blackberry/ }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('keyboard: ArrowDown opens on the selected option, arrows move skipping disabled, Enter selects', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    combo().focus()
    await user.keyboard('{ArrowDown}')
    expect(combo().getAttribute('aria-expanded')).toBe('true')
    const activeName = () => document.getElementById(combo().getAttribute('aria-activedescendant') ?? '')?.textContent
    expect(activeName()).toBe('Banana')
    await user.keyboard('{ArrowDown}')
    expect(activeName()).toBe('Cherry') // Blackberry is disabled and skipped
    await user.keyboard('{ArrowDown}')
    expect(activeName()).toBe('Cherry') // stays at the end
    await user.keyboard('{ArrowUp}')
    expect(activeName()).toBe('Banana')
    await user.keyboard('{Home}')
    expect(activeName()).toBe('Apple')
    await user.keyboard('{End}')
    expect(activeName()).toBe('Cherry')
    await user.keyboard('{PageUp}')
    expect(activeName()).toBe('Apple')
    await user.keyboard('{PageDown}')
    expect(activeName()).toBe('Cherry')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('c', expect.anything())
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(combo())
  })

  it('keyboard: Enter, Space, ArrowUp and Alt+ArrowDown each open; Space selects', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    combo().focus()
    for (const key of ['{Enter}', ' ', '{ArrowUp}', '{Alt>}{ArrowDown}{/Alt}']) {
      await user.keyboard(key)
      expect(combo().getAttribute('aria-expanded')).toBe('true')
      await user.keyboard('{Escape}')
      expect(combo().getAttribute('aria-expanded')).toBe('false')
    }
    expect(onChange).not.toHaveBeenCalled()
    await user.keyboard('{Enter}{Home} ')
    expect(onChange).toHaveBeenCalledWith('a', expect.anything())
  })

  it('Escape closes without a change and keeps focus on the control; it does not reach the dialog', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const docEscape = vi.fn()
    document.addEventListener('keydown', docEscape)
    render(<Controlled onChange={onChange} />)
    combo().focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(combo())
    expect(combo().textContent).toContain('Banana')
    expect(docEscape.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')).toHaveLength(0)
    document.removeEventListener('keydown', docEscape)
  })

  it('Tab closes without choosing and moves focus on', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    combo().focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    await user.tab()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }))
  })

  it('type-ahead: letters jump to the matching option, repeated letters cycle, the buffer clears after 500ms', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    combo().focus()
    const activeName = () => document.getElementById(combo().getAttribute('aria-activedescendant') ?? '')?.textContent
    await user.keyboard('c')
    expect(combo().getAttribute('aria-expanded')).toBe('true')
    expect(activeName()).toBe('Cherry')
    await user.keyboard('a')
    expect(activeName()).toBe('Cherry') // "ca" matches nothing: stays
    await new Promise(r => setTimeout(r, 550))
    await user.keyboard('a')
    expect(activeName()).toBe('Apple')
    await new Promise(r => setTimeout(r, 550))
    await user.keyboard('b')
    expect(activeName()).toBe('Banana') // Blackberry is disabled
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled() // Banana was already the value
  })

  it('a disabled control is disabled, cannot be opened by mouse or keyboard', async () => {
    const user = userEvent.setup()
    render(<Controlled disabled />)
    const c = combo()
    expect((c as HTMLButtonElement).disabled).toBe(true)
    expect(c.getAttribute('aria-disabled')).toBe('true')
    await user.click(c)
    fireEvent.keyDown(c, { key: 'ArrowDown' })
    fireEvent.keyDown(c, { key: 'Enter' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('clicking the label focuses the control without opening it', async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    await user.click(screen.getByText('Fruit'))
    expect(document.activeElement).toBe(combo())
    expect(screen.queryByRole('listbox')).toBeNull()
    await user.click(combo())
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('FormField still names it and passes aria-describedby and aria-required', () => {
    render(
      <FormField label="Region" hint="Where it ships" required>
        <Select value="n" onChange={() => {}} aria-invalid="true">
          <option value="n">North</option>
          <option value="s">South</option>
        </Select>
      </FormField>,
    )
    const c = screen.getByRole('combobox', { name: /Region/ })
    expect(screen.getByLabelText(/Region/)).toBe(c)
    expect(c.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(c.getAttribute('aria-describedby')!)?.textContent).toBe('Where it ships')
    expect(c.getAttribute('aria-required')).toBe('true')
    expect(c.getAttribute('aria-invalid')).toBe('true')
    expect(c.className).toContain('c-input')
  })

  it('renders optgroups as labelled groups', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown aria-label="City" defaultValue="blr">
        <option value="">Any city</option>
        <optgroup label="South">
          <option value="blr">Bengaluru</option>
          <option value="maa">Chennai</option>
        </optgroup>
        <optgroup label="North">
          <option value="del">Delhi</option>
        </optgroup>
      </Dropdown>,
    )
    await user.click(screen.getByRole('combobox', { name: 'City' }))
    const south = screen.getByRole('group', { name: 'South' })
    expect(within(south).getAllByRole('option').map(o => o.textContent)).toEqual(['Bengaluru', 'Chennai'])
    expect(within(screen.getByRole('group', { name: 'North' })).getByRole('option', { name: 'Delhi' })).toBeTruthy()
  })

  it('uncontrolled: defaultValue shows, choosing keeps its own state; no default shows the first option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <Dropdown aria-label="Size" defaultValue="m" onChange={e => onChange(e.target.value)}>
          <option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option>
        </Dropdown>
        <Dropdown aria-label="Plain"><option value="1">One</option><option value="2">Two</option></Dropdown>
      </>,
    )
    const size = screen.getByRole('combobox', { name: 'Size' })
    expect(size.textContent).toContain('Medium')
    expect(screen.getByRole('combobox', { name: 'Plain' }).textContent).toContain('One')
    await user.click(size)
    await user.click(screen.getByRole('option', { name: 'Large' }))
    expect(onChange).toHaveBeenCalledWith('l')
    expect(size.textContent).toContain('Large')
  })

  it('a value no option has shows the first option that can be chosen, as a native select does', () => {
    render(
      <Dropdown aria-label="Pick" value="zzz" onChange={() => {}}>
        <option value="" disabled>Choose…</option>
        <option value="1">One</option>
      </Dropdown>,
    )
    expect(screen.getByRole('combobox', { name: 'Pick' }).textContent).toContain('One')
  })

  it('reads options through fragments, arrays and conditionals; an option with no value uses its text', () => {
    const show = false
    const { options, groups } = parseOptions(
      <>
        <option>Plain text</option>
        {['x', 'y'].map(v => <option key={v} value={v}>Item {v}</option>)}
        {show && <option value="hidden">Hidden</option>}
        <optgroup label="G" disabled><option value="g1">G one</option></optgroup>
      </>,
    )
    expect(options.map(o => [o.value, o.label, o.disabled])).toEqual([
      ['Plain text', 'Plain text', false], ['x', 'Item x', false], ['y', 'Item y', false], ['g1', 'G one', true],
    ])
    expect(groups).toEqual([{ label: 'G' }])
  })

  describe('search', () => {
    const many = ['Ångström Labs', 'Bolt Supply', 'Cobalt Works', 'Delta Parts', 'Echo Systems', 'Fusion Tech',
      'Gamma Goods', 'Helix Retail', 'Iota Industrial']
    function Many({ onChange = () => {} }: { onChange?: (v: string) => void }) {
      const [v, setV] = useState('')
      return (
        <Dropdown aria-label="Seller" value={v} onChange={e => { setV(e.target.value); onChange(e.target.value) }}>
          <option value="">Every seller</option>
          {many.map(m => <option key={m} value={m}>{m}</option>)}
        </Dropdown>
      )
    }

    it('appears with more than 8 options, takes focus, filters ignoring case and accents, keeps the arrows', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Many onChange={onChange} />)
      await user.click(screen.getByRole('combobox', { name: 'Seller' }))
      const box = screen.getByRole('searchbox', { name: 'Search options' })
      expect(document.activeElement).toBe(box)
      await user.keyboard('angst')
      expect(within(listbox()).getAllByRole('option').map(o => o.textContent)).toEqual(['Ångström Labs'])
      await user.clear(box)
      await user.keyboard('LT')
      expect(within(listbox()).getAllByRole('option').map(o => o.textContent)).toEqual(['Bolt Supply', 'Cobalt Works', 'Delta Parts'])
      const activeName = () => document.getElementById(box.getAttribute('aria-activedescendant') ?? '')?.textContent
      expect(activeName()).toBe('Bolt Supply')
      await user.keyboard('{ArrowDown}{ArrowDown}')
      expect(activeName()).toBe('Delta Parts')
      await user.keyboard('{Enter}')
      expect(onChange).toHaveBeenCalledWith('Delta Parts')
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Seller' }))
    })

    it('shows "No matches" when nothing matches and Enter then chooses nothing', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Many onChange={onChange} />)
      await user.click(screen.getByRole('combobox', { name: 'Seller' }))
      await user.keyboard('zzzz')
      expect(screen.getByText('No matches')).toBeTruthy()
      expect(within(listbox()).queryAllByRole('option')).toHaveLength(0)
      await user.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('a letter typed on the closed control opens the list with it in the search box', async () => {
      const user = userEvent.setup()
      render(<Many />)
      screen.getByRole('combobox', { name: 'Seller' }).focus()
      await user.keyboard('h')
      const box = screen.getByRole('searchbox', { name: 'Search options' }) as HTMLInputElement
      expect(box.value).toBe('h')
      expect(within(listbox()).getAllByRole('option').map(o => o.textContent)).toContain('Helix Retail')
    })

    it('no search box with 8 options or fewer', async () => {
      const user = userEvent.setup()
      render(<Controlled />)
      await user.click(combo())
      expect(screen.queryByRole('searchbox')).toBeNull()
    })
  })

  describe('portal and outside click', () => {
    it('draws the list in document.body, outside a clipping scroll container', async () => {
      const user = userEvent.setup()
      render(
        <div data-testid="scroller" style={{ overflow: 'auto', height: 40 }}>
          <Dropdown aria-label="Status" defaultValue="open">
            <option value="open">Open</option><option value="closed">Closed</option>
          </Dropdown>
        </div>,
      )
      await user.click(screen.getByRole('combobox', { name: 'Status' }))
      const pop = listbox().parentElement!
      expect(screen.getByTestId('scroller').contains(pop)).toBe(false)
      expect(pop.parentElement).toBe(document.body)
      expect(pop.style.position === '' ? getComputedStyle(pop).position : pop.style.position).not.toBe('absolute')
    })

    it('inside a modal dialog, draws the list within the dialog', async () => {
      const user = userEvent.setup()
      render(
        <div role="dialog" aria-modal="true" aria-label="Edit">
          <Dropdown aria-label="Status" defaultValue="open">
            <option value="open">Open</option><option value="closed">Closed</option>
          </Dropdown>
        </div>,
      )
      await user.click(screen.getByRole('combobox', { name: 'Status' }))
      expect(screen.getByRole('dialog').contains(listbox())).toBe(true)
    })

    it('a press outside closes it without a change', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Controlled onChange={onChange} />)
      await user.click(combo())
      expect(screen.getByRole('listbox')).toBeTruthy()
      await user.click(document.body)
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('a second click on the control closes it', async () => {
      const user = userEvent.setup()
      render(<Controlled />)
      await user.click(combo())
      await user.click(combo())
      expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('posts its value under `name` with a form', () => {
      const { container } = render(<form><Controlled /></form>)
      const form = container.querySelector('form')!
      expect(new FormData(form).get('fruit')).toBe('b')
    })

    it('follows scroll and resize while open', async () => {
      const user = userEvent.setup()
      render(<Controlled />)
      const c = combo()
      let top = 100
      c.getBoundingClientRect = () => ({ top, bottom: top + 40, left: 20, right: 220, width: 200, height: 40, x: 20, y: top, toJSON: () => ({}) })
      await user.click(c)
      const pop = listbox().parentElement!
      expect(pop.style.minWidth).toBe('200px')
      const before = parseFloat(pop.style.top)
      top = 50
      act(() => { window.dispatchEvent(new Event('scroll')) })
      expect(parseFloat(pop.style.top)).toBe(before - 50)
    })
  })
})
