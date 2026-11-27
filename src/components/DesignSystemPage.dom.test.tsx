import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DesignSystemPage } from './DesignSystemPage'

vi.mock('../lib/supabase', () => ({ supabase: {} }))
afterEach(cleanup)

describe('DesignSystemPage', () => {
  it('renders one h1, a main landmark and a section heading per area', () => {
    render(<DesignSystemPage />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(14)
  })

  it('shows the spec 18 pieces: cell kinds, row actions, filter bar, field row, KPI row and every chart type', () => {
    render(<DesignSystemPage />)
    for (const h of ['Page header', 'Table cells and row actions', 'Filter bar', 'Field row', 'KPI row with breakdown', 'Charts']) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeTruthy()
    }
    expect(screen.getAllByRole('button', { name: /^More actions for INV-/ })).toHaveLength(2)
    expect(screen.getByRole('searchbox', { name: 'Search jobs' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Date range' })).toBeTruthy()
    expect(screen.getAllByRole('figure').length).toBeGreaterThanOrEqual(6)
    expect(document.querySelectorAll('.ui-bars, .ui-donut, .ui-chart__svg, .ui-chart__cols, .ui-spark').length).toBeGreaterThanOrEqual(6)
  })
})
