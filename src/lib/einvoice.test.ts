import { describe, it, expect } from 'vitest'
import {
  regimeFor, inScope, canIssue, faceOfDocument, scannable, cancellable,
  regimeLine, outstanding, coverage, STATUS_LABEL,
} from './einvoice'
import type { Regime, ClearanceRecord } from './einvoice'

/* The three real regimes. The differences between them are the whole model, so
   a fixture that flattened them would test nothing. */
const IN: Regime = {
  market: 'IN',
  authority: 'Goods and Services Tax Network — Invoice Registration Portal',
  scheme: 'GST e-invoice (IRP)',
  clearance: 'before-issue', covers_b2b: true, covers_b2c: false,
  returns_irn: true, returns_qr: true, returns_control_unit: false,
  cancel_hours: 24, effective_from: '2020-10-01', note: null, sort_order: 1,
}
const KE: Regime = {
  market: 'KE', authority: 'Kenya Revenue Authority', scheme: 'eTIMS',
  clearance: 'at-issue', covers_b2b: true, covers_b2c: true,
  returns_irn: false, returns_qr: true, returns_control_unit: true,
  cancel_hours: 0, effective_from: '2023-09-01', note: null, sort_order: 2,
}
const AE: Regime = {
  market: 'AE', authority: 'Federal Tax Authority', scheme: 'Peppol five-corner e-invoicing',
  clearance: 'after-issue', covers_b2b: true, covers_b2c: false,
  returns_irn: false, returns_qr: false, returns_control_unit: false,
  cancel_hours: 0, effective_from: '2026-07-01', note: null, sort_order: 3,
}
const REGIMES = [IN, KE, AE]

const rec = (over: Partial<ClearanceRecord> = {}): ClearanceRecord => ({
  id: 'EI-1', doc_kind: 'enterprise_invoice', doc_id: 'INV-1',
  market: 'IN', audience: 'b2b', status: 'cleared',
  irn: 'a'.repeat(64), ack_no: '112410012345678', ack_date: '2026-07-29T09:00:00Z',
  signed_qr: 'eyJhbGciOiJSUzI1NiJ9.abc',
  cu_invoice_no: null, cu_serial: null, verify_url: null,
  transmission_ref: null, delivered_at: null,
  submitted_at: '2026-07-29T09:00:00Z', cleared_at: '2026-07-29T09:00:00Z',
  failure_code: null, failure_reason: null,
  cancelled_at: null, cancel_reason: null, attempts: 1, ...over,
})

describe('inScope', () => {
  /* Out of scope is a rule, not a gap. India requires an IRN on B2B and only a
     dynamic QR on B2C, and confusing the two puts seven consumer bills on a
     compliance report for ever. */
  it('knows India does not cover consumer bills and Kenya does', () => {
    expect(inScope(IN, 'b2b')).toBe(true)
    expect(inScope(IN, 'b2c')).toBe(false)
    expect(inScope(KE, 'b2c')).toBe(true)
    expect(inScope(AE, 'b2c')).toBe(false)
  })

  it('is false where no regime is configured at all', () => {
    expect(inScope(null, 'b2b')).toBe(false)
    expect(regimeFor(REGIMES, 'SG')).toBeNull()
  })
})

describe('canIssue', () => {
  /* The load-bearing distinction. Only a before-issue regime blocks. */
  it('blocks an unregistered Indian invoice, because it is not a tax invoice', () => {
    const r = canIssue(IN, null, 'b2b')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/cannot claim input credit/)
  })

  it('does not block in Kenya or the Emirates, where clearance is not a precondition', () => {
    expect(canIssue(KE, null, 'b2b').ok).toBe(true)
    expect(canIssue(AE, null, 'b2b').ok).toBe(true)
  })

  it('does not block a document the regime does not cover', () => {
    expect(canIssue(IN, null, 'b2c').ok).toBe(true)
    expect(canIssue(IN, rec({ status: 'not-required' }), 'b2c').ok).toBe(true)
  })

  it('lets a cleared invoice through', () => {
    expect(canIssue(IN, rec(), 'b2b').ok).toBe(true)
  })

  /* A rejection has a code and a reason and both belong in front of whoever
     has to fix it. */
  it('quotes the portal’s own refusal', () => {
    const r = canIssue(IN, rec({
      status: 'failed', cleared_at: null, irn: null,
      failure_code: '2172',
      failure_reason: 'The buyer GSTIN is not active for the date of supply.',
    }), 'b2b')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/2172/)
      expect(r.reason).toMatch(/not active for the date of supply/)
    }
  })
})

