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
})
