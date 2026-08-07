/**
 * Statutory e-invoicing, in three jurisdictions that do it three different ways.
 *
 * The marketplace computed tax correctly in all three and registered the
 * resulting document with nobody. In India that means the invoice is not a tax
 * invoice at all — the customer cannot claim input credit against it and the
 * supplier is penalised per document.
 *
 * The three regimes differ on exactly three things, which is why one model
 * holds them:
 *
 *   WHEN, relative to issue. India clears before the document may be shown to a
 *   customer; Kenya stamps it as it is issued; the Emirates reports it after.
 *   That single field decides whether an uncleared document is a blocker or a
 *   backlog.
 *
 *   WHAT COMES BACK, and therefore what goes on the face of the document. An
 *   IRN and a signed QR; a control unit number and a verification URL; or
 *   nothing at all, only a transmission reference held on file.
 *
 *   WHETHER IT CAN BE UNDONE. India allows twenty-four hours on the portal.
 *   Kenya allows none and corrects with a credit note.
 *
 * Saudi Arabia's ZATCA — UUID, previous-invoice hash, cryptographic stamp,
 * cleared XML — is a fourth instance of the same three answers, which is the
 * test of whether the shape is right rather than merely sufficient for what is
 * in front of it.
 */

export type Clearance = 'before-issue' | 'at-issue' | 'after-issue' | 'none'
export type ClearanceStatus = 'pending' | 'cleared' | 'failed' | 'cancelled' | 'not-required'
export type DocKind = 'consumer_bill' | 'enterprise_invoice' | 'credit_note'
export type Audience = 'b2b' | 'b2c'

export interface Regime {
  market: string
  authority: string
  scheme: string
  clearance: Clearance
  covers_b2b: boolean
  covers_b2c: boolean
  returns_irn: boolean
  returns_qr: boolean
  returns_control_unit: boolean
  cancel_hours: number
  effective_from: string
  note: string | null
  sort_order: number
}

export interface ClearanceRecord {
  id: string
  doc_kind: DocKind
  doc_id: string
  market: string
  audience: Audience
  status: ClearanceStatus
  irn: string | null
  ack_no: string | null
  ack_date: string | null
  signed_qr: string | null
  cu_invoice_no: string | null
  cu_serial: string | null
  verify_url: string | null
  transmission_ref: string | null
  delivered_at: string | null
  submitted_at: string | null
  cleared_at: string | null
  failure_code: string | null
  failure_reason: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  attempts: number
}

export const STATUS_LABEL: Record<ClearanceStatus, string> = {
  pending: 'Waiting on the authority',
  cleared: 'Registered',
  failed: 'Rejected',
  cancelled: 'Cancelled on the portal',
  'not-required': 'Out of scope',
}

export const STATUS_TONE: Record<ClearanceStatus, string> = {
  pending: 'pending',
  cleared: 'healthy',
  failed: 'rejected',
  cancelled: 'degraded',
  'not-required': 'degraded',
}

export function regimeFor(regimes: readonly Regime[], market: string): Regime | null {
  return regimes.find(r => r.market === market) ?? null
}

/**
 * Whether a document of this kind, to this audience, has to be cleared at all.
 *
 * Out of scope is a real answer and a different one from "nobody has decided".
 * India does not require an IRN on a B2C bill; that is a rule, not a gap, and
 * the difference matters to anybody reading a list of uncleared documents.
 */
export function inScope(regime: Regime | null, audience: Audience): boolean {
  if (!regime) return false
  return audience === 'b2b' ? regime.covers_b2b : regime.covers_b2c
}

/**
 * Whether the document may be issued.
 *
 * The only regime where an uncleared document is a hard stop is one that clears
 * BEFORE issue. Under the other two the obligation is still real and still
 * chased, but the customer has their invoice.
 */
export function canIssue(
  regime: Regime | null, record: ClearanceRecord | null, audience: Audience,
): { ok: true } | { ok: false; reason: string } {
  if (!regime || !inScope(regime, audience)) return { ok: true }
  if (record?.status === 'cleared' || record?.status === 'not-required') return { ok: true }
  if (regime.clearance !== 'before-issue') return { ok: true }

  if (record?.status === 'failed') {
    return {
      ok: false,
      reason: `${regime.authority} rejected this invoice${record.failure_code ? ` (${record.failure_code})` : ''}. ${record.failure_reason ?? ''} It cannot be issued until it clears.`.trim(),
    }
  }
  return {
    ok: false,
    reason: `${regime.scheme} registers an invoice before it is issued. Until this one is registered it is not a tax invoice — the customer cannot claim input credit against it.`,
  }
}

