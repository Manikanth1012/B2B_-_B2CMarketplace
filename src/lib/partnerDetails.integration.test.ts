/* Touches the live Supabase project.
 *
 * "My details" now holds three things a seller can be hurt by: the addresses
 * the platform sends money notices to, the account it pays into, and the
 * marketplaces it says they are open in. Each of these checks is a way that
 * record could quietly become untrue, and the RLS ones are the reason this file
 * signs in as a seller rather than reading through the operator.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadMyDetails, loadPartnerSettlement } from './partnerDetailsRepo'
import { taxPosition, goLiveRows, contactGaps, securityGaps } from './partnerDetails'
import { loadSellerRecord } from './partnerRepo'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const DEMO = 'PTR-1004'

describe('what the marketplace holds about every seller', () => {
  let partners: { id: string; name: string; country: string; joined: string }[] = []
  let banks: Awaited<ReturnType<typeof loadPartnerSettlement>>['bank'][] = []
  /* Which sellers have actually reached the gate that collects bank details.
     An application still on its first gate has not, and demanding one of it
     was this check assuming every partner in the database had finished
     onboarding — true until somebody applied through the real journey. */
  let banked = new Set<string>()
  let unreached = new Set<string>()

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const [p, b, g] = await Promise.all([
      supabase.from('partners').select('id,name,country,joined'),
      supabase.from('partner_bank').select('*'),
      supabase.from('onboarding_gates').select('partner_id,gate_name,status'),
    ])
    const gs = (g.data ?? []) as { partner_id: string; gate_name: string; status: string }[]
    banked = new Set(gs.filter(x => x.gate_name === 'Bank & tax' && x.status === 'cleared')
                       .map(x => x.partner_id))
    /* Never reached the gate at all — distinct from having reached it and being
       under review, where details are on file and the gate has yet to clear. */
    unreached = new Set(gs.filter(x => x.gate_name === 'Bank & tax' && x.status === 'pending')
                          .map(x => x.partner_id))
    partners = (p.data ?? []) as typeof partners
    banks = (b.data ?? []) as typeof banks
    expect(partners.length).toBeGreaterThan(0)
  })

  afterAll(async () => { await signOut() })

  it('has somewhere to pay every seller that cleared the bank gate', () => {
    /* A settlement run with an amount and no destination is a run that halts.
       Scoped to sellers past the gate that collects the account: before it,
       having none is the correct state, not a gap. */
    expect(banked.size, 'no seller has cleared the bank gate, so this checked nothing')
      .toBeGreaterThan(0)
    for (const p of partners.filter(x => banked.has(x.id))) {
      expect(banks.find(b => b?.partner_id === p.id), `${p.name} has no settlement instruction`).toBeTruthy()
    }
  })

  it('holds no bank details for a seller that never reached the gate', () => {
    /* The other direction, which is the one that would be a leak: an account
       number on file for somebody who was never asked for one. Reaching the
       gate is enough — details arrive when it opens, and the gate clears once
       they are checked, so "submitted but not yet cleared" is correct. */
    for (const b of banks) {
      if (!b) continue
      expect(unreached.has(b.partner_id),
        `${b.partner_id} has bank details but has not reached the bank gate`).toBe(false)
    }
  })

  it('never describes a withholding rate the certificate contradicts', () => {
    for (const b of banks) {
      if (!b) continue
      if (b.treaty_on_file) {
        expect(b.withholding, `${b.partner_id} claims a treaty rate with no certificate`).not.toMatch(/statutory/)
        expect(b.treaty_expires).toBeTruthy()
      } else {
        expect(b.withholding, `${b.partner_id} claims nil withholding with nothing on file`).not.toMatch(/^Nil/)
        expect(b.treaty_expires).toBeNull()
      }
    }
  })

  it('only claims a verified account where somebody verified it', () => {
    for (const b of banks) {
      if (!b) continue
      expect(b.verified === (b.verified_on !== null && b.verified_by !== null),
        `${b.partner_id}'s verification state and its evidence disagree`).toBe(true)
    }
  })

  it('leaves an account unverified while its seller is still onboarding', () => {
    /* Sellers with no join date have not gone live. Their account is recorded
       at the finance gate and proved later — claiming it verified would be
       claiming a payment nobody has made. Having no account on file at all
       satisfies that more strongly, and is the right state for a seller who
       has not reached the gate, so the check is "not verified" rather than
       "present and false". */
    for (const p of partners.filter(x => x.joined === '—')) {
      const b = banks.find(x => x?.partner_id === p.id)
      expect(b?.verified, `${p.name} is still onboarding but its account is marked verified`)
        .not.toBe(true)
    }
  })

  it('opens a storefront only where the seller was approved', async () => {
    const [gl, pc] = await Promise.all([
      supabase.from('partner_golive').select('partner_id,category_id'),
      supabase.from('partner_categories').select('partner_id,category_id,approved_at'),
    ])
    for (const g of (gl.data ?? []) as { partner_id: string; category_id: string }[]) {
      const approval = (pc.data ?? []).find((a: { partner_id: string; category_id: string }) =>
        a.partner_id === g.partner_id && a.category_id === g.category_id)
      expect(approval, `${g.partner_id} has a storefront in ${g.category_id} with no approval`).toBeTruthy()
      expect((approval as { approved_at: string | null }).approved_at).toBeTruthy()
    }
  })

  it('keeps one sign-in address per seller and no more', async () => {
    const { data } = await supabase.from('partner_contacts').select('partner_id,purpose,kind')
    const signins = (data ?? []).filter((c: { purpose: string }) => c.purpose === 'signin')
    const byPartner = new Set(signins.map((c: { partner_id: string }) => c.partner_id))
    expect(signins.length).toBe(byPartner.size)
    for (const c of signins) expect((c as { kind: string }).kind).toBe('email')
  })
})

