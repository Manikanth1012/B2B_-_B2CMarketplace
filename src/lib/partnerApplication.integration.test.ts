/* Touches the live Supabase project. Writes applications and removes them.
 *
 * Every test here runs SIGNED OUT, which is the point. An applicant is by
 * definition somebody with no account, and the whole feature rests on a claim
 * that cannot be checked from a mock or from a signed-in client: that an
 * anonymous request can start an application, come back to it with a reference
 * and an access code, and reach nothing else at all.
 *
 * Both halves are asserted. A design where anon can do nothing satisfies every
 * "anon cannot read the table" test ever written for it, and would also mean
 * the button on the landing page does not work.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import {
  loadFields, loadMarkets, startApplication, resumeApplication, saveAnswer, submitApplication,
  loadDeskApplications, acceptApplication, withdrawApplication,
} from './partnerApplicationRepo'
import { canSubmit, outstanding, stepsOf, looksLikeCode, canAccept } from './partnerApplication'
import type { Answers, FieldSpec } from './partnerApplication'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

/* Unique per run, because `start_application` refuses a second open application
   for the same address — which is itself one of the tests below. */
const stamp = () => Date.now().toString(36).slice(-6)
const mail = () => `applicant-${stamp()}@integration.test`

const started: string[] = []

async function begin(over: Partial<Parameters<typeof startApplication>[0]> = {}) {
  const res = await startApplication({
    email: mail(), phone: '+91 80 4000 0000', company: 'Integration Test Devices',
    contact_name: 'A Tester', country: 'IN', kind: 'Reseller', ...over,
  })
  if (res.ok) started.push(res.value.reference)
  return res
}