/**
 * What goes on the face of the document, in the order a reader looks for it.
 *
 * Different in every jurisdiction, and empty in one of them: the Emirates
 * returns nothing to print. A component that assumed an IRN would render a
 * blank label on every Emirati invoice.
 */
export function faceOfDocument(
  regime: Regime | null, record: ClearanceRecord | null,
): { label: string; value: string; mono?: boolean }[] {
  if (!regime || !record || record.status !== 'cleared') return []
  const out: { label: string; value: string; mono?: boolean }[] = []
  if (record.irn) out.push({ label: 'IRN', value: record.irn, mono: true })
  if (record.ack_no) out.push({ label: 'Acknowledgement', value: record.ack_no, mono: true })
  if (record.ack_date) out.push({ label: 'Acknowledged', value: record.ack_date.slice(0, 10) })
  if (record.cu_invoice_no) out.push({ label: 'CU invoice number', value: record.cu_invoice_no, mono: true })
  if (record.cu_serial) out.push({ label: 'Control unit', value: record.cu_serial, mono: true })
  return out
}

/** Whether there is something for the customer to scan, and where it points. */
export function scannable(record: ClearanceRecord | null): string | null {
  if (!record || record.status !== 'cleared') return null
  return record.verify_url ?? (record.signed_qr ? 'signed' : null)
}

/**
 * Whether a cleared document can still be pulled back, and if not, what to do
 * instead. Never just false — "you cannot cancel this" without "issue a credit
 * note" leaves somebody stuck with a wrong invoice.
 */
export function cancellable(
  regime: Regime | null, record: ClearanceRecord | null, now: string,
): { ok: true; until: string } | { ok: false; reason: string } {
  if (!regime || !record || record.status !== 'cleared' || !record.cleared_at) {
    return { ok: false, reason: 'Nothing has been registered for this document, so there is nothing to cancel.' }
  }
  if (regime.cancel_hours === 0) {
    return {
      ok: false,
      reason: `${regime.scheme} does not allow a registered document to be cancelled. Correct it with a credit note, which is itself registered.`,
    }
  }
  const until = new Date(new Date(record.cleared_at).getTime() + regime.cancel_hours * 3600_000).toISOString()
  if (now > until) {
    return {
      ok: false,
      reason: `The cancellation window on ${regime.scheme} is ${regime.cancel_hours} hours and it closed at ${until.slice(0, 16).replace('T', ' ')}. Issue a credit note instead.`,
    }
  }
  return { ok: true, until }
}

/** What the regime does, in a sentence, for the screen that configures it. */
export function regimeLine(r: Regime): string {
  const when = r.clearance === 'before-issue' ? 'registered before it is issued'
    : r.clearance === 'at-issue' ? 'stamped as it is issued'
    : r.clearance === 'after-issue' ? 'reported after it is issued'
    : 'not registered anywhere'
  const scope = r.covers_b2b && r.covers_b2c ? 'Every invoice'
    : r.covers_b2b ? 'A business-to-business invoice'
    : r.covers_b2c ? 'A consumer bill'
    : 'Nothing'
  const undo = r.cancel_hours > 0
    ? `Cancellable for ${r.cancel_hours} hours, then only by credit note.`
    : 'No cancellation — a mistake is corrected with a credit note.'
  return `${scope} is ${when} by ${r.authority}. ${undo}`
}

/**
 * The queue. Documents whose obligation is not discharged, worst first.
 *
 * A rejection under a before-issue regime is at the top because it is blocking
 * a customer from being invoiced at all; everything else is a backlog.
 */
export function outstanding(
  records: readonly ClearanceRecord[], regimes: readonly Regime[],
): { record: ClearanceRecord; regime: Regime | null; blocking: boolean }[] {
  return records
    .filter(r => r.status === 'failed' || r.status === 'pending')
    .map(record => {
      const regime = regimeFor(regimes, record.market)
      return { record, regime, blocking: regime?.clearance === 'before-issue' }
    })
    .sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1
      if (a.record.status !== b.record.status) return a.record.status === 'failed' ? -1 : 1
      return a.record.doc_id < b.record.doc_id ? -1 : 1
    })
}

/** Coverage, per market — the figure that answers "are we compliant". */
export function coverage(
  records: readonly ClearanceRecord[], market: string,
): { inScope: number; cleared: number; failed: number; pending: number; pct: number } {
  const mine = records.filter(r => r.market === market && r.status !== 'not-required')
  const cleared = mine.filter(r => r.status === 'cleared').length
  return {
    inScope: mine.length,
    cleared,
    failed: mine.filter(r => r.status === 'failed').length,
    pending: mine.filter(r => r.status === 'pending').length,
    pct: mine.length === 0 ? 100 : Math.round(cleared / mine.length * 1000) / 10,
  }
}
