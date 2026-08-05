import { describe, it, expect } from 'vitest'
import {
  byArea, matching, levelOf, summarise, validateRole,
  emptyCapabilities, fillGaps,
} from './operatorAccess'
import type { CapabilityDef, AuditCategoryDef } from './operatorAccess'

/* The seeded catalogue, trimmed. A fixture invented here would pass against a
   console that has different capabilities from the one this describes. */
const CAPS: CapabilityDef[] = [
  { id: 'dashboard', label: 'Dashboard', area: 'Marketplace', covers: 'The operator home page and its rollups.', scopable: false, sort_order: 1 },
  { id: 'reports', label: 'Reports', area: 'Marketplace', covers: 'Exports and scheduled reporting.', scopable: true, sort_order: 2 },
  { id: 'catalogue', label: 'Catalogue', area: 'Catalogue', covers: 'Approving, editing and retiring products.', scopable: true, sort_order: 10 },
  { id: 'inventory', label: 'Inventory', area: 'Catalogue', covers: 'Stock levels and availability.', scopable: true, sort_order: 13 },
  { id: 'mor', label: 'Merchant of record', area: 'Money', covers: 'Which entity contracts with the buyer in each market.', scopable: false, sort_order: 35 },
  { id: 'developer_portal', label: 'Developer portal', area: 'Platform', covers: 'API keys, webhooks and sandbox access.', scopable: true, sort_order: 61 },
  { id: 'audit', label: 'Audit log', area: 'Access & security', covers: 'Reading and exporting the audit trail.', scopable: false, sort_order: 74 },
]

const CATS: AuditCategoryDef[] = [
  { id: 'Settlement', label: 'Settlement', covers: 'Statements and payouts.', sort_order: 14 },
  { id: 'Support', label: 'Support', covers: 'Tickets and SLA breaches.', sort_order: 15 },
]

const known = { categories: CATS, capabilities: CAPS }

const draft = (over: Partial<Parameters<typeof validateRole>[0]> = {}) => ({
  name: 'Settlement reviewer',
  audit_categories: [] as string[],
  capabilities: { catalogue: 'full' } as Record<string, string>,
  ...over,
})

describe('grouping the capability list', () => {
  it('reads as one short list per part of the console', () => {
    expect(byArea(CAPS).map(g => g.area))
      .toEqual(['Marketplace', 'Catalogue', 'Money', 'Platform', 'Access & security'])
  })

  it('keeps the catalogue’s own order inside each group', () => {
    expect(byArea(CAPS)[1].caps.map(c => c.id)).toEqual(['catalogue', 'inventory'])
  })

  it('loses nothing', () => {
    expect(byArea(CAPS).flatMap(g => g.caps)).toHaveLength(CAPS.length)
  })
})

describe('finding a capability without knowing its name', () => {
  it('matches the label', () => {
    expect(matching(CAPS, 'invent').map(c => c.id)).toEqual(['inventory'])
  })

  it('matches what it covers, not only what it is called', () => {
    /* Somebody looking for "webhooks" is looking for the developer portal.
       Matching the name alone would tell them the console has no such thing. */
    expect(matching(CAPS, 'webhooks').map(c => c.id)).toEqual(['developer_portal'])
    expect(matching(CAPS, 'payouts')).toEqual([])
  })

  it('matches the area, so a whole section can be pulled up at once', () => {
    expect(matching(CAPS, 'money').map(c => c.id)).toEqual(['mor'])
  })

  it('finds the one nobody can guess the name of', () => {
    /* `mor` is merchant of record. Nobody types that. */
    expect(matching(CAPS, 'merchant').map(c => c.id)).toEqual(['mor'])
  })

  it('shows everything when nothing is typed', () => {
    expect(matching(CAPS, '   ')).toHaveLength(CAPS.length)
  })
})

