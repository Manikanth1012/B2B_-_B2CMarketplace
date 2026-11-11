import { afterEach, describe, expect, it, vi } from 'vitest'
import { lazy } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { LazyArea } from './LazyArea'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('LazyArea', () => {
  it('shows a status while the screen loads, then the screen', async () => {
    const Screen = lazy(async () => ({ default: () => <p>Loaded screen</p> }))
    render(<header>Shell</header>)
    render(<LazyArea><Screen /></LazyArea>)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(await screen.findByText('Loaded screen')).toBeTruthy()
    expect(screen.getByText('Shell')).toBeTruthy()
  })

  it('offers a reload when the screen fails to load, and the shell stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    render(<div><header>Shell</header><LazyArea><Broken /></LazyArea></div>)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("didn't load")
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.getByText('Shell')).toBeTruthy()
  })

  it('tries again when the screen changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = lazy(() => Promise.reject(new Error('offline')))
    const Fine = lazy(async () => ({ default: () => <p>Other screen</p> }))
    const { rerender } = render(<LazyArea resetKey="a"><Broken /></LazyArea>)
    await screen.findByRole('alert')
    rerender(<LazyArea resetKey="b"><Fine /></LazyArea>)
    expect(await screen.findByText('Other screen')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