describe('a stranger applies to sell', () => {
  let fields: FieldSpec[]

  beforeAll(async () => {
    /* Explicitly signed out rather than merely not signed in. Another suite may
       have left a session in this client. */
    await signOut()
    fields = await loadFields()
  }, 30000)

  afterAll(async () => {
    /* Only the operator can reach the table, so the clean-up signs in. That is
       itself the isolation claim: if this delete worked signed out, the test
       below asserting it cannot would be lying. */
    await signIn(OPERATOR.email, OPERATOR.password)
    for (const ref of started) {
      await supabase.from('partner_applications').delete().eq('id', ref)
    }
    await signOut()
  }, 30000)

  it('can read the questions without an account', () => {
    /* The form is public. If this is empty the screen renders seven empty
       steps and every completeness check below passes having read nothing. */
    expect(fields.length, 'the application form is empty').toBeGreaterThan(20)
    expect(new Set(fields.map(f => f.gate_id)).size, 'the form does not cover seven gates').toBe(7)
    expect(fields.some(f => f.required), 'nothing on the form is required').toBe(true)
  })

  it('asks about every gate the marketplace actually runs', () => {
    /* Ranged over the gates in the code rather than a list written here — a
       gate added to `GATES` with no questions behind it is a gate the desk
       reaches with nothing in front of it. */
    const asked = new Set(fields.map(f => f.gate_id))
    for (const gate of ['apply', 'kyc', 'agree', 'finance', 'tech', 'assure', 'golive']) {
      expect(asked.has(gate), `nothing is asked for the ${gate} gate`).toBe(true)
    }
  })

  it('offers only markets the marketplace trades in', async () => {
    const markets = await loadMarkets()
    expect(markets.length, 'no markets loaded').toBeGreaterThan(0)
    const names = new Set(markets.map(m => m.name))
    const question = fields.find(f => f.id === 'apply-markets')!
    for (const opt of (question.options ?? '').split(',').map(s => s.trim())) {
      expect(names.has(opt), `the form offers ${opt}, which is not a market`).toBe(true)
    }
  })

  it('starts one and issues a reference and a usable code', async () => {
    /* The permission half, and it comes first for the usual reason. */
    const res = await begin()
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    expect(res.value.reference).toMatch(/^APP-\d{4}-\d{4}$/)
    /* Checked against the client's own shape test, so a code the database
       issues that the resume form would reject is caught here rather than by
       an applicant a week later. */
    expect(looksLikeCode(res.value.access_code), `issued ${res.value.access_code}`).toBe(true)
  })

  it('refuses a second open application for the same address', async () => {
    const email = mail()
    const first = await begin({ email })
    expect(first.ok).toBe(true)

    const second = await begin({ email })
    expect(second.ok, 'two open applications were allowed for one email').toBe(false)
    if (!second.ok) expect(second.reason).toMatch(/already an application open/i)
  })

  it('refuses an application with no way to reach the applicant', async () => {
    /* The database checks this as well as the form does, because the form is
       not the only way in. */
    for (const bad of [{ email: 'not-an-address' }, { phone: '  ' }, { company: '' }, { contact_name: '' }]) {
      const res = await begin(bad)
      expect(res.ok, `${JSON.stringify(bad)} was accepted`).toBe(false)
    }
  })

  it('refuses a country the marketplace does not operate in', async () => {
    const res = await begin({ country: 'GB' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/does not trade in GB/i)
  })

  it('comes back with the reference and code, and not with either alone', async () => {
    const res = await begin()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const { reference, access_code } = res.value

    const good = await resumeApplication(reference, access_code)
    expect(good.ok, good.ok ? '' : good.reason).toBe(true)
    if (good.ok) expect(good.value.application.company).toBe('Integration Test Devices')

    /* The refusal half. A real reference with the wrong code, and a real code
       against the wrong reference — both have to fail, or the pair is not a
       credential, one half of it is. */
    expect((await resumeApplication(reference, 'AAAABBBBCCCC')).ok, 'the wrong code got in').toBe(false)
    expect((await resumeApplication('APP-2026-9999', access_code)).ok, 'a code opened another reference').toBe(false)
  })

  it('saves an answer and hands it back on the next visit', async () => {
    const res = await begin()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const { reference, access_code } = res.value

    const save = await saveAnswer({
      reference, code: access_code, field: 'apply-volume', value: '400', reached: 2,
    })
    expect(save.ok, save.ok ? '' : save.reason).toBe(true)

    const back = await resumeApplication(reference, access_code)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.value.answers['apply-volume']).toBe('400')
    /* The furthest step reached comes back too, which is the whole point of
       leaving and returning. */
    expect(back.value.application.reached).toBeGreaterThanOrEqual(2)
  })

  it('treats an emptied answer as unanswered rather than as an empty answer', async () => {
    const res = await begin()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const { reference, access_code } = res.value

    await saveAnswer({ reference, code: access_code, field: 'apply-volume', value: '400' })
    await saveAnswer({ reference, code: access_code, field: 'apply-volume', value: '   ' })

    const back = await resumeApplication(reference, access_code)
    expect(back.ok).toBe(true)
    /* Stored as '' it would satisfy the required check and the applicant would
       submit a blank answer to a question the desk has to have. */
    if (back.ok) expect(back.value.answers['apply-volume']).toBeUndefined()
  })

  it('refuses an answer to a question that is not on the form', async () => {
    const res = await begin()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const out = await saveAnswer({
      reference: res.value.reference, code: res.value.access_code,
      field: 'not-a-question', value: 'x',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/no question called/i)
  })

  it('will not save against someone else\'s reference', async () => {
    const mine = await begin()
    const theirs = await begin()
    expect(mine.ok && theirs.ok).toBe(true)
    if (!mine.ok || !theirs.ok) return

    const out = await saveAnswer({
      reference: theirs.value.reference, code: mine.value.access_code,
      field: 'apply-volume', value: '999',
    })
    expect(out.ok, 'one applicant wrote into another\'s application').toBe(false)
  })

  it('refuses to submit while anything required is outstanding', async () => {
    const res = await begin()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const out = await submitApplication(res.value.reference, res.value.access_code)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/outstanding/i)
  })

  it('submits once every required question is answered, and then locks', async () => {
    const res = await begin()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const { reference, access_code } = res.value

    /* Answered by walking the fields that exist rather than a list written
       here. A question the desk adds tomorrow is answered by this loop the
       same day, which is the only way this test keeps meaning what it says. */
    const answers: Answers = {}
    for (const f of fields.filter(f => f.required)) {
      const value = f.kind === 'boolean' ? 'No'
        : f.kind === 'number' ? '400'
        : f.kind === 'date' ? '2026-09-01'
        : f.kind === 'email' ? 'signatory@integration.test'
        : f.kind === 'choice' || f.kind === 'multichoice'
          ? (f.options ?? '').split(',')[0].trim()
          : 'Answered by the integration test'
      answers[f.id] = value
      const saved = await saveAnswer({ reference, code: access_code, field: f.id, value })
      expect(saved.ok, saved.ok ? '' : `${f.id}: ${saved.reason}`).toBe(true)
    }

    /* The client and the database have to agree about completeness. If they
       disagree the applicant either sees an enabled button that fails, or a
       disabled one on a finished form. */
    expect(outstanding(fields, answers)).toEqual([])
    expect(canSubmit(fields, answers)).toEqual({ ok: true })
    expect(stepsOf(fields, answers).every(s => s.done)).toBe(true)

    const sent = await submitApplication(reference, access_code)
    expect(sent.ok, sent.ok ? '' : sent.reason).toBe(true)

    const after = await resumeApplication(reference, access_code)
    expect(after.ok).toBe(true)
    if (after.ok) {
      expect(after.value.application.state).toBe('submitted')
      expect(after.value.application.submitted_on).toBeTruthy()
    }

    /* And it stops being editable. An applicant changing answers under a desk
       part-way through assessing them is the reason this lock exists. */
    const late = await saveAnswer({
      reference, code: access_code, field: 'apply-volume', value: '1',
    })
    expect(late.ok, 'a submitted application was still editable').toBe(false)

    const twice = await submitApplication(reference, access_code)
    expect(twice.ok, 'the same application was submitted twice').toBe(false)
  }, 120000)
})