describe('a seller reading their own record', () => {
  beforeAll(async () => { await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut() })

  it('resolves the sign-in to a person, so there is a "you" to edit', async () => {
    const snap = await loadMyDetails(DEMO)
    expect(snap.loadError).toBeUndefined()
    expect(snap.me?.email).toBe(PARTNER.email)
    expect(snap.me?.partner_id).toBe(DEMO)
  })

  it('shows colleagues, because a delegate needs somebody to be', async () => {
    const snap = await loadMyDetails(DEMO)
    expect(snap.colleagues.length).toBeGreaterThan(0)
    expect(snap.colleagues.every(c => c.partner_id === DEMO)).toBe(true)
  })

  it('puts everybody at the company on the same domain as the sign-in', async () => {
    /* Two domains on one roster reads as a defect rather than as data, and this
       page is where a seller would see it. */
    const snap = await loadMyDetails(DEMO)
    for (const u of [snap.me!, ...snap.colleagues]) {
      expect(u.email, `${u.name} is on a different domain`).toMatch(/@nimbussensors\.com$/)
    }
  })

  it('lets a seller see their own account number in full — it is their account', async () => {
    const snap = await loadMyDetails(DEMO)
    expect(snap.bank).toBeTruthy()
    expect(snap.bank!.account.length).toBeGreaterThan(4)
  })

  /* Row-level security cannot say "these columns but not those", so without the
     guard trigger a seller could set `account` and `verified` in one API call
     and the whole request-and-confirm step would be theatre. This writes for
     real and asserts nothing moved. */
  it('cannot move its own money by writing the live columns directly', async () => {
    const before = (await loadMyDetails(DEMO)).bank!
    await supabase.from('partner_bank')
      .update({ account: '999999999999', verified: true, verified_by: 'me', pending_status: 'rejected' })
      .eq('partner_id', DEMO)
    const after = (await loadMyDetails(DEMO)).bank!
    expect(after.account, 'a seller rewrote their own settlement account').toBe(before.account)
    expect(after.verified_by).toBe(before.verified_by)
    expect(after.pending_status, 'a seller decided their own change request').toBe(before.pending_status)
  })

  it('shows no other seller anything', async () => {
    /* The whole reason this table can hold full account numbers. */
    const other = await loadPartnerSettlement('PTR-1001')
    expect(other.bank).toBeNull()
    expect(other.contacts).toEqual([])
    expect(other.golive).toEqual([])
  })

  it('has the demo seller inside the certificate renewal window', async () => {
    /* Deliberate: a certificate expiring in eight months demonstrates nothing.
       If this ever goes quiet, the tax panel is being shown against nothing. */
    const snap = await loadMyDetails(DEMO)
    expect(taxPosition(snap.bank, new Date()).level).toBe('expiring')
  })

  it('agrees with the finance gate submission about when the certificate expires', async () => {
    const [snap, { data }] = await Promise.all([
      loadMyDetails(DEMO),
      supabase.from('onboarding_submissions').select('fields')
        .eq('partner_id', DEMO).eq('gate_key', 'finance').maybeSingle(),
    ])
    const fields = ((data?.fields ?? []) as [string, string][])
    const quoted = fields.find(f => f[0] === 'Treaty certificate')?.[1] ?? ''
    /* Built from the parts rather than toLocaleDateString: Node's en-GB renders
       September as "Sept" and Postgres renders it "Sep", and a test that fails
       on that is testing ICU rather than the data. */
    const [y, m, d] = snap.bank!.treaty_expires!.split('-')
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]
    expect(quoted, 'the gate record and the live tax position disagree')
      .toContain(`${d} ${month} ${y}`)
  })

  it('is open in a marketplace it has published nothing in', async () => {
    /* The state the go-live tab exists to make visible. */
    const [snap, record] = await Promise.all([loadMyDetails(DEMO), loadSellerRecord(DEMO)])
    const rows = goLiveRows(record.categories, record.approvals, snap.golive, record.listings)
    const empty = rows.filter(r => r.state === 'empty')
    expect(empty.length).toBeGreaterThan(0)
    expect(empty[0].next).toMatch(/do not see you/)
  })

  it('carries a contact gap and an unverified contact worth pointing at', async () => {
    /* Both are the demonstration: a purpose with nobody listed, and a number
       recorded but never proved. */
    const snap = await loadMyDetails(DEMO)
    expect(contactGaps(snap.contacts).length).toBeGreaterThan(0)
    expect(snap.contacts.some(c => !c.verified)).toBe(true)
  })

  it('carries a real security gap on the roster', async () => {
    const snap = await loadMyDetails(DEMO)
    const gaps = securityGaps([snap.me!, ...snap.colleagues])
    expect(gaps.some(g => g.what === 'No multi-factor authentication')).toBe(true)
  })
})
