import { describe, it, expect } from 'vitest'
import { sessionFromAppMetadata, isPersona } from './auth'

describe('isPersona', () => {
  it('accepts the four personas and nothing else', () => {
    expect(isPersona('consumer')).toBe(true)
    expect(isPersona('operator')).toBe(true)
    expect(isPersona('partner')).toBe(true)
    expect(isPersona('enterprise')).toBe(true)
    expect(isPersona('admin')).toBe(false)
    expect(isPersona('')).toBe(false)
    expect(isPersona(undefined)).toBe(false)
    expect(isPersona(null)).toBe(false)
    expect(isPersona(1)).toBe(false)
  })
})

describe('sessionFromAppMetadata', () => {
  it('reads the persona the server issued', () => {
    expect(sessionFromAppMetadata({ persona: 'operator' })).toEqual({
      persona: 'operator',
      partnerId: undefined,
    })
  })

  it('carries partner_id through for the partner console', () => {
    expect(sessionFromAppMetadata({ persona: 'partner', partner_id: 'PTR-1004' })).toEqual({
      persona: 'partner',
      partnerId: 'PTR-1004',
    })
  })

  /* Public signup is enabled on this project, so an authenticated user with no
     persona is reachable by anyone who registers. They must not get a console. */
  it('refuses an authenticated user with no persona', () => {
    expect(sessionFromAppMetadata({})).toBeNull()
    expect(sessionFromAppMetadata(undefined)).toBeNull()
    expect(sessionFromAppMetadata(null)).toBeNull()
    expect(sessionFromAppMetadata({ provider: 'email', providers: ['email'] })).toBeNull()
  })

  it('refuses a persona that is not one of the four', () => {
    expect(sessionFromAppMetadata({ persona: 'admin' })).toBeNull()
    expect(sessionFromAppMetadata({ persona: 'superuser' })).toBeNull()
    expect(sessionFromAppMetadata({ persona: '' })).toBeNull()
  })

  it('ignores a non-string partner_id rather than trusting it', () => {
    expect(sessionFromAppMetadata({ persona: 'partner', partner_id: 42 })).toEqual({
      persona: 'partner',
      partnerId: undefined,
    })
  })
})
