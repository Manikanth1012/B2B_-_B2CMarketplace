/* Touches the live Supabase project. Reads, and clears one document.
 *
 * The marketplace computed tax in three jurisdictions correctly and registered
 * the resulting documents with nobody. This suite is about the half of that
 * which cannot be checked by a unit test: that every document actually raised
 * has an answer on file, that the answer is the one its own market's regime
 * gives, and that "out of scope" is recorded rather than left as a gap.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadClearanceBook, loadClearanceFor, clearDocument } from './einvoiceRepo'
import type { ClearanceBook } from './einvoiceRepo'
import {
  regimeFor, inScope, canIssue, faceOfDocument, scannable, cancellable,
  outstanding, coverage,
} from './einvoice'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

let book: ClearanceBook

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  book = await loadClearanceBook()
  expect(book.loadError, book.loadError ?? '').toBeUndefined()
})

afterAll(async () => { await signOut() })

describe('the regimes', () => {
  it('has one for every market the marketplace issues documents in', async () => {
    const [{ data: inv }, { data: bills }] = await Promise.all([
      supabase.from('enterprise_invoices').select('market'),
      supabase.from('consumer_bills').select('market'),
    ])
    const issuing = new Set([
      ...((inv ?? []) as { market: string }[]).map(x => x.market),
      ...((bills ?? []) as { market: string }[]).map(x => x.market),
    ])
    expect(issuing.size).toBeGreaterThan(1)
    for (const m of issuing) {
      expect(regimeFor(book.regimes, m),
        `documents are issued in ${m} and no e-invoicing regime is configured for it — that is not the same as nothing being required, it is a question nobody has answered`)
        .toBeTruthy()
    }
  })

  /* The three differ on exactly the three things the model turns on. If they
     ever collapse into one shape, the model is being carried by a fixture. */
  it('is three genuinely different regimes, not one repeated', () => {
    expect(new Set(book.regimes.map(r => r.clearance)).size).toBeGreaterThan(2)
    expect(book.regimes.some(r => r.returns_irn)).toBe(true)
    expect(book.regimes.some(r => r.returns_control_unit)).toBe(true)
    expect(book.regimes.some(r => !r.returns_irn && !r.returns_control_unit)).toBe(true)
    expect(book.regimes.some(r => r.cancel_hours > 0)).toBe(true)
    expect(book.regimes.some(r => r.cancel_hours === 0)).toBe(true)
  })
})

describe('every document raised has an answer on file', () => {
  it('leaves no invoice or bill unaccounted for', async () => {
    const [{ data: inv }, { data: bills }] = await Promise.all([
      supabase.from('enterprise_invoices').select('id,market'),
      supabase.from('consumer_bills').select('id,market'),
    ])
    const seen = new Set(book.docs.map(d => `${d.record.doc_kind}:${d.record.doc_id}`))
    for (const i of (inv ?? []) as { id: string }[]) {
      expect(seen.has(`enterprise_invoice:${i.id}`),
        `${i.id} has been issued and never submitted to any authority`).toBe(true)
    }
    for (const b of (bills ?? []) as { id: string }[]) {
      expect(seen.has(`consumer_bill:${b.id}`),
        `${b.id} has been issued and never submitted to any authority`).toBe(true)
    }
  })

  /* Out of scope is a rule, not a gap. India requires no IRN on a consumer
     bill, and recording that is what stops seven bills sitting on a compliance
     report for ever. */
  it('records out-of-scope documents as out of scope, not as pending', () => {
    for (const d of book.docs) {
      const regime = regimeFor(book.regimes, d.record.market)
      if (!inScope(regime, d.record.audience)) {
        expect(d.record.status,
          `${d.record.doc_id} is not covered by ${regime?.scheme} and is recorded as ${d.record.status}`)
          .toBe('not-required')
      } else {
        expect(d.record.status,
          `${d.record.doc_id} is in scope and recorded as out of it`).not.toBe('not-required')
      }
    }
  })

  it('points every clearance row at a document that exists', () => {
    for (const d of book.docs) {
      expect(d.doc, `${d.record.doc_id} has a clearance row and no document behind it`).toBeTruthy()
    }
  })
})