describe('faceOfDocument', () => {
  it('prints the IRN, acknowledgement and date in India', () => {
    expect(faceOfDocument(IN, rec()).map(f => f.label))
      .toEqual(['IRN', 'Acknowledgement', 'Acknowledged'])
  })

  it('prints the control unit stamp in Kenya', () => {
    const k = rec({
      market: 'KE', irn: null, ack_no: null, ack_date: null, signed_qr: null,
      cu_invoice_no: '0000123456', cu_serial: 'KRACU1234567',
      verify_url: 'https://itax.kra.go.ke/...',
    })
    expect(faceOfDocument(KE, k).map(f => f.label))
      .toEqual(['CU invoice number', 'Control unit'])
  })

  /* The Emirates returns nothing to print, and a component that assumed an IRN
     would render an empty label on every Emirati invoice. */
  it('prints nothing in the Emirates, because nothing comes back', () => {
    const a = rec({
      market: 'AE', irn: null, ack_no: null, ack_date: null, signed_qr: null,
      transmission_ref: 'PEPPOL-9F5904F67393E790', delivered_at: '2026-08-01T09:00:00Z',
    })
    expect(faceOfDocument(AE, a)).toEqual([])
  })

  it('prints nothing at all until the document is cleared', () => {
    expect(faceOfDocument(IN, rec({ status: 'pending', cleared_at: null }))).toEqual([])
    expect(faceOfDocument(IN, null)).toEqual([])
  })
})

describe('scannable', () => {
  it('points at the authority’s page where there is one', () => {
    expect(scannable(rec({ market: 'KE', verify_url: 'https://itax.kra.go.ke/x' })))
      .toBe('https://itax.kra.go.ke/x')
  })

  it('reports a signed code where the QR is the evidence itself', () => {
    expect(scannable(rec())).toBe('signed')
  })

  it('has nothing to scan on an uncleared or Emirati document', () => {
    expect(scannable(rec({ status: 'pending', cleared_at: null }))).toBeNull()
    expect(scannable(rec({ signed_qr: null, verify_url: null }))).toBeNull()
  })
})

describe('cancellable', () => {
  it('allows a cancellation inside India’s twenty-four hours', () => {
    const r = cancellable(IN, rec(), '2026-07-29T18:00:00Z')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.until).toBe('2026-07-30T09:00:00.000Z')
  })

  it('refuses one after the window, and says what to do instead', () => {
    const r = cancellable(IN, rec(), '2026-07-31T09:00:00Z')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/credit note/)
  })

  /* Never just "no". Somebody with a wrong invoice needs the next step. */
  it('refuses in Kenya, where there is no window at all, and says what to do instead', () => {
    const r = cancellable(KE, rec({ market: 'KE' }), '2026-07-29T10:00:00Z')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/does not allow/)
      expect(r.reason).toMatch(/credit note/)
    }
  })

  it('has nothing to cancel where nothing was registered', () => {
    expect(cancellable(IN, rec({ status: 'pending', cleared_at: null }), '2026-07-29T10:00:00Z').ok)
      .toBe(false)
  })
})

describe('regimeLine', () => {
  it('says when, by whom, and whether it can be undone', () => {
    expect(regimeLine(IN)).toMatch(/registered before it is issued/)
    expect(regimeLine(IN)).toMatch(/Cancellable for 24 hours/)
    expect(regimeLine(KE)).toMatch(/Every invoice is stamped as it is issued/)
    expect(regimeLine(KE)).toMatch(/No cancellation/)
    expect(regimeLine(AE)).toMatch(/reported after it is issued/)
  })
})

describe('outstanding', () => {
  /* A rejection under a before-issue regime is blocking a customer from being
     invoiced. Everything else is a backlog, and the two do not belong in one
     undifferentiated list. */
  it('puts what is blocking an invoice above what is merely late', () => {
    const rows = [
      rec({ id: 'a', doc_id: 'KE-1', market: 'KE', status: 'pending', cleared_at: null }),
      rec({ id: 'b', doc_id: 'IN-1', status: 'pending', cleared_at: null }),
      rec({
        id: 'c', doc_id: 'IN-2', status: 'failed', cleared_at: null,
        failure_reason: 'Buyer GSTIN inactive',
      }),
    ]
    const q = outstanding(rows, REGIMES)
    expect(q.map(x => x.record.doc_id)).toEqual(['IN-2', 'IN-1', 'KE-1'])
    expect(q[0].blocking).toBe(true)
    expect(q[2].blocking).toBe(false)
  })

  it('leaves out what is cleared and what was never in scope', () => {
    const rows = [rec(), rec({ id: 'x', status: 'not-required' })]
    expect(outstanding(rows, REGIMES)).toEqual([])
  })
})

describe('coverage', () => {
  it('counts only what is in scope', () => {
    const rows = [
      rec({ id: '1' }), rec({ id: '2' }),
      rec({ id: '3', status: 'failed', cleared_at: null, failure_reason: 'x' }),
      /* Seven B2C bills that India does not cover must not drag the figure
         down — they are not uncleared, they are not required. */
      rec({ id: '4', audience: 'b2c', status: 'not-required' }),
      rec({ id: '5', audience: 'b2c', status: 'not-required' }),
    ]
    expect(coverage(rows, 'IN')).toEqual({ inScope: 3, cleared: 2, failed: 1, pending: 0, pct: 66.7 })
  })

  it('is complete where there is nothing to do', () => {
    expect(coverage([], 'AE').pct).toBe(100)
  })
})

describe('STATUS_LABEL', () => {
  it('has a word for every state, including the one that is not a problem', () => {
    expect(Object.keys(STATUS_LABEL).sort())
      .toEqual(['cancelled', 'cleared', 'failed', 'not-required', 'pending'])
    expect(STATUS_LABEL['not-required']).toBe('Out of scope')
  })
})