describe('what a role comes to', () => {
  it('reads an absent key as none, because it grants the same thing', () => {
    expect(levelOf({}, 'catalogue')).toBe('none')
    expect(levelOf({ catalogue: 'none' }, 'catalogue')).toBe('none')
    expect(levelOf({ catalogue: 'nonsense' }, 'catalogue')).toBe('none')
  })

  it('reads read-only as itself, not as none', () => {
    /* This is the bug: `levelOf` used to test for full and scoped and default
       everything else to none, so a real grant was rendered as no grant. */
    expect(levelOf({ audit: 'read' }, 'audit')).toBe('read')
  })

  it('counts against the whole catalogue, not against what was written down', () => {
    /* A role made before a capability existed holds nothing for it. Counting
       only its own keys would say "1 full · 0 none" and read as complete. */
    const s = summarise({ catalogue: 'full', reports: 'scoped' }, CAPS)
    expect(s).toMatchObject({ full: 1, scoped: 1, read: 0, none: 5 })
    expect(s.text).toBe('1 full · 1 scoped · 5 none')
  })

  it('counts read-only, which used to disappear into none', () => {
    /* The Read-Only Analyst held three capabilities at `read`, a level nothing
       understood, so the console rendered them as none and the role granted
       nothing while looking configured. */
    const s = summarise({ dashboard: 'read', reports: 'read', audit: 'read' }, CAPS)
    expect(s).toMatchObject({ full: 0, scoped: 0, read: 3, none: 4 })
    expect(s.text).toBe('3 read-only · 4 none')
  })

  it('names only the levels actually held', () => {
    /* "0 read · 0 scoped" on every role that uses neither is noise in the one
       line meant to be read at a glance. */
    expect(summarise({ catalogue: 'full' }, CAPS).text).toBe('1 full · 6 none')
  })
})

describe('whether a role is one the console can honour', () => {
  it('accepts an ordinary one', () => {
    expect(validateRole(draft(), known)).toEqual({ ok: true })
  })

  it('needs a name', () => {
    const v = validateRole(draft({ name: '  ' }), known)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/name/i)
  })

  it('refuses a category that does not exist, which is the typo that saved cleanly', () => {
    const v = validateRole(draft({ audit_categories: ['Setlement'], capabilities: { audit: 'full' } }), known)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('Setlement')
  })

  it('refuses a capability nothing reads', () => {
    const v = validateRole(draft({ capabilities: { catalog: 'full' } }), known)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/grants nothing/)
  })

  it('refuses a level that is not one of the four', () => {
    const v = validateRole(draft({ capabilities: { catalogue: 'readonly' } }), known)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/none, read, scoped or full/)
  })

  it('accepts read-only, including on a capability that cannot be scoped', () => {
    /* Reading is never all-or-nothing. `audit` cannot be scoped and can
       certainly be read — which is exactly what the Finance Auditor holds. */
    expect(validateRole(draft({ capabilities: { audit: 'read', catalogue: 'read' } }), known))
      .toEqual({ ok: true })
  })

  it('counts a read-only grant as holding something', () => {
    /* Otherwise the Read-Only Analyst is refused as an empty role for holding
       exactly what it is for. */
    expect(validateRole(draft({ capabilities: { dashboard: 'read' } }), known)).toEqual({ ok: true })
  })

  it('refuses scoping something that has no breadth to limit', () => {
    const v = validateRole(draft({ capabilities: { audit: 'scoped' } }), known)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/cannot be scoped/)
  })

  it('refuses a role that holds nothing', () => {
    /* An empty role is a half-filled form, not an intention. Saved, it is an
       account that signs in to an empty console. */
    const v = validateRole(draft({ capabilities: {} }), known)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/empty console/)
  })

  it('refuses audit scope without the audit log', () => {
    /* Both halves look right on their own: categories are filled in, and the
       capability list simply does not mention audit. Together they are a scope
       on a screen the holder cannot open. */
    const v = validateRole(draft({ audit_categories: ['Settlement'] }), known)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/cannot open the audit log/)
  })

  it('accepts audit scope with the audit log', () => {
    expect(validateRole(draft({
      audit_categories: ['Settlement', 'Support'],
      capabilities: { audit: 'full', catalogue: 'full' },
    }), known)).toEqual({ ok: true })
  })
})

describe('opening the form on the whole catalogue', () => {
  it('starts a new role with every capability listed at none', () => {
    const blank = emptyCapabilities(CAPS)
    expect(Object.keys(blank)).toHaveLength(CAPS.length)
    expect(Object.values(blank).every(v => v === 'none')).toBe(true)
  })

  it('shows an old role every capability, including ones added since', () => {
    /* The form used to list only the keys the role already had, so a capability
       added to the console after the role was made was invisible on it — and
       the only way to grant it was to type its name correctly from memory. */
    const filled = fillGaps({ catalogue: 'full' }, CAPS)
    expect(Object.keys(filled).sort()).toEqual(CAPS.map(c => c.id).sort())
    expect(filled.catalogue).toBe('full')
    expect(filled.mor).toBe('none')
  })

  it('does not invent a grant while filling the gaps', () => {
    const filled = fillGaps({ catalogue: 'full', reports: 'scoped' }, CAPS)
    expect(Object.values(filled).filter(v => v !== 'none')).toHaveLength(2)
  })
})