describe('what came back matches the regime that returned it', () => {
  it('gives an Indian invoice an IRN and a Kenyan one a control unit, and neither the other', () => {
    for (const d of book.docs.filter(x => x.record.status === 'cleared')) {
      const r = regimeFor(book.regimes, d.record.market)!
      const id = d.record.doc_id
      if (r.returns_irn) {
        expect(d.record.irn, `${id}: ${r.scheme} returns an IRN and this one has none`).toBeTruthy()
        /* Sixty-four hex characters. A screen laid out against a short one
           looks right and breaks against the real portal. */
        expect(d.record.irn!.length, `${id}: the IRN is ${d.record.irn!.length} characters, not 64`).toBe(64)
        expect(d.record.ack_no, `${id}: registered with no acknowledgement number`).toBeTruthy()
      } else {
        expect(d.record.irn, `${id}: ${r.scheme} does not issue IRNs and this one carries one`).toBeNull()
      }
      if (r.returns_control_unit) {
        expect(d.record.cu_invoice_no, `${id}: ${r.scheme} stamps a control unit number`).toBeTruthy()
        expect(d.record.verify_url, `${id}: nothing for the customer to check it against`).toBeTruthy()
      } else {
        expect(d.record.cu_invoice_no, `${id}: ${r.scheme} has no control unit`).toBeNull()
      }
      if (r.clearance === 'after-issue') {
        expect(d.record.transmission_ref, `${id}: reported with no transmission reference`).toBeTruthy()
      }
      expect(d.record.cleared_at, `${id} is cleared and carries no time it cleared at`).toBeTruthy()
    }
  })

  it('prints on the face of each document exactly what its authority returned', () => {
    for (const d of book.docs.filter(x => x.record.status === 'cleared')) {
      const r = regimeFor(book.regimes, d.record.market)!
      const face = faceOfDocument(r, d.record)
      const labels = face.map(f => f.label)
      if (r.returns_irn) expect(labels).toContain('IRN')
      if (r.returns_control_unit) expect(labels).toContain('CU invoice number')
      /* And the Emirates prints nothing, which a component assuming an IRN
         would render as an empty label on every Emirati invoice. */
      if (!r.returns_irn && !r.returns_control_unit) expect(face).toEqual([])
      for (const f of face) expect(f.value.length, `${d.record.doc_id}: ${f.label} is blank`).toBeGreaterThan(0)
    }
  })

  it('has something to scan wherever the regime returns one', () => {
    for (const d of book.docs.filter(x => x.record.status === 'cleared')) {
      const r = regimeFor(book.regimes, d.record.market)!
      if (r.returns_qr) {
        expect(scannable(d.record), `${d.record.doc_id}: ${r.scheme} returns a QR and there is nothing to scan`)
          .toBeTruthy()
      }
    }
  })
})

describe('the queue, and what it stops', () => {
  it('sorts what is blocking an invoice above what is merely late', () => {
    const q = outstanding(book.docs.map(d => d.record), book.regimes)
    let seenNonBlocking = false
    for (const row of q) {
      if (!row.blocking) seenNonBlocking = true
      else expect(seenNonBlocking, 'a blocking rejection is sorted below a backlog row').toBe(false)
    }
  })

  /* The load-bearing distinction, exercised against real rows: an unregistered
     document is a hard stop in India and is not one in Kenya or the Emirates. */
  it('refuses to issue an unregistered Indian invoice and allows the others', () => {
    for (const d of book.docs) {
      const r = regimeFor(book.regimes, d.record.market)
      const gate = canIssue(r, d.record, d.record.audience)
      if (r?.clearance === 'before-issue' && inScope(r, d.record.audience)
          && d.record.status !== 'cleared') {
        expect(gate.ok, `${d.record.doc_id} may be issued unregistered under ${r.scheme}`).toBe(false)
        if (!gate.ok) expect(gate.reason.length).toBeGreaterThan(20)
      } else {
        expect(gate.ok, `${d.record.doc_id} is blocked by a regime that does not block`).toBe(true)
      }
    }
  })

  it('quotes the authority’s own words back on a rejection', () => {
    const failed = book.docs.filter(d => d.record.status === 'failed')
    expect(failed.length,
      'nothing has ever been rejected, so the screen that shows a rejection is shown against nothing')
      .toBeGreaterThan(0)
    for (const d of failed) {
      expect(d.record.failure_reason, `${d.record.doc_id} was rejected for no stated reason`).toBeTruthy()
      const gate = canIssue(regimeFor(book.regimes, d.record.market), d.record, d.record.audience)
      if (!gate.ok) expect(gate.reason).toContain(d.record.failure_reason!)
    }
  })

  it('reports coverage per market, counting only what is in scope', () => {
    for (const r of book.regimes) {
      const c = coverage(book.docs.map(d => d.record), r.market)
      expect(c.cleared + c.failed + c.pending).toBe(c.inScope)
      expect(c.pct).toBeGreaterThanOrEqual(0)
      expect(c.pct).toBeLessThanOrEqual(100)
    }
  })
})

describe('cancelling', () => {
  it('closes India’s window at twenty-four hours and refuses Kenya outright', () => {
    const now = new Date().toISOString()
    for (const d of book.docs.filter(x => x.record.status === 'cleared')) {
      const r = regimeFor(book.regimes, d.record.market)!
      const c = cancellable(r, d.record, now)
      if (r.cancel_hours === 0) {
        expect(c.ok, `${r.scheme} allowed a cancellation it does not allow`).toBe(false)
        /* Never just "no". Somebody with a wrong invoice needs the next step. */
        if (!c.ok) expect(c.reason).toMatch(/credit note/)
      } else if (!c.ok) {
        expect(c.reason).toMatch(/credit note/)
      }
    }
  })
})

describe('clearing a document', () => {
  it('is idempotent — a registered document comes back as it was', async () => {
    const already = book.docs.find(d => d.record.status === 'cleared' && d.record.irn)!
    const before = await loadClearanceFor(already.record.doc_kind, already.record.doc_id)
    const res = await clearDocument(
      already.record.doc_kind, already.record.doc_id,
      already.record.market, already.record.audience)
    expect(res.ok).toBe(true)
    const after = await loadClearanceFor(already.record.doc_kind, already.record.doc_id)
    expect(after.record!.irn, 'resubmitting a registered invoice minted a second IRN')
      .toBe(before.record!.irn)
    expect(after.record!.cleared_at).toBe(before.record!.cleared_at)
  })

  it('reads its own regime back with the record', async () => {
    const d = book.docs.find(x => x.record.status === 'cleared')!
    const { record, regime } = await loadClearanceFor(d.record.doc_kind, d.record.doc_id)
    expect(record).toBeTruthy()
    expect(regime?.market).toBe(record!.market)
  })
})