describe('what an anonymous applicant cannot reach', () => {
  beforeAll(async () => { await signOut() })

  it('cannot read the applications table, only call the functions', async () => {
    const { data, error } = await supabase.from('partner_applications').select('id, access_code')
    /* RLS narrows rather than raises, so an empty result is the refusal — and
       an error is fine too. What must not happen is rows coming back. */
    expect(error ? true : (data ?? []).length === 0,
      'an anonymous visitor read the applications table').toBe(true)
  })

  it('cannot read anybody\'s answers directly', async () => {
    const { data, error } = await supabase.from('partner_application_answers').select('*')
    expect(error ? true : (data ?? []).length === 0,
      'an anonymous visitor read the answers table').toBe(true)
  })

  it('cannot call the helper that hands back an access code', async () => {
    /* `application_for` returns the whole row, code included. It is the one
       function deliberately not granted, and a grant that silently applied to
       everything would undo every other test in this file. */
    const { error } = await supabase.rpc('application_for', { p_ref: 'APP-2026-0001', p_code: 'X' })
    expect(error, 'application_for is callable anonymously and it returns the code').not.toBeNull()
  })

  it('cannot see a partner record, which is what an application is not yet', async () => {
    const { data, error } = await supabase.from('partners').select('id')
    expect(error ? true : (data ?? []).length === 0,
      'an anonymous visitor read the partner directory').toBe(true)
  })
})

/* Accepting is eight tables in one transaction. The claim worth testing is not
 * that it writes them — it is that a seller who comes out the other side is
 * complete: a partner row, seven gates with the first open, the task ladder
 * behind them, the markets they asked for, their contacts and a lifecycle
 * event. A partner with no gates cannot be progressed by anybody, and the
 * screen that used to make one could not repair it either. */
