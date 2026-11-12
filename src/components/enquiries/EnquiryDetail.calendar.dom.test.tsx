import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { EnquiryDetail } from './EnquiryDetail'
import type { Enquiry } from '../../lib/enquiries'

const dl = vi.hoisted(() => ({ calls: [] as { name: string; text: string }[] }))
vi.mock('./downloadIcs', () => ({ downloadIcs: (name: string, text: string) => { dl.calls.push({ name, text }) } }))

afterEach(() => { cleanup(); dl.calls = [] })

const base: Enquiry = {
  id: 'ENQ-9', type: 'demo', account_id: 'a', raised_by: 'u', partner_id: 'p', subject: 'Sensor hub', status: 'scheduled',
  currency: null, needed_by: null, valid_until: null, format: 'video', attendees: 3, contact_pref: null, decline_reason: null,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', decided_at: null,
}
const empty = { lines: [], messages: [], events: [] }
const props = { role: 'buyer' as const, today: '2026-11-12', onAction: () => {}, answerer: 'Nimbus', money: (n: number) => String(n) }

describe('Add to calendar', () => {
  it('a scheduled demo offers it, named for the event, and downloads the confirmed time', () => {
    const slots = [{ id: 's1', enquiry_id: 'ENQ-9', starts_at: '2026-12-01T09:30:00Z', proposed_by: 'buyer' as const, confirmed: true, location: 'https://meet.example/x' }]
    render(<EnquiryDetail {...props} enquiry={base} book={{ ...empty, slots }} />)
    const b = screen.getByRole('button', { name: 'Add to calendar: Demo: Sensor hub' })
    fireEvent.click(b)
    expect(dl.calls).toHaveLength(1)
    expect(dl.calls[0].name).toBe('ENQ-9.ics')
    expect(dl.calls[0].text).toContain('DTSTART:20261201T093000Z')
  })
  it('a requested demo (no confirmed time) does not', () => {
    render(<EnquiryDetail {...props} enquiry={{ ...base, status: 'requested' }} book={{ ...empty, slots: [] }} />)
    expect(screen.queryByRole('button', { name: /Add to calendar/ })).toBeNull()
  })
  it('a sent quote offers an all-day reminder; an expired one does not', () => {
    const q: Enquiry = { ...base, type: 'quote', status: 'quoted', valid_until: '2026-12-31', format: null }
    const { unmount } = render(<EnquiryDetail {...props} enquiry={q} book={{ ...empty, slots: [] }} />)
    fireEvent.click(screen.getByRole('button', { name: /Add to calendar: Quote expires/ }))
    expect(dl.calls[0].text).toContain('DTSTART;VALUE=DATE:20261231')
    unmount()
    render(<EnquiryDetail {...props} enquiry={{ ...q, valid_until: '2026-11-11' }} book={{ ...empty, slots: [] }} />)
    expect(screen.queryByRole('button', { name: /Add to calendar/ })).toBeNull()
  })
})
