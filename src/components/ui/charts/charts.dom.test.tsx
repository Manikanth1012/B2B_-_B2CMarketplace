import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AreaChart, BarChart, ColumnChart, DonutChart, LineChart, SERIES, Sparkline, categoryColour, compactMoney, niceTicks, seriesColour } from './index'
import * as legacy from '../../operator/charts'
import { contrast, readTokens } from '../../../lib/contrast'

afterEach(cleanup)

const MONTHS = [{ label: 'Jan', value: 1000 }, { label: 'Feb', value: 2500, note: '12 orders' }, { label: 'Mar', value: 1800 }]

describe('palette', () => {
  it('six token slots, each at least 3:1 on white (a non-text mark)', () => {
    const tokens = readTokens(readFileSync(resolve(__dirname, '../../../styles/global.css'), 'utf8'))
    expect(SERIES).toHaveLength(6)
    for (let n = 1; n <= 6; n++) {
      expect(SERIES[n - 1]).toBe(`var(--chart-${n})`)
      expect(contrast(tokens[`chart-${n}`], '#FFFFFF')).toBeGreaterThanOrEqual(3)
    }
  })
  it('a category key always gets the same colour; marketplaces own a slot each', () => {
    expect(categoryColour('iot')).toBe(categoryColour('IoT'))
    expect(categoryColour('anything')).toBe(categoryColour('anything'))
    const markets = ['consumer', 'partner', 'iot', 'security', 'device', 'content'].map(categoryColour)
    expect(new Set(markets).size).toBe(6)
    expect(seriesColour(7)).toBe(SERIES[1])
  })
  it('the old operator/charts path still exports the charts', () => {
    expect(legacy.ColumnChart).toBe(ColumnChart)
    expect(legacy.DonutChart).toBe(DonutChart)
    expect(legacy.SERIES).toBe(SERIES)
    expect(legacy.seriesColour).toBe(seriesColour)
  })
})

describe('niceTicks and formats', () => {
  it('round steps from zero', () => {
    expect(niceTicks(0, 196720, 4)).toEqual([0, 50000, 100000, 150000, 200000])
    expect(niceTicks(0, 7, 4)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(-30, 90, 4)).toEqual([-50, 0, 50, 100])
  })
  it('compact money for ticks', () => {
    expect(compactMoney(50000)).toBe('$50k')
    expect(compactMoney(1250000)).toBe('$1.3M')
    expect(compactMoney(900)).toBe('$900')
  })
})

