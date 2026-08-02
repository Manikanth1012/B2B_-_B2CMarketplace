import { describe, it, expect } from 'vitest'
import { folderOf, canOpen, fileNameFor, whyNot, LINK_SECONDS } from './evidence'
import type { Viewer } from './evidence'

const OPERATOR: Viewer = { persona: 'operator' }
const SELLER: Viewer = { persona: 'partner', partnerId: 'PTR-1004' }
const OTHER_SELLER: Viewer = { persona: 'partner', partnerId: 'PTR-1009' }
const BUYER: Viewer = { persona: 'enterprise', accountId: 'ENT-2007' }
const CUSTOMER: Viewer = { persona: 'consumer', customerId: 'CUS-449021' }

const GATE_DOC = 'PTR-1004/gates/doc-ptr-1004-kyc-2.pdf'
const PACK = 'ENT-2007/onboarding/bo-2007-1-1.pdf'
const MINE = 'CUS-449021/cd-002.pdf'

describe('folderOf', () => {
  it('is the first segment, which is the counterparty', () => {
    expect(folderOf(GATE_DOC)).toBe('PTR-1004')
    expect(folderOf(PACK)).toBe('ENT-2007')
  })

  it('is nothing for a path with no folder — a bare filename belongs to nobody', () => {
    expect(folderOf('loose.pdf')).toBeNull()
    expect(folderOf('/leading.pdf')).toBeNull()
    expect(folderOf(null)).toBeNull()
    expect(folderOf('')).toBeNull()
  })
})

describe('canOpen', () => {
  it('lets the operator open anything — reviewing evidence is the job', () => {
    for (const p of [GATE_DOC, PACK, MINE]) expect(canOpen(OPERATOR, p)).toBe(true)
  })

  it('lets each counterparty open its own folder', () => {
    expect(canOpen(SELLER, GATE_DOC)).toBe(true)
    expect(canOpen(BUYER, PACK)).toBe(true)
    expect(canOpen(CUSTOMER, MINE)).toBe(true)
  })

  it('refuses one seller the other seller\'s documents', () => {
    expect(canOpen(OTHER_SELLER, GATE_DOC)).toBe(false)
  })

  it('does not let an id match a folder belonging to a different kind of party', () => {
    /* A seller whose id somehow equalled an account id must still not read the
       account's pack — the persona picks which id is compared, so there is no
       route by which one stands in for the other. */
    expect(canOpen(SELLER, PACK)).toBe(false)
    expect(canOpen(BUYER, GATE_DOC)).toBe(false)
    expect(canOpen(CUSTOMER, GATE_DOC)).toBe(false)
  })

  it('refuses a viewer with no id at all', () => {
    expect(canOpen({ persona: 'partner' }, GATE_DOC)).toBe(false)
    expect(canOpen({ persona: 'partner', partnerId: null }, GATE_DOC)).toBe(false)
    expect(canOpen({ persona: null }, GATE_DOC)).toBe(false)
  })

  it('refuses a document with no path — there is nothing to open', () => {
    expect(canOpen(OPERATOR, null)).toBe(false)
    expect(canOpen(SELLER, undefined)).toBe(false)
  })

  it('does not match on a prefix', () => {
    /* `PTR-100` must not open `PTR-1004`'s folder. Comparing the whole segment
       rather than the start of the path is the reason. */
    expect(canOpen({ persona: 'partner', partnerId: 'PTR-100' }, GATE_DOC)).toBe(false)
    expect(canOpen({ persona: 'partner', partnerId: 'PTR-10044' }, GATE_DOC)).toBe(false)
  })
})

describe('whyNot', () => {
  it('tells apart nothing-uploaded from not-yours', () => {
    expect(whyNot(SELLER, { path: null })).toMatch(/uploaded/i)
    expect(whyNot(OTHER_SELLER, { path: GATE_DOC })).toMatch(/another party/i)
  })

  it('says nothing when the document opens', () => {
    expect(whyNot(SELLER, { path: GATE_DOC })).toBeNull()
    expect(whyNot(OPERATOR, { path: MINE })).toBeNull()
  })
})

describe('fileNameFor', () => {
  it('uses the document\'s own name rather than the stored path', () => {
    expect(fileNameFor('Certificate of incorporation', 'DOC-PTR-1004-KYC-2', GATE_DOC))
      .toBe('Certificate-of-incorporation-DOC-PTR-1004-KYC-2.pdf')
  })

  it('keeps the stored extension', () => {
    expect(fileNameFor('Trading history', 'E-1', 'PTR-1004/categories/e-1.csv')).toMatch(/\.csv$/)
    expect(fileNameFor('Trading history', 'E-1', 'PTR-1004/categories/E-1.XLSX')).toMatch(/\.xlsx$/)
  })

  it('assumes a PDF when the path says nothing', () => {
    expect(fileNameFor('Something', 'X-1')).toBe('Something-X-1.pdf')
  })

  it('strips what a filesystem will not take, without leaving punctuation behind', () => {
    const out = fileNameFor('Trade reference — Larsen Infra / 2024', 'BO-1', PACK)
    expect(out).toBe('Trade-reference-Larsen-Infra-2024-BO-1.pdf')
    expect(out).not.toMatch(/[/\\:*?"<>|]/)
  })

  it('never produces a name that is only an extension', () => {
    expect(fileNameFor('———', 'X-1')).toBe('document-X-1.pdf')
    expect(fileNameFor('', 'X-1')).toBe('document-X-1.pdf')
  })

  it('keeps the reference, so two documents of one name do not collide', () => {
    const a = fileNameFor('Signed mandate', 'BO-2007-4-1')
    const b = fileNameFor('Signed mandate', 'BO-2007-9-1')
    expect(a).not.toBe(b)
  })
})

describe('the link', () => {
  it('lives long enough to click and not long enough to forward', () => {
    expect(LINK_SECONDS).toBeGreaterThanOrEqual(60)
    expect(LINK_SECONDS).toBeLessThanOrEqual(300)
  })
})