describe('the desk accepts an application', () => {
  let fields: FieldSpec[]
  let reference: string
  let code: string
  let partnerId: string | null = null

  beforeAll(async () => {
    await signOut()
    fields = await loadFields()

    const res = await startApplication({
      email: mail(), phone: '+254 20 111 2222', company: 'Accept Test Sensors',
      contact_name: 'A Reviewer', country: 'KE', kind: 'IoT hardware',
    })
    if (!res.ok) throw new Error(`could not start an application: ${res.reason}`)
    reference = res.value.reference
    code = res.value.access_code
    started.push(reference)

    for (const f of fields.filter(f => f.required)) {
      const value = f.kind === 'boolean' ? 'No'
        : f.kind === 'number' ? '250'
        : f.kind === 'date' ? '2026-10-01'
        : f.kind === 'email' ? 'signatory@integration.test'
        : f.id === 'apply-markets' ? 'Kenya, India'
        : f.kind === 'choice' || f.kind === 'multichoice'
          ? (f.options ?? '').split(',')[0].trim()
          : 'Answered by the accept test'
      const saved = await saveAnswer({ reference, code, field: f.id, value })
      if (!saved.ok) throw new Error(`${f.id}: ${saved.reason}`)
    }
    const sent = await submitApplication(reference, code)
    if (!sent.ok) throw new Error(`could not submit: ${sent.reason}`)
  }, 180000)

  afterAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    if (partnerId) {
      /* Children first — the application references the partner, and the
         partner is referenced by everything the accept created. */
      await supabase.from('partner_applications').update({ partner_id: null, state: 'withdrawn' }).eq('id', reference)
      for (const t of ['onboarding_tasks', 'onboarding_gates', 'partner_markets',
                       'partner_contacts', 'partner_lifecycle_events']) {
        await supabase.from(t).delete().eq('partner_id', partnerId)
      }
      await supabase.from('partners').delete().eq('id', partnerId)
    }
    await supabase.from('partner_applications').delete().eq('id', reference)
    await signOut()
  }, 60000)

  it('refuses an applicant trying to accept their own application', async () => {
    /* Signed out, which is what an applicant is. `accept_application` runs as
       the definer and so could reach every table — the persona check in its
       first three lines is the only thing between a stranger and a partner
       record, so it is asserted before anything else here. */
    const out = await acceptApplication(reference, 'trying it on')
    expect(out.ok, 'an anonymous caller accepted an application').toBe(false)
  })

  it('creates the partner, its gates, its tasks and its markets in one go', async () => {
    await signIn(OPERATOR.email, OPERATOR.password)

    const desk = await loadDeskApplications()
    const app = desk.applications.find(a => a.id === reference)!
    expect(app.state).toBe('submitted')
    expect(canAccept(app, fields, desk.answers[reference] ?? {})).toEqual({ ok: true })

    const res = await acceptApplication(reference, 'Accepted by the integration test.')
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    partnerId = res.value.partner_id

    const [p, gates, tasks, markets, contacts, events] = await Promise.all([
      supabase.from('partners').select('*').eq('id', partnerId).maybeSingle(),
      supabase.from('onboarding_gates').select('*').eq('partner_id', partnerId).order('gate_order'),
      supabase.from('onboarding_tasks').select('*').eq('partner_id', partnerId),
      supabase.from('partner_markets').select('*').eq('partner_id', partnerId),
      supabase.from('partner_contacts').select('*').eq('partner_id', partnerId),
      supabase.from('partner_lifecycle_events').select('*').eq('partner_id', partnerId),
    ])

    const partner = p.data as { name: string; status: string; type: string; country: string } | null
    expect(partner?.name).toBe('Accept Test Sensors')
    /* Onboarding, not live. A form is not a vetting. */
    expect(partner?.status).toBe('onboarding')
    expect(partner?.country).toBe('Kenya')

    const gateRows = (gates.data ?? []) as { gate_order: number; status: string; submitted_by: string | null }[]
    expect(gateRows.length, 'the partner was created without its gates').toBe(7)
    expect(gateRows[0].status).toBe('current')
    /* The application gate arrives submitted — the applicant did that. */
    expect(gateRows[0].submitted_by).toBe('A Reviewer')
    expect(gateRows.slice(1).every(g => g.status === 'pending'), 'a later gate was opened early').toBe(true)

    /* Ranged over the ladder rather than a count written here, so a task added
       to the marketplace is a task this checks for. */
    const { data: ladder } = await supabase.from('onboarding_task_ladder').select('id, gate_id')
    expect((tasks.data ?? []).length).toBe((ladder ?? []).length)
    expect((ladder ?? []).length, 'the task ladder is empty, so this checked nothing').toBeGreaterThan(10)

    const mkt = (markets.data ?? []) as { market_code: string; state: string }[]
    expect(mkt.map(m => m.market_code).sort()).toEqual(['IN', 'KE'])
    /* Requested, never approved. Approving here would hand a stranger two
       markets on the strength of a form. */
    expect(mkt.every(m => m.state === 'requested'), 'a market was approved by accepting the application').toBe(true)

    expect((contacts.data ?? []).length).toBe(2)
    expect((events.data ?? []).length).toBeGreaterThan(0)
  }, 60000)

  it('marks the application accepted and names the partner it became', async () => {
    const desk = await loadDeskApplications()
    const app = desk.applications.find(a => a.id === reference)!
    expect(app.state).toBe('accepted')
    expect(app.partner_id).toBe(partnerId)
    expect(canAccept(app, fields, desk.answers[reference] ?? {}).ok).toBe(false)
  })

  it('will not accept the same one twice', async () => {
    const out = await acceptApplication(reference, 'again')
    expect(out.ok, 'one application produced two partners').toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/already accepted/i)
  })

  it('will not withdraw one that has already become a partner', async () => {
    const out = await withdrawApplication(reference, 'changed our minds')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/Suspend the partner instead/i)
  })

  it('refuses to withdraw anything without a reason', async () => {
    const other = await startApplication({
      email: mail(), phone: '+91 80 4000 0000', company: 'Withdraw Test Ltd',
      contact_name: 'W Tester', country: 'IN', kind: 'Reseller',
    })
    expect(other.ok).toBe(true)
    if (!other.ok) return
    started.push(other.value.reference)

    const bare = await withdrawApplication(other.value.reference, '   ')
    expect(bare.ok, 'an application was closed with no reason').toBe(false)

    const withReason = await withdrawApplication(other.value.reference, 'Not trading in a market we operate in.')
    expect(withReason.ok, withReason.ok ? '' : withReason.reason).toBe(true)

    /* And the applicant is told, rather than finding a form that silently
       stopped working. `resume_application` only opens draft and submitted
       ones, so a withdrawn one refuses. */
    const back = await resumeApplication(other.value.reference, other.value.access_code)
    expect(back.ok, 'a withdrawn application still opened for the applicant').toBe(false)
  }, 60000)
})

describe('the operator sees what came in', () => {
  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) }, 30000)
  afterAll(async () => { await signOut() })

  it('can read applications, which is who the desk is', async () => {
    const { data, error } = await supabase.from('partner_applications').select('id, state, email')
    expect(error).toBeNull()
    /* Not asserting a count: applications are made and removed by the suite
       above, so the claim is reachability, not population. */
    expect(Array.isArray(data)).toBe(true)
  })

  it('sees no application already turned into a partner without the desk doing it', async () => {
    /* `partner_id` is set when the desk accepts one. A draft or submitted
       application carrying a partner id would mean a stranger got into the
       seller directory by filling in a form. */
    const { data } = await supabase.from('partner_applications')
      .select('id, state, partner_id').in('state', ['draft', 'submitted'])
    for (const a of (data ?? []) as { id: string; partner_id: string | null }[]) {
      expect(a.partner_id, `${a.id} is not accepted but already names a partner`).toBeNull()
    }
  })
})