describe('ColumnChart', () => {
  it('is a figure with a caption, ticks, and a screen-reader data table', () => {
    const { container } = render(<ColumnChart label="Gross by month" caption="Gross value" yLabel="Gross" data={MONTHS} />)
    const fig = screen.getByRole('figure')
    expect(within(fig).getByText('Gross value')).toBeTruthy()
    const table = container.querySelector('table.sr-only')!
    expect(table.querySelector('caption')?.textContent).toBe('Gross by month')
    expect([...table.querySelectorAll('tbody tr')].map(r => r.textContent)).toEqual(['Jan$1,000', 'Feb$2,500', 'Mar$1,800'])
    expect([...container.querySelectorAll('.ui-chart__y-tick')].map(t => t.textContent)).toEqual(['$0', '$1k', '$2k', '$3k'])
    expect(container.querySelector('.ui-chart__legend')).toBeNull()
  })

  it('shows a tooltip on hover and on keyboard focus, one tab stop with arrow keys', async () => {
    render(<ColumnChart label="Gross by month" data={MONTHS} />)
    const marks = screen.getAllByRole('img')
    expect(marks.map(m => m.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    fireEvent.mouseEnter(marks[1])
    expect(document.querySelector('.ui-chart__tip')?.textContent).toBe('Feb: $2,500 · 12 orders')
    fireEvent.mouseLeave(marks[1])
    expect(document.querySelector('.ui-chart__tip')).toBeNull()

    await userEvent.tab()
    expect(document.activeElement).toBe(marks[0])
    expect(document.querySelector('.ui-chart__tip')?.textContent).toBe('Jan: $1,000')
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(marks[1])
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(marks[2])
    expect(marks[2].getAttribute('aria-label')).toBe('Mar: $1,800')
  })

  it('colours a column by its category key, and draws nothing for no data', () => {
    const { container, rerender } = render(<ColumnChart label="x" data={[{ label: 'IoT', value: 3, key: 'iot' }]} />)
    expect((container.querySelector('.ui-chart__bar') as HTMLElement).style.background).toBe(categoryColour('iot'))
    rerender(<ColumnChart label="x" data={[]} />)
    expect(container.querySelector('figure')).toBeNull()
  })
})

describe('BarChart', () => {
  it('ranks largest first with printed values and shares', () => {
    const { container } = render(<BarChart label="Commission" share data={[{ label: 'A', value: 10 }, { label: 'B', value: 30 }, { label: 'C', value: 60 }]} />)
    const rows = [...container.querySelectorAll('.ui-bars__row')]
    expect(rows.map(r => r.querySelector('.ui-bars__label')?.textContent)).toEqual(['C', 'B', 'A'])
    expect(rows.map(r => r.querySelector('.ui-bars__share')?.textContent)).toEqual(['60%', '30%', '10%'])
    expect((rows[0].querySelector('.ui-bars__bar') as HTMLElement).style.width).toBe('100%')
    expect(container.querySelector('table.sr-only thead')?.textContent).toBe('ItemValueShare')
  })
  it('vertical is a column chart', () => {
    const { container } = render(<BarChart orientation="vertical" label="x" data={MONTHS} />)
    expect(container.querySelectorAll('.ui-chart__col')).toHaveLength(3)
  })
})

describe('LineChart and AreaChart', () => {
  const series = [
    { key: 'o', label: 'Orders', values: [10, 20, 15] },
    { key: 'r', label: 'Returns', values: [1, null, 3] },
  ]
  it('a legend for more than one series; bands name every series value', async () => {
    const { container } = render(<LineChart label="Orders and returns" labels={['Jan', 'Feb', 'Mar']} series={series} format={n => `${n}`} />)
    expect([...container.querySelectorAll('.ui-chart__legend li')].map(l => l.textContent)).toEqual(['Orders', 'Returns'])
    const bands = screen.getAllByRole('img')
    expect(bands[1].getAttribute('aria-label')).toBe('Feb: Orders 20, Returns no reading')
    /* The null breaks the returns line into two runs of one point: no polyline drawn with a gap filled in. */
    expect(container.querySelectorAll('polyline')).toHaveLength(3)
    await userEvent.tab()
    expect(document.querySelector('.ui-chart__tip')?.textContent).toBe('Jan: Orders 10, Returns 1')
    expect(container.querySelectorAll('.ui-chart__dot')).toHaveLength(2)
    expect(container.querySelector('table.sr-only tbody tr:nth-child(2)')?.textContent).toBe('Feb20—')
  })
  it('no legend for one series; area draws a fill', () => {
    const { container } = render(<AreaChart label="Gross" labels={['Jan', 'Feb']} series={[{ key: 'g', label: 'Gross', values: [1, 2] }]} />)
    expect(container.querySelector('.ui-chart__legend')).toBeNull()
    expect(container.querySelector('polygon.ui-chart__area')).toBeTruthy()
  })
})

describe('DonutChart', () => {
  it('keeps its API: centre, legend with values and shares, data table', () => {
    const { container } = render(<DonutChart label="Tiers" centre="64" centreSub="sellers" format={n => `${n}`}
      data={[{ label: 'Gold', value: 16, colour: 'var(--chart-4)' }, { label: 'Silver', value: 48, key: 'silver' }]} />)
    expect(screen.getByText('64')).toBeTruthy()
    expect([...container.querySelectorAll('.ui-donut__share')].map(s => s.textContent)).toEqual(['25%', '75%'])
    expect((container.querySelector('circle') as SVGElement).style.stroke).toBe('var(--chart-4)')
    expect(container.querySelector('table.sr-only caption')?.textContent).toBe('Tiers')
  })
  it('draws nothing for an empty whole', () => {
    const { container } = render(<DonutChart label="x" centre="0" data={[{ label: 'A', value: 0 }]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('Sparkline', () => {
  it('is decorative without a label, an image with one, nothing under two points', () => {
    const { container, rerender } = render(<Sparkline values={[1, 2, 3]} />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    rerender(<Sparkline values={[1, 2, 3]} label="Rising" />)
    expect(screen.getByRole('img', { name: 'Rising' })).toBeTruthy()
    rerender(<Sparkline values={[1]} />)
    expect(container.querySelector('svg')).toBeNull()
  })
})
